--- 登录与玩家服务管理
--- 登录包由 gate 解析后转发过来; 这里负责 openid -> uid, 创建/复用 user 服务,
--- 然后让 gate 绑定连接与 uid.
local moon = require("moon")
local common = require("common")
local Database = common.Database
local CmdCode = common.CmdCode

local traceback = debug.traceback

---@type auth_context
local context = ...

local Auth = {}

--- 同一 uid 的登录串行化(不同 uid 之间仍并发)
---@class uid_lock
---@field locked boolean
---@field waiters thread[]
---@type table<integer, uid_lock>
local uid_locks = {}

local function lock_uid(uid)
    local l = uid_locks[uid]
    if not l then
        l = { locked = false, waiters = {} }
        uid_locks[uid] = l
    end
    if not l.locked then
        l.locked = true
        return l
    end
    l.waiters[#l.waiters + 1] = coroutine.running()
    moon.wait()
    --- 被唤醒时 locked 仍为 true, 所有权已由 unlock_uid 移交
    return l
end

--- 释放锁, 直接把所有权交给下一个等待者
local function unlock_uid(l)
    local co = table.remove(l.waiters, 1)
    if co then
        moon.wakeup(co)
    else
        l.locked = false
    end
end

function Auth.Init()
    return true
end

function Auth.Start()
    return true
end

local function kick(req, reason)
    if reason then
        moon.error("auth kick:", req.fd, req.uid, reason)
    end
    if req.fd and req.fd > 0 then
        context.GateEvent.Gate.Kick(0, req.fd)
    end
end

--- 登录/拉取玩家服务, 调用方必须持有 uid 锁
local function doAuth(req)
    local u = context.uid_map[req.uid]

    if not u then
        --- 锁内创建, 同一 uid 不会并发建出第二个 user 服务
        local addr_user = moon.new_service({
            name = "user" .. req.uid,
            file = "game/service_user.lua",
        })
        if addr_user == 0 then
            return "create user service failed!"
        end

        local ok, err = context.GetUserRpc(addr_user).User.Load(req)
        if not ok then
            kick(req, err)
            moon.kill(addr_user)
            return err
        end

        u = {
            addr_user = addr_user,
            openid = req.openid,
            uid = req.uid,
            logouttime = moon.time(),
            online = false,
            fd = 0,
        }
        context.uid_map[req.uid] = u
    end

    --- 离线加载: 只保证服务已载入数据, 不涉及连接
    if req.pull then
        local openid = context.GetUserRpc(u.addr_user).User.Login(req)
        if not openid then
            kick(req, "pull login failed")
            return "pull login failed"
        end
        return true
    end

    --- 顶号: 先在 auth 侧让旧会话失效, 之后迟到的 Disconnect 会因 fd 不匹配被丢弃.
    --- old_fd/old_online 暂存, 用于 BindUser 失败或异常时恢复旧会话.
    local old_fd, was_online = u.fd or 0, u.online
    u.old_fd, u.old_online = old_fd, was_online
    u.fd, u.online = 0, false

    --- gate 原子完成: 校验登录凭据 -> 踢旧连接 -> 绑定新连接.
    --- 失败说明新连接在 auth 完成前已断开; 此时不会关掉仍然有效的旧会话.
    local ok = context.GateRpc.Gate.BindUser(req.fd, req.sign, req.uid, u.addr_user)
    if not ok then
        if old_fd ~= 0 and context.GateRpc.Gate.IsBound(req.uid, old_fd) then
            u.fd, u.online = old_fd, was_online
        end
        u.old_fd, u.old_online = nil, nil
        return "client closed before bind!"
    end

    u.old_fd, u.old_online = nil, nil
    u.fd, u.online = req.fd, true

    --- 不再单独发 User.Logout: User.Login 内部会对旧的在线状态执行 Offline 钩子
    local openid, name = context.GetUserRpc(u.addr_user).User.Login(req)
    if not openid then
        u.fd, u.online = 0, false
        context.GetUserEvent(u.addr_user).User.Logout()
        context.GateEvent.Gate.Kick(req.uid, req.fd)
        return name
    end

    --- 登录 RPC 期间新连接断开: Disconnect 已让 user 服务回到离线, 这里不再回包
    if u.fd ~= req.fd then
        return true
    end

    u.openid = openid
    u.name = name
    u.logouttime = 0

    context.S2C(req.uid, CmdCode.S2CLogin, {
        ok = true,
        uid = req.uid,
        time = moon.now(),
        timezone = moon.timezone,
        name = name,
    })
    print("login success", req.uid, openid, name)
    return true
end

--- 登录失败后的清理.
--- 必须在 uid 锁内调用: 其中可能 yield(User.Logout / Gate.IsBound),
--- 放到锁外会与同一 uid 的下一次登录交错, 恢复旧会话时可能覆盖新会话状态.
local function cleanupLogin(req)
    if req.pull then
        return
    end

    local u = context.uid_map[req.uid]
    if not u then
        return
    end

    if req.fd and req.fd > 0 and u.fd == req.fd then
        --- 已经绑定后出错: 解绑并让 user 服务回到离线, 避免假在线
        u.online, u.fd = false, 0
        context.GetUserEvent(u.addr_user).User.Logout()
        context.GateEvent.Gate.Kick(req.uid, req.fd)
    elseif u.old_fd then
        --- 异常发生在 BindUser 之前/期间: 尽量恢复旧会话
        local old_fd, old_online = u.old_fd, u.old_online
        u.old_fd, u.old_online = nil, nil
        if context.GateRpc.Gate.IsBound(req.uid, old_fd) then
            u.fd, u.online = old_fd, old_online
        end
    end
end

---@param req C2SLogin
function Auth.C2SLogin(req)
    if not req then
        return false
    end

    if not req.pull then
        local openid = req.openid
        if not openid or #openid == 0 then
            kick(req, "openid empty")
            return false
        end

        local ok, uid = xpcall(function()
            return Database.getorcreateuid(context.addr_db, openid)
        end, traceback)
        if not ok or not uid then
            kick(req, "get uid failed")
            moon.error("Auth.C2SLogin get uid failed:", uid)
            return false
        end
        req.uid = uid
    else
        req.openid = ""
        if not req.uid or req.uid == 0 then
            return false
        end
    end

    --- 同一 uid 的登录(含 PullUser)串行执行
    local l = lock_uid(req.uid)
    local ok, res = xpcall(doAuth, traceback, req)

    --- doAuth 成功返回 true, 失败返回错误信息.
    --- 错误清理必须在本协程仍持有锁时完成: 清理内部会 yield
    --- (User.Logout / Gate.IsBound), 若先 unlock, 同一 uid 的下一次登录
    --- 可能在间隙中完成绑定, 随后被这里恢复的旧会话状态覆盖.
    if not ok or res ~= true then
        local ok2, err2 = xpcall(cleanupLogin, traceback, req)
        if not ok2 then
            moon.error("Auth.C2SLogin cleanup error", err2)
        end
    end
    unlock_uid(l)

    if not ok or res ~= true then
        moon.error("Auth.C2SLogin error", res)
        return false
    end
    return true
end

--- 加载离线玩家
function Auth.PullUser(uid)
    local u = context.uid_map[uid]
    if not u then
        local ok = Auth.C2SLogin({ fd = 0, uid = uid, pull = true })
        if not ok then
            return nil, "load user failed"
        end
        u = context.uid_map[uid]
    end
    return u
end

function Auth.CallUser(id, session, uid, cmd, ...)
    local u, err = Auth.PullUser(uid)
    if not u then
        moon.raw_send("lua", id, moon.pack(false, err), -session)
        return
    end
    moon.raw_send("lua", u.addr_user, moon.pack(cmd, ...), session, id)
end

function Auth.SendUser(uid, cmd, ...)
    local u, err = Auth.PullUser(uid)
    if not u then
        moon.error(err)
        return
    end
    moon.send("lua", u.addr_user, cmd, ...)
end

function Auth.TrySendUser(uid, cmd, ...)
    local u = context.uid_map[uid]
    if not u then
        return
    end
    moon.send("lua", u.addr_user, cmd, ...)
end

function Auth.Disconnect(uid, fd)
    local u = context.uid_map[uid]
    if not u then
        return
    end

    --- 只处理当前会话的断线; 顶号前旧连接的 close 事件到这里时会被丢弃
    if fd ~= nil and u.fd ~= fd then
        return
    end

    u.online = false
    u.fd = 0
    u.logouttime = moon.time()
    context.GetUserEvent(u.addr_user).User.Logout()
end

function Auth.Shutdown()
    print("begin: server exit save user")
    local count = 0
    for _, u in pairs(context.uid_map) do
        context.GetUserEvent(u.addr_user).User.Exit()
        count = count + 1
    end
    print("end: server exit save user", count)
    moon.quit()
    return true
end

return Auth
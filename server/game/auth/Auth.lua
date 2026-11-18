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
        context.GateRpc.Gate.Kick(0, req.fd)
    end
end

local function doAuth(req)
    local u = context.uid_map[req.uid]
    local addr_user
    if not u then
        addr_user = moon.new_service({
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
            context.uid_map[req.uid] = nil
            return err
        end
    else
        addr_user = u.addr_user
    end

    local openid, name = context.GetUserRpc(addr_user).User.Login(req)
    if not openid then
        kick(req, name)
        moon.kill(addr_user)
        context.uid_map[req.uid] = nil
        return name
    end

    if not u then
        u = {
            addr_user = addr_user,
            openid = openid,
            uid = req.uid,
            logouttime = moon.time(),
            online = false,
        }
        context.uid_map[req.uid] = u
    end

    if req.pull then
        return
    end

    req.addr_user = addr_user
    u.logouttime = 0
    u.online = true
    u.name = name

    context.GateEvent.Gate.BindUser(req)
    context.S2C(req.uid, CmdCode.S2CLogin, {
        ok = true,
        uid = req.uid,
        time = moon.now(),
        timezone = moon.timezone,
        name = name,
    })
    print("login success", req.uid, openid, name)
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

        local uid = Database.getuidbyopenid(context.addr_db, openid)
        if not uid then
            uid = Database.createuid(context.addr_db, openid)
        end
        req.uid = uid
    else
        req.openid = ""
        if not req.uid or req.uid == 0 then
            return false
        end
    end

    --- 同一账号重复登录: 踢掉旧连接
    if not req.pull then
        local old = context.uid_map[req.uid]
        if old and old.online then
            context.GateEvent.Gate.Kick(req.uid)
            if old.addr_user then
                context.GetUserEvent(old.addr_user).User.Logout()
            end
            old.online = false
        end
    end

    local ok, err = xpcall(doAuth, traceback, req)
    if not ok or err then
        moon.error("Auth.C2SLogin error", err)
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

function Auth.Disconnect(uid)
    local u = context.uid_map[uid]
    if u then
        u.online = false
        u.logouttime = moon.time()
        context.GetUserEvent(u.addr_user).User.Logout()
    end
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
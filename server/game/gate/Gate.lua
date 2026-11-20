local moon = require("moon")
local socket = require("moon.socket")

---@type gate_context
local context = ...

local listenfd
local ws_listenfd

---@class Gate
local Gate = {}

function Gate.Init()
    return true
end

function Gate.Start()
    listenfd = socket.listen(context.conf.host, context.conf.port, moon.PTYPE_SOCKET_MOON)
    ws_listenfd = socket.listen(context.conf.host, context.conf.port + 1, moon.PTYPE_SOCKET_WS)

    assert(listenfd > 0, "server listen failed")
    assert(ws_listenfd > 0, "server listen websocket failed")

    socket.start(listenfd)
    socket.start(ws_listenfd)

    print("MOONFARM TCP listen:", context.conf.host, context.conf.port)
    print("MOONFARM WS  listen:", string.format("ws://%s:%d", context.conf.host, context.conf.port + 1))
    return true
end

function Gate.Shutdown()
    for _, c in pairs(context.uid_map) do
        socket.close(c.fd)
    end
    if listenfd then
        socket.close(listenfd)
        socket.close(ws_listenfd)
    end
    moon.quit()
    return true
end

--- 关闭连接. 优先使用显式 fd; 只传 uid 时关闭该 uid 当前绑定的连接.
--- ignore_socket_event 仅为兼容旧调用保留, 关闭事件始终由 socket close 事件清理.
function Gate.Kick(uid, fd, ignore_socket_event)
    print("gate kick", uid, fd, ignore_socket_event)
    if fd and fd > 0 then
        socket.close(fd)
        return true
    end

    if uid and uid > 0 then
        local c = context.uid_map[uid]
        if c then
            socket.close(c.fd)
        end
    end
    return true
end

--- 绑定 fd 与 uid.
--- 返回 true 表示绑定成功; false 表示该连接已断开, 或其登录包已被后续包覆盖.
--- fd 由框架全局单调递增分配, 永不复用, 可作为会话身份.
function Gate.BindUser(fd, sign, uid, addr_user)
    if context.auth_watch[fd] ~= sign then
        return false, "client closed before auth done!"
    end

    local old = context.uid_map[uid]
    if old and old.fd ~= fd then
        --- 只关连接, fd_map 交给 close 事件清理;
        --- 否则旧 fd 的在途消息会因 fd_map 为空被当成登录包
        socket.close(old.fd)
        print("kick user", uid, "oldfd", old.fd, "newfd", fd)
    end

    local c = {
        uid = uid,
        fd = fd,
        addr_user = addr_user,
    }

    context.fd_map[fd] = c
    context.uid_map[uid] = c
    context.auth_watch[fd] = nil
    print(string.format("BindUser fd:%d uid:%d serviceid:%08X", fd, uid, addr_user))
    return true
end

--- uid 当前是否仍绑定在 fd 上(供 auth 校验旧会话是否还有效)
function Gate.IsBound(uid, fd)
    local c = context.uid_map[uid]
    return c ~= nil and c.fd == fd
end

return Gate
--- gate 服务: 管理网络连接, 把登录包转给 auth, 登录后把 C2S 消息转发给玩家自己的 user 服务
local moon = require("moon")
local seri = require("seri")
local socket = require("moon.socket")
local websocket = require("moon.http.websocket")
local common = require("common")
local buffer = require("buffer")
local setup = require("common.setup")
local protocol = common.protocol
local GameDef = common.GameDef

local conf = ...

local redirect = moon.redirect

local PTYPE_C2S = GameDef.PTYPE_C2S

---@class gate_context:base_context
local context = {
    conf = conf,
    uid_map = {},
    fd_map = {},
    auth_watch = {},
    --- 登录包序号: 用作 auth_watch 的可靠 sign(消息对象地址会被复用)
    login_seq = 0,
}

setup(context)

local function on_message(fd, msg)
    local c = context.fd_map[fd]
    if not c then
        --- 未登录: 第一个包必须是登录消息
        context.login_seq = context.login_seq + 1
        local sign = context.login_seq
        context.auth_watch[fd] = sign

        local ok, name, req = pcall(protocol.decode, moon.decode(msg, "B"))
        if not ok then
            moon.error("Decode auth message failed:", name)
            socket.close(fd)
            return
        end
        req.sign = sign
        req.fd = fd
        req.addr = socket.getaddress(fd)
        req.pull = false
        moon.send("lua", context.addr_auth, name, req)
    else
        redirect(msg, c.addr_user, PTYPE_C2S, 0, 0)
    end
end

local function on_close(fd, msg)
    local data = moon.decode(msg, "Z")
    context.auth_watch[fd] = nil
    local c = context.fd_map[fd]
    if not c then
        print("GATE: close", fd, data)
        return
    end
    context.fd_map[fd] = nil
    --- 只有当前绑定仍是这条连接时才清 uid_map, 避免误删顶号后的新绑定
    if context.uid_map[c.uid] == c then
        context.uid_map[c.uid] = nil
    end
    --- 带 fd: auth 只处理当前会话的断线, 过期的 close 事件会被丢弃
    context.AuthEvent.Auth.Disconnect(c.uid, fd)
    print("GATE: close", fd, c.uid, data)
end

websocket.on_accept(function(fd, msg)
    print("GATE: accept ws", fd)
    socket.settimeout(fd, 120)
end)

websocket.wson("message", on_message)
websocket.wson("close", on_close)

socket.on("accept", function(fd, msg)
    print("GATE: accept tcp", fd, moon.decode(msg, "Z"))
    socket.set_enable_chunked(fd, "w")
    socket.settimeout(fd, 120)
end)

socket.on("message", on_message)
socket.on("close", on_close)

moon.raw_dispatch("S2C", function(msg)
    local buf = moon.decode(msg, "L")
    local uid = seri.unpack_one(buf, true)
    if type(uid) == "number" then
        local c = context.uid_map[uid]
        if not c then
            buffer.delete(buf)
            buf = nil
            return
        end
        socket.write(c.fd, buf)
    else
        local p = buffer.to_shared(buf)
        for _, one in ipairs(uid) do
            local c = context.uid_map[one]
            if c then
                socket.write(c.fd, p)
            end
        end
    end
end)

moon.raw_dispatch("SBC", function(msg)
    local buf = moon.decode(msg, "L")
    local p = buffer.to_shared(buf)
    for _, c in pairs(context.uid_map) do
        socket.write(c.fd, p)
    end
end)
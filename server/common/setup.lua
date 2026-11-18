--- 服务框架: 脚本自动加载 / C2S 消息分发 / 服务间通信封装
--- 简化自 MoonDemo, 去掉了 center/mail 等本项目暂不需要的部分
local moon = require("moon")
local json = require("json")
local hotfix = require("hotfix")
local fs = require("fs")
local seri = require("seri")
local datetime = require("moon.datetime")
local common = require("common")
local GameDef = common.GameDef
local protocol = common.protocol
local CmdCode = common.CmdCode
local GameCfg = common.GameCfg

local string = string
local type = type
local strfmt = string.format
local traceback = debug.traceback

local unpack_one = seri.unpack_one
local pack = moon.pack
local raw_send = moon.raw_send

local command = {}

hotfix.addsearcher(function(file)
    local content = moon.env(file)
    return load(content, "@" .. file), file
end)

--- 加载 game/<sname>/ 目录下的所有模块
--- 模块内命名为 C2SXxx 的函数自动注册为客户端消息处理函数
--- 其它函数注册为 "<模块名>.函数名", 供服务间调用
local function load_scripts(context, sname)
    local dir = strfmt("game/%s/", sname)
    local scripts = moon.env_unpacked(dir)
    if not scripts then
        scripts = {}
        local list = fs.listdir(dir, 10)
        for _, file in ipairs(list) do
            if not fs.isdir(file) then
                local name = fs.stem(file)
                scripts[name] = dir .. name .. ".lua"
            end
        end
        moon.env_packed(dir, scripts)
    end

    for name, file in pairs(scripts) do
        local fn
        local content = moon.env(file)
        if content then
            fn = load(content, "@" .. file)
        else
            fn = assert(loadfile(file))
        end
        local t = fn(context)
        assert(type(t) == "table")

        context.scripts[name] = t
        hotfix.register(file, fn, t)

        for k, v in pairs(t) do
            if type(v) == "function" then
                if string.sub(k, 1, 3) == "C2S" then
                    command[k] = v
                else
                    command[name .. "." .. k] = v
                end
            end
        end
    end
end

local function start_hour_timer(context)
    local fn = command["OnHour"]
    if not fn then
        return
    end

    local MILLSECONDS_ONE_HOUR <const> = 3600000

    local hour = datetime.localtime(moon.time()).hour
    moon.async(function()
        while true do
            local diff = MILLSECONDS_ONE_HOUR - moon.now() % MILLSECONDS_ONE_HOUR + 100
            moon.sleep(diff)
            local tm = datetime.localtime(moon.time())
            if hour ~= tm.hour then
                hour = tm.hour
                context.batch_invoke("OnHour", hour)
                if hour == 0 then
                    context.batch_invoke("OnDay", datetime.localday())
                end
            end
        end
    end)
end

local dynamic_wrap = setmetatable({}, { __mode = "kv" })
local function wrap_send_or_call(context, name, is_send)
    local M = { memo = "" }
    setmetatable(M, {
        __index = function(self, k)
            if #self.memo == 0 then
                self.memo = self.memo .. k .. "."
            else
                self.memo = self.memo .. k
            end
            return M
        end,
        __call = function(self, ...)
            local receiver = context and context[name] or name
            local cmd = M.memo
            M.memo = ""
            if is_send then
                return moon.send('lua', receiver, cmd, ...)
            else
                return moon.call('lua', receiver, cmd, ...)
            end
        end
    })
    return M
end

local function _internal(context)
    ---@class base_context
    local base_context = context

    base_context.GateEvent = wrap_send_or_call(context, "addr_gate", true)
    base_context.GateRpc = wrap_send_or_call(context, "addr_gate", false)
    base_context.AuthEvent = wrap_send_or_call(context, "addr_auth", true)
    base_context.AuthRpc = wrap_send_or_call(context, "addr_auth", false)

    ---@return user_scripts
    function base_context.GetUserEvent(user_addr)
        local v = dynamic_wrap[user_addr]
        if not v then
            v = wrap_send_or_call(nil, user_addr, true)
            dynamic_wrap[user_addr] = v
        end
        return v
    end

    function base_context.GetUserRpc(user_addr)
        local v = dynamic_wrap[user_addr]
        if not v then
            v = wrap_send_or_call(nil, user_addr, false)
            dynamic_wrap[user_addr] = v
        end
        return v
    end

    setmetatable(base_context, {
        __index = function(t, key)
            if string.sub(key, 1, 5) == "addr_" then
                local addr = moon.queryservice(string.sub(key, 6))
                if addr == 0 then
                    error("Can not found service: " .. tostring(key))
                end
                t[key] = addr
                return addr
            end
            return nil
        end
    })

    if not base_context.scripts then
        base_context.scripts = {}
    end

    function base_context.start_hour_timer()
        start_hour_timer(context)
    end

    function base_context.batch_invoke(cmd, ...)
        for _, v in pairs(context.scripts) do
            local f = v[cmd]
            if f then
                local ok, err = xpcall(f, traceback, ...)
                if not ok then
                    moon.error(err)
                end
            end
        end
    end

    function base_context.batch_invoke_throw(cmd, ...)
        for _, v in pairs(context.scripts) do
            local f = v[cmd]
            if f then
                f(...)
            end
        end
    end

    --- 给客户端发消息: S2C(uid, cmd_code, mtable)
    function base_context.S2C(uid, cmd_code, mtable)
        raw_send('S2C', context.addr_gate, protocol.encode(uid, cmd_code, mtable))
    end

    --- 给玩家服务发消息, 如果不在线会自动加载
    function base_context.send_user(uid, ...)
        moon.send("lua", context.addr_auth, "Auth.SendUser", uid, ...)
    end

    function base_context.call_user(uid, ...)
        local session = moon.next_sequence()
        moon.send("lua", context.addr_auth, "Auth.CallUser", moon.id, session, uid, ...)
        return moon.wait(session)
    end

    function base_context.try_send_user(uid, ...)
        moon.send("lua", context.addr_auth, "Auth.TrySendUser", uid, ...)
    end

    command.hotfix = function(fixlist)
        for name, file in pairs(fixlist) do
            local ok, t = hotfix.update(file)
            if ok then
                print(moon.name, "hotfix", name, file)
                for k, v in pairs(t) do
                    if string.sub(k, 1, 3) == "C2S" then
                        command[k] = v
                    else
                        command[name .. "." .. k] = v
                    end
                end
            else
                moon.error(moon.name, "hotfix failed", t, name, file)
                break
            end
        end
    end

    command.reload = function(names)
        GameCfg.Reload(names)
        print(moon.name, "reload", table.concat(names, " "))
    end

    command.Init = function(...)
        GameCfg.Load()
        base_context.batch_invoke_throw("Init", ...)
        return true
    end

    command.Start = function(...)
        base_context.batch_invoke_throw("Start", ...)
        return true
    end
end

local function xpcall_ret(ok, ...)
    if ok then
        return pack(...)
    end
    return pack(false, ...)
end

local function do_client_command(context, cmd, uid, req)
    local fn = command[cmd]
    if fn then
        local ok, res = xpcall(fn, traceback, uid, req)
        if not ok then
            moon.error(res)
            context.S2C(uid, CmdCode.S2CErrorCode, { code = 1 })
        elseif res and res > 0 then
            context.S2C(uid, CmdCode.S2CErrorCode, { code = res })
        end
    else
        moon.error(moon.name, "receive unknown PTYPE_C2S cmd " .. tostring(cmd) .. " " .. tostring(uid))
    end
end

return function(context, sname)
    sname = sname or moon.name

    _internal(context)

    load_scripts(context, sname)

    moon.dispatch("lua", function(sender, session, cmd, ...)
        local fn = command[cmd]
        if fn then
            if session ~= 0 then
                raw_send("lua", sender, xpcall_ret(xpcall(fn, traceback, ...)), session)
            else
                fn(...)
            end
        else
            moon.error(moon.name, "recv unknown cmd " .. tostring(cmd))
            if session ~= 0 then
                raw_send("lua", sender, xpcall_ret(false, moon.name .. " recv unknown cmd " .. tostring(cmd)), session)
            end
        end
    end)

    moon.register_protocol({
        name = "C2S",
        PTYPE = GameDef.PTYPE_C2S,
        israw = true,
        dispatch = function(msg)
            local buf = moon.decode(msg, "B")
            local uid = unpack_one(buf, true)
            local ok, cmd, data = pcall(protocol.decode, buf)
            if not ok then
                moon.error("protobuf decode client message failed", cmd)
                moon.send("lua", context.addr_gate, "Gate.Kick", uid)
                return
            end
            moon.async(do_client_command, context, cmd, uid, data)
        end
    })

    moon.register_protocol({
        name = "S2C",
        PTYPE = GameDef.PTYPE_S2C,
        dispatch = nil
    })

    moon.register_protocol({
        name = "SBC",
        PTYPE = GameDef.PTYPE_SBC,
        dispatch = nil
    })

    return command
end
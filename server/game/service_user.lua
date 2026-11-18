--- user 服务: 一个玩家一个服务(One Player One Service)
local moon = require("moon")
local common = require("common")
local setup = require("common.setup")

--- 每个 user 服务独立加载一份配置
common.GameCfg.Load()

---@class user_context:base_context
---@field uid integer
---@field scripts user_scripts
local context = {
    uid = 0,
    scripts = {},
}

local command = setup(context, "user")

context.addr_gate = moon.queryservice("gate")
context.addr_auth = moon.queryservice("auth")
context.addr_db = moon.queryservice("db")

--- 给本玩家发消息的简写
function context.Send(cmd, mtable)
    context.S2C(context.uid, cmd, mtable)
end

--- gate 转发过来的 C2S 帧不带 uid 前缀(只有 [cmd][body]),
--- 这里覆盖框架默认的 C2S dispatch, 按消息码直接分发给本服务的 C2S* 函数.
local CmdCode = common.CmdCode
local protocol = common.protocol

moon.raw_dispatch("C2S", function(msg)
    local buf = moon.decode(msg, "B")
    local ok, cmd, data = pcall(protocol.decode, buf)
    if not ok then
        moon.error("decode client message failed:", cmd)
        return
    end

    local fn = command[cmd]
    if not fn then
        moon.error("receive unknown C2S cmd", cmd, context.uid)
        return
    end

    moon.async(function()
        local ok2, res = xpcall(fn, debug.traceback, data)
        if not ok2 then
            moon.error(res)
            context.Send(CmdCode.S2CErrorCode, { code = 1 })
        elseif res and res > 0 then
            context.Send(CmdCode.S2CErrorCode, { code = res })
        end
    end)
end)

--- 重写默认关闭行为, 由 auth 统一驱动退出
moon.shutdown(function()
end)

collectgarbage("incremental", 120)
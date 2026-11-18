local moon = require("moon")
local common = require("common")
local CmdCode = common.CmdCode
local GameCfg = common.GameCfg
local Database = common.Database

---@type user_context
local context = ...
local scripts = context.scripts

local state = {
    online = false,
}

---@class User
local User = {}

local function new_player(req)
    return {
        v = 1,
        uid = req.uid,
        openid = req.openid,
        name = (req.name and #req.name > 0) and req.name or req.openid,
        level = 1,
        exp = 0,
        coin = GameCfg.constants.initial_coin,
        items = {},
        plots = {},
        ctime = moon.time(),
        logintime = 0,
    }
end

function User.Load(req)
    local function fn()
        local data = Database.loaduser(context.addr_db, req.uid)
        local isnew = false
        if not data then
            if req.pull then
                return nil
            end
            isnew = true
            data = new_player(req)
        end

        scripts.UserModel.Create(data)

        context.uid = req.uid

        --- 各模块初始化自己的数据
        context.batch_invoke_throw("Init", isnew)
        context.batch_invoke_throw("Start")
        return data
    end

    local ok, res = xpcall(fn, debug.traceback, req)
    if not ok then
        return false, res
    end
    if not res then
        local errmsg = string.format("user init failed, can not find user %d", req.uid)
        moon.error(errmsg)
        return false, errmsg
    end
    return true
end

function User.Login(req)
    if req.pull then
        return scripts.UserModel.Get().openid
    end

    if state.online then
        context.batch_invoke("Offline")
    end

    local data = scripts.UserModel.MutGet()
    if req.name and #req.name > 0 then
        data.name = req.name
    end
    data.logintime = moon.time()

    context.batch_invoke("Online")
    state.online = true
    return data.openid, data.name
end

function User.Logout()
    context.batch_invoke("Offline")
    return true
end

function User.Init()
end

function User.Start()
end

function User.Online()
end

function User.Offline()
    if not state.online then
        return
    end
    state.online = false
    --- 下线立刻落盘一次
    scripts.UserModel.Save(true)
end

function User.OnHour()
end

function User.OnDay()
end

function User.Exit()
    local ok, err = xpcall(scripts.UserModel.Save, debug.traceback)
    if not ok then
        moon.error("user exit save db error", err)
    end
    moon.quit()
    return true
end

--- 升级所需经验
function User.NextExp(level)
    return 100 + (level - 1) * 50
end

function User.SendPlayerUpdate()
    local data = scripts.UserModel.Get()
    context.Send(CmdCode.S2CPlayerUpdate, {
        level = data.level,
        exp = data.exp,
        coin = data.coin,
    })
end

function User.AddExp(exp)
    if exp <= 0 then
        return
    end
    local data = scripts.UserModel.MutGet()
    data.exp = data.exp + exp
    while data.exp >= User.NextExp(data.level) do
        data.exp = data.exp - User.NextExp(data.level)
        data.level = data.level + 1
    end
    User.SendPlayerUpdate()
end

function User.AddCoin(coin)
    if coin == 0 then
        return
    end
    local data = scripts.UserModel.MutGet()
    data.coin = data.coin + coin
    User.SendPlayerUpdate()
end

--- 组装完整的玩家数据给客户端
function User.BuildPlayerData()
    local data = scripts.UserModel.Get()

    local plots = {}
    for i = 1, GameCfg.constants.plot_count do
        plots[i] = scripts.Farm.ToPlotData(i)
    end

    local items = {}
    for id, count in pairs(data.items) do
        if count > 0 then
            items[#items + 1] = { id = id, count = count }
        end
    end
    table.sort(items, function(a, b) return a.id < b.id end)

    return {
        uid = data.uid,
        name = data.name,
        level = data.level,
        exp = data.exp,
        coin = data.coin,
        plots = plots,
        items = items,
        server_time = moon.now(),
    }
end

function User.C2SPing(req)
    req = req or {}
    context.Send(CmdCode.S2CPong, { time = req.time or 0 })
end

return User
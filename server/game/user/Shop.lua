--- 商店: 买种子/化肥, 卖果实
local common = require("common")
local GameCfg = common.GameCfg
local CmdCode = common.CmdCode
local ErrorCode = common.ErrorCode

---@type user_context
local context = ...
local scripts = context.scripts

---@class Shop
local Shop = {}

function Shop.Init()
end

function Shop.Start()
end

local function valid_count(count)
    count = count or 1
    if count < 1 or count > 999 then
        return nil
    end
    return count
end

---@param req C2SBuy
function Shop.C2SBuy(req)
    req = req or {}
    local cfg = GameCfg.items[req.item_id]
    if not cfg or not cfg.buy_price or cfg.buy_price <= 0 then
        return ErrorCode.ItemNotExist
    end

    local count = valid_count(req.count)
    if not count then
        return ErrorCode.ParamInvalid
    end

    local total = cfg.buy_price * count
    local data = scripts.UserModel.Get()
    if data.coin < total then
        return ErrorCode.CoinNotEnough
    end

    scripts.UserModel.MutGet()
    data.coin = data.coin - total
    scripts.Item.Add(cfg.id, count)
    scripts.User.SendPlayerUpdate()

    context.Send(CmdCode.S2COk, { cmd = CmdCode.C2SBuy })
end

---@param req C2SSell
function Shop.C2SSell(req)
    req = req or {}
    local cfg = GameCfg.items[req.item_id]
    if not cfg or not cfg.sell_price or cfg.sell_price <= 0 then
        return ErrorCode.ItemNotSellable
    end

    local count = valid_count(req.count)
    if not count then
        return ErrorCode.ParamInvalid
    end

    local ok = scripts.Item.Cost(cfg.id, count)
    if ok ~= true then
        return ErrorCode.ItemNotEnough
    end

    local total = cfg.sell_price * count
    local data = scripts.UserModel.MutGet()
    data.coin = data.coin + total
    scripts.User.SendPlayerUpdate()

    context.Send(CmdCode.S2COk, { cmd = CmdCode.C2SSell })
end

return Shop
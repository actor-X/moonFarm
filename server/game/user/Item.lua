--- 背包/道具
local common = require("common")
local GameCfg = common.GameCfg
local CmdCode = common.CmdCode
local ErrorCode = common.ErrorCode

---@type user_context
local context = ...
local scripts = context.scripts

---@class Item
local Item = {}

---@param isnew boolean 是否新玩家
function Item.Init(isnew)
    local data = scripts.UserModel.MutGet()
    if not data.items then
        data.items = {}
    end

    if isnew then
        for _, v in ipairs(GameCfg.constants.initial_items) do
            local id, count = v[1], v[2]
            data.items[id] = (data.items[id] or 0) + count
        end
    end
end

function Item.Start()
end

function Item.Get(id)
    return scripts.UserModel.Get().items[id] or 0
end

--- 增加道具. opt.silent = true 时不推送 S2CItemUpdate
function Item.Add(id, count, opt)
    if not count or count <= 0 then
        return
    end
    local data = scripts.UserModel.MutGet()
    data.items[id] = (data.items[id] or 0) + count
    if not (opt and opt.silent) then
        context.Send(CmdCode.S2CItemUpdate, {
            items = { { id = id, count = data.items[id] } },
        })
    end
end

--- 扣除道具. 成功返回 true, 失败返回错误码
function Item.Cost(id, count, opt)
    if not count or count <= 0 then
        return ErrorCode.ParamInvalid
    end
    local cur = Item.Get(id)
    if cur < count then
        return ErrorCode.ItemNotEnough
    end

    local data = scripts.UserModel.MutGet()
    data.items[id] = cur - count
    if not (opt and opt.silent) then
        context.Send(CmdCode.S2CItemUpdate, {
            items = { { id = id, count = data.items[id] } },
        })
    end
    return true
end

return Item
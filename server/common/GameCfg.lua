--- 静态配置(每个服务独立加载一份只读表)
--- 配置文件用 loadfile 读取, 便于 hotfix/reload 时绕过 require 缓存
local M = {
    crops = {},
    items = {},
    constants = {},
    crops_list = {},
    shop_buy = {},  --- 可购买道具列表
    shop_sell = {}, --- 可出售道具列表
}

local function loadcfg(name)
    local fn = assert(loadfile("common/config/" .. name .. ".lua"))
    return fn()
end

function M.Load()
    M.crops = loadcfg("crops")
    M.items = loadcfg("items")
    M.constants = loadcfg("constants")

    M.crops_list = {}
    for _, v in pairs(M.crops) do
        M.crops_list[#M.crops_list + 1] = v
    end
    table.sort(M.crops_list, function(a, b) return a.id < b.id end)

    M.shop_buy = {}
    M.shop_sell = {}
    for _, v in pairs(M.items) do
        if v.buy_price and v.buy_price > 0 then
            M.shop_buy[#M.shop_buy + 1] = v
        end
        if v.sell_price and v.sell_price > 0 then
            M.shop_sell[#M.shop_sell + 1] = v
        end
    end
    table.sort(M.shop_buy, function(a, b) return a.id < b.id end)
    table.sort(M.shop_sell, function(a, b) return a.id < b.id end)
    return true
end

function M.Reload()
    return M.Load()
end

return M
--- 道具配置表
--- kind: seed(种子) / fruit(果实) / tool(道具)
--- buy_price: 商店售价(0 表示不可购买); sell_price: 可卖出价(0 表示不可出售)
local items = {
    [1001] = { id = 1001, name = "小麦种子", kind = "seed", crop_id = 1, buy_price = 10, sell_price = 0, icon = "🌾" },
    [1002] = { id = 1002, name = "番茄种子", kind = "seed", crop_id = 2, buy_price = 25, sell_price = 0, icon = "🍅" },
    [1003] = { id = 1003, name = "胡萝卜种子", kind = "seed", crop_id = 3, buy_price = 6, sell_price = 0, icon = "🥕" },
    [1004] = { id = 1004, name = "草莓种子", kind = "seed", crop_id = 4, buy_price = 50, sell_price = 0, icon = "🍓" },

    [1101] = { id = 1101, name = "小麦", kind = "fruit", crop_id = 1, buy_price = 0, sell_price = 4, icon = "🌾" },
    [1102] = { id = 1102, name = "番茄", kind = "fruit", crop_id = 2, buy_price = 0, sell_price = 10, icon = "🍅" },
    [1103] = { id = 1103, name = "胡萝卜", kind = "fruit", crop_id = 3, buy_price = 0, sell_price = 3, icon = "🥕" },
    [1104] = { id = 1104, name = "草莓", kind = "fruit", crop_id = 4, buy_price = 0, sell_price = 20, icon = "🍓" },

    [2001] = { id = 2001, name = "化肥", kind = "tool", buy_price = 20, sell_price = 5, icon = "🧪" },
}

return items
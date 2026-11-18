--- 作物配置表
--- grow_seconds 为演示用短周期(真实 QQ 农场以小时计), 便于本地联调
--- seed_item: 播种消耗的道具 id; fruit_item: 收获产出的道具 id
---@class crop_cfg
---@field id integer
---@field name string
---@field seed_item integer
---@field fruit_item integer
---@field grow_seconds integer
---@field yield_min integer
---@field yield_max integer
---@field exp integer
---@field color string 客户端绘制用主色
local crops = {
    [1] = {
        id = 1, name = "小麦", seed_item = 1001, fruit_item = 1101,
        grow_seconds = 45, yield_min = 3, yield_max = 5, exp = 6, color = "#e8c14a",
    },
    [2] = {
        id = 2, name = "番茄", seed_item = 1002, fruit_item = 1102,
        grow_seconds = 90, yield_min = 4, yield_max = 6, exp = 12, color = "#e05b4d",
    },
    [3] = {
        id = 3, name = "胡萝卜", seed_item = 1003, fruit_item = 1103,
        grow_seconds = 20, yield_min = 2, yield_max = 4, exp = 4, color = "#e8873a",
    },
    [4] = {
        id = 4, name = "草莓", seed_item = 1004, fruit_item = 1104,
        grow_seconds = 150, yield_min = 3, yield_max = 5, exp = 20, color = "#e0415f",
    },
}

return crops
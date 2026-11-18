--- 全局数值配置
local constants = {
    --- 地块总数 / 初始解锁数
    plot_count = 12,
    unlocked_plots = 6,

    --- 新玩家初始金币与道具
    initial_coin = 100,
    initial_items = {
        { 1001, 5 }, -- 小麦种子
        { 1003, 3 }, -- 胡萝卜种子
        { 2001, 2 }, -- 化肥
    },

    --- 浇水/施肥对总生长时间的缩短比例
    water_reduce = 0.10,
    fertilizer_reduce = 0.30,

    --- 自动存档间隔(ms)
    save_interval = 5000,
}

return constants
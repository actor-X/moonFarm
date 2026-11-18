--- 游戏逻辑相关定义
local M = {
    --- 自定义协议类型
    PTYPE_C2S = 100, --- client -> server
    PTYPE_S2C = 101, --- server -> client
    PTYPE_SBC = 102, --- server broadcast to client

    --- 地块状态
    PlotState = {
        Locked = 0,
        Empty = 1,
        Growing = 2,
        Ripe = 3,
    },
}

return M
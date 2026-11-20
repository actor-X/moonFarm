--- 客户端/服务器消息码。与 protocol/*.proto 中的消息名一一对应。
--- 新增协议时: 改 proto -> 在下面加一行 -> 同步 client/js/protocol.js 的 CmdCode 表
--- -> 运行 tools/gen_proto_inline.js 重新内嵌 proto 源码。
local M = {
    C2SLogin = 1,
    S2CLogin = 2,
    C2SEnterFarm = 3,
    S2CEnterFarm = 4,
    C2SPlant = 5,
    C2SWater = 6,
    C2SFertilize = 7,
    C2SHarvest = 8,
    C2SBuy = 9,
    C2SSell = 10,
    C2SPing = 11,

    S2COk = 12,
    S2CPlotUpdate = 13,
    S2CHarvest = 14,
    S2CItemUpdate = 15,
    S2CPlayerUpdate = 16,
    S2CPong = 17,
    S2CErrorCode = 18,

    --- 批量操作(一键收获/一键种植). 新增于收获 UI 改造, 旧客户端不受影响.
    C2SHarvestAll = 19,
    S2CHarvestAll = 20,
    C2SPlantAll = 21,
    S2CPlantAll = 22,
}

--- 预留: 以后加社交/房间时, 可在这里指定 C2S 消息转发到哪个服务
--- 目前所有 C2S 都直接由玩家自己的 user 服务处理
local forward = {}

local mt = { forward = forward }

mt.__newindex = function(_, name, _)
    error("attempt to add unknown CmdCode: " .. tostring(name))
end

mt.__index = function(_, name)
    if name == "forward" then
        return forward
    end
    error(debug.traceback("unknown CmdCode: " .. tostring(name), 2))
end

return setmetatable(M, mt)
--- 业务错误码. handler 直接 return 这些数字, 框架会自动下发 S2CErrorCode.
---@enum ErrorCode
local ErrorCode = {
    None = 0,
    ServerInternalError = 1,
    ParamInvalid = 2,
    ConfigError = 3,

    PlotNotFound = 101,
    PlotLocked = 102,
    PlotNotEmpty = 103,
    PlotEmpty = 104,
    CropNotExist = 105,
    NotRipe = 106,
    ItemNotEnough = 107,
    CoinNotEnough = 108,
    AlreadyWatered = 109,
    AlreadyFertilized = 110,
    ItemNotSellable = 111,
    SeedNotEnough = 112,
    NothingToHarvest = 113,
    NotGrowing = 114,
    NoEmptyPlot = 115,
}

return ErrorCode
--- 农场核心逻辑: 地块 / 种植 / 浇水 / 施肥 / 收获
local moon = require("moon")
local common = require("common")
local GameCfg = common.GameCfg
local CmdCode = common.CmdCode
local ErrorCode = common.ErrorCode
local GameDef = common.GameDef

---@type user_context
local context = ...
local scripts = context.scripts

local S = GameDef.PlotState

---@class Farm
local Farm = {}

function Farm.Init(isnew)
    local data = scripts.UserModel.MutGet()
    if not data.plots then
        data.plots = {}
    end

    for i = 1, GameCfg.constants.plot_count do
        if not data.plots[i] then
            data.plots[i] = {
                state = (i <= GameCfg.constants.unlocked_plots) and S.Empty or S.Locked,
            }
        end
    end

    math.randomseed(os.time() + (context.uid or 0) + (isnew and 1 or 0))
end

function Farm.Start()
end

--- 地块显示状态(生长中到点自动视为成熟)
local function state_of(p, nowms)
    if p.state == S.Growing and nowms >= p.ready_at then
        return S.Ripe
    end
    return p.state
end

--- 转成协议结构
function Farm.ToPlotData(index)
    local nowms = moon.now()
    local data = scripts.UserModel.Get()
    local p = data.plots[index]
    if not p then
        return { index = index, state = S.Locked }
    end

    local state = state_of(p, nowms)
    local crop = p.crop_id and GameCfg.crops[p.crop_id] or nil

    local progress, stage = 0, 0
    if p.state == S.Growing or p.state == S.Ripe then
        local total = (p.ready_at or 0) - (p.planted_at or 0)
        if total <= 0 then
            progress = 1
        else
            progress = (nowms - p.planted_at) / total
        end
        if progress < 0 then
            progress = 0
        elseif progress > 1 then
            progress = 1
        end
        stage = math.floor(progress * 3)
        if stage > 2 then
            stage = 2
        end
        if state == S.Ripe then
            progress = 1
            stage = 2
        end
    end

    return {
        index = index,
        state = state,
        crop_id = p.crop_id or 0,
        planted_at = p.planted_at or 0,
        ready_at = p.ready_at or 0,
        watered = p.watered or false,
        fertilized = p.fertilized or false,
        stage = stage,
        progress = progress,
    }
end

local function get_plot(index)
    if type(index) ~= "number" then
        return nil
    end
    local data = scripts.UserModel.Get()
    local p = data.plots[index]
    if not p then
        return nil
    end
    return p, data
end

function Farm.C2SEnterFarm()
    context.Send(CmdCode.S2CEnterFarm, { data = scripts.User.BuildPlayerData() })
end

---@param req C2SPlant
function Farm.C2SPlant(req)
    req = req or {}
    local index = req.index
    local crop_id = req.crop_id
    local crop = GameCfg.crops[crop_id]
    if not crop then
        return ErrorCode.CropNotExist
    end

    local p = get_plot(index)
    if not p then
        return ErrorCode.PlotNotFound
    end

    local nowms = moon.now()
    local state = state_of(p, nowms)
    if state == S.Locked then
        return ErrorCode.PlotLocked
    end
    if state ~= S.Empty then
        return ErrorCode.PlotNotEmpty
    end

    local ok = scripts.Item.Cost(crop.seed_item, 1)
    if ok ~= true then
        return ErrorCode.SeedNotEnough
    end

    scripts.UserModel.MutGet()
    p.state = S.Growing
    p.crop_id = crop_id
    p.planted_at = nowms
    p.ready_at = nowms + crop.grow_seconds * 1000
    p.watered = false
    p.fertilized = false

    context.Send(CmdCode.S2CPlotUpdate, { plot = Farm.ToPlotData(index) })
    context.Send(CmdCode.S2COk, { cmd = CmdCode.C2SPlant })
end

---@param req C2SWater
function Farm.C2SWater(req)
    req = req or {}
    local index = req.index
    local p = get_plot(index)
    if not p then
        return ErrorCode.PlotNotFound
    end

    local nowms = moon.now()
    if state_of(p, nowms) ~= S.Growing then
        return ErrorCode.NotGrowing
    end
    if p.watered then
        return ErrorCode.AlreadyWatered
    end

    local crop = GameCfg.crops[p.crop_id]
    if not crop then
        return ErrorCode.CropNotExist
    end

    scripts.UserModel.MutGet()
    local reduce = crop.grow_seconds * 1000 * GameCfg.constants.water_reduce
    p.ready_at = math.max(nowms, p.ready_at - reduce)
    p.watered = true

    context.Send(CmdCode.S2CPlotUpdate, { plot = Farm.ToPlotData(index) })
    scripts.User.AddExp(1)
    context.Send(CmdCode.S2COk, { cmd = CmdCode.C2SWater })
end

---@param req C2SFertilize
function Farm.C2SFertilize(req)
    req = req or {}
    local index = req.index
    local p = get_plot(index)
    if not p then
        return ErrorCode.PlotNotFound
    end

    local nowms = moon.now()
    if state_of(p, nowms) ~= S.Growing then
        return ErrorCode.NotGrowing
    end
    if p.fertilized then
        return ErrorCode.AlreadyFertilized
    end

    local crop = GameCfg.crops[p.crop_id]
    if not crop then
        return ErrorCode.CropNotExist
    end

    --- 化肥道具 id = 2001
    local ok = scripts.Item.Cost(2001, 1)
    if ok ~= true then
        return ErrorCode.ItemNotEnough
    end

    scripts.UserModel.MutGet()
    local reduce = crop.grow_seconds * 1000 * GameCfg.constants.fertilizer_reduce
    p.ready_at = math.max(nowms, p.ready_at - reduce)
    p.fertilized = true

    context.Send(CmdCode.S2CPlotUpdate, { plot = Farm.ToPlotData(index) })
    scripts.User.AddExp(1)
    context.Send(CmdCode.S2COk, { cmd = CmdCode.C2SFertilize })
end

---@param req C2SHarvest
function Farm.C2SHarvest(req)
    req = req or {}
    local index = req.index
    local p = get_plot(index)
    if not p then
        return ErrorCode.PlotNotFound
    end

    local nowms = moon.now()
    if p.state ~= S.Growing and p.state ~= S.Ripe then
        return ErrorCode.NothingToHarvest
    end
    if state_of(p, nowms) ~= S.Ripe then
        return ErrorCode.NotRipe
    end

    local crop = GameCfg.crops[p.crop_id]
    if not crop then
        return ErrorCode.CropNotExist
    end

    local count = math.random(crop.yield_min, crop.yield_max)

    scripts.UserModel.MutGet()
    p.state = S.Empty
    p.crop_id = 0
    p.planted_at = 0
    p.ready_at = 0
    p.watered = false
    p.fertilized = false

    local gained = { { id = crop.fruit_item, count = count } }
    scripts.Item.Add(crop.fruit_item, count)
    scripts.User.AddExp(crop.exp)

    local plot = Farm.ToPlotData(index)
    context.Send(CmdCode.S2CPlotUpdate, { plot = plot })
    context.Send(CmdCode.S2CHarvest, {
        plot = plot,
        items = gained,
        exp = crop.exp,
    })
    context.Send(CmdCode.S2COk, { cmd = CmdCode.C2SHarvest })
end

return Farm
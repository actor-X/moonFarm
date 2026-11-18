--- 玩家数据模型: 内存数据 + 定时/下线/退出时写 Redis
local moon = require("moon")
local common = require("common")
local GameCfg = common.GameCfg
local Database = common.Database

---@type user_context
local context = ...

local dirty = false
local DBData

---@class UserModel
local UserModel = {}

function UserModel.Create(data)
    if DBData then
        return DBData
    end
    DBData = data

    moon.async(function()
        while true do
            moon.sleep(GameCfg.constants.save_interval)
            if dirty then
                local ok, err = xpcall(UserModel.Save, debug.traceback, true)
                if not ok then
                    moon.error("auto save user failed:", err)
                end
            end
        end
    end)

    return data
end

---@param checkDirty? boolean 为 true 时只有脏数据才写
function UserModel.Save(checkDirty)
    if not DBData then
        return
    end
    if checkDirty and not dirty then
        return
    end
    Database.saveuser(context.addr_db, DBData.uid, DBData)
    dirty = false
end

--- 只读访问
function UserModel.Get()
    return DBData
end

--- 修改数据时用这个, 会自动标记脏数据
function UserModel.MutGet()
    dirty = true
    return DBData
end

return UserModel
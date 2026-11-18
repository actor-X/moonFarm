local moon = require("moon")
local setup = require("common.setup")

---@class auth_context:base_context
---@field uid_map table<integer, table>
local context = {
    uid_map = {},
}

local command = setup(context, "auth")

--- 热更时把补丁推给所有在线玩家服务
---@diagnostic disable-next-line: duplicate-set-field
command.hotfix = function(names)
    for _, u in pairs(context.uid_map) do
        moon.send("lua", u.addr_user, "hotfix", names)
    end
end

return context
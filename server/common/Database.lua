--- Redis 存档访问封装
--- 数据结构:
---   farm:uid_seq  string -> 下一个玩家 uid (INCR)
---   farm:openid   hash   openid -> uid
---   farm:users    hash   uid -> 玩家数据(JSON)
local moon = require("moon")
local json = require("json")
local redisd = require("redisd")

local jencode = json.encode
local jdecode = json.decode

local M = {}

M.KEY_UID_SEQ = "farm:uid_seq"
M.KEY_OPENID = "farm:openid"
M.KEY_USERS = "farm:users"

local function call(addr_db, ...)
    local res, err = redisd.call(addr_db, ...)
    if res == false then
        error(tostring(err))
    end
    return res
end

function M.getuidbyopenid(addr_db, openid)
    local res = call(addr_db, "hget", M.KEY_OPENID, openid)
    if res then
        return math.tointeger(res)
    end
    return nil
end

function M.createuid(addr_db, openid)
    local uid = math.tointeger(call(addr_db, "incr", M.KEY_UID_SEQ))
    call(addr_db, "hset", M.KEY_OPENID, openid, uid)
    return uid
end

function M.loaduser(addr_db, uid)
    local res = call(addr_db, "hget", M.KEY_USERS, tostring(uid))
    if res and #res > 0 then
        return jdecode(res)
    end
    return nil
end

function M.saveuser(addr_db, uid, data)
    redisd.send(addr_db, "hset", M.KEY_USERS, tostring(uid), jencode(data))
end

return M
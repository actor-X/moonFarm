--- 服务端配置
--- 默认连接本机 Redis(127.0.0.1:6379, 无密码)。
--- 覆盖方式, 优先级从低到高:
---   1. 本文件的默认值
---   2. server/serverconf.local.lua(本机私有配置, 已 gitignore)
---   3. 环境变量: FARM_REDIS_HOST / FARM_REDIS_PORT / FARM_REDIS_AUTH
---              FARM_REDIS_TIMEOUT / FARM_HOST / FARM_PORT
local function env(name)
    local v = os.getenv(name)
    if v == "" then
        return nil
    end
    return v
end

--- 本机私有配置; 文件不存在时返回空表
local function load_local()
    local f = io.open("serverconf.local.lua", "rb")
    if not f then
        return {}
    end
    f:close()
    local conf = dofile("serverconf.local.lua")
    assert(type(conf) == "table", "serverconf.local.lua 必须返回 table")
    return conf
end

local local_conf = load_local()

local redis = {
    host = "127.0.0.1",
    port = 6379,
    timeout = 5000,
    --- db = 0,
}

for k, v in pairs(local_conf.redis or {}) do
    redis[k] = v
end

local conf = {
    --- gate 监听的 TCP 端口; WebSocket 端口 = port + 1
    host = local_conf.host or "0.0.0.0",
    port = local_conf.port or 9001,
    redis = redis,
}

--- 环境变量优先级最高; FARM_REDIS_AUTH= 空串表示无密码
redis.host = env("FARM_REDIS_HOST") or redis.host
redis.port = tonumber(env("FARM_REDIS_PORT")) or redis.port
redis.timeout = tonumber(env("FARM_REDIS_TIMEOUT")) or redis.timeout

local auth_env = os.getenv("FARM_REDIS_AUTH")
if auth_env ~= nil then
    redis.auth = (auth_env ~= "" and auth_env) or nil
end

conf.host = env("FARM_HOST") or conf.host
conf.port = tonumber(env("FARM_PORT")) or conf.port

return conf
---__init__
if _G["__init__"] then
    return {
        thread = 4,
        enable_stdout = true,
        logfile = string.format("log/farm-%s.log", os.date("%Y-%m-%d-%H-%M-%S")),
        loglevel = "INFO",
        path = table.concat({
            "./?.lua",
            "./?/init.lua",
            "./lualib/?.lua",
            "./service/?.lua",
        }, ";")
    }
end

local moon = require("moon")
local pb = require("pb")
local protoc = require("protoc")
local serverconf = require("serverconf")

--- 读 proto 文件并把多个文件合并成一份 schema 加载(去掉 import 行)
local function readfile(path)
    local f = assert(io.open(path, "rb"))
    local content = f:read("*a")
    f:close()
    return content
end

local function stripload(src)
    src = src:gsub('import%s+"[^"]+"%s*;%s*', '')
    src = src:gsub('option%s+[^;]+;%s*', '')
    return src
end

local common_src = stripload(readfile("protocol/common.proto"))
local farm_src = stripload(readfile("protocol/farm.proto"))
--- 合并成一份 schema, 只保留第一个 syntax 声明
farm_src = farm_src:gsub('syntax%s*=%s*"proto3"%s*;%s*', '')
local schema = common_src .. "\n" .. farm_src

assert(protoc:load(schema), "load protobuf schema failed")
--- 加载一次, 其它服务的 lua state 共享
pb.share_state()

local services = {
    {
        unique = true,
        name = "db",
        file = "service/redisd.lua",
        threadid = 1,
        poolsize = 5,
        opts = serverconf.redis,
    },
    {
        unique = true,
        name = "auth",
        file = "game/service_auth.lua",
        threadid = 2,
    },
    {
        unique = true,
        name = "gate",
        file = "game/service_gate.lua",
        host = serverconf.host,
        port = serverconf.port,
        threadid = 3,
    },
}

local server_ok = false

moon.async(function()
    for _, conf in ipairs(services) do
        local addr = moon.new_service(conf)
        if addr == 0 then
            moon.error("create service failed:", conf.name)
            moon.exit(-1)
            return
        end
    end

    local ok, err = xpcall(function()
        assert(moon.call("lua", moon.queryservice("auth"), "Init"))
        assert(moon.call("lua", moon.queryservice("gate"), "Init"))
        assert(moon.call("lua", moon.queryservice("gate"), "Start"))
    end, debug.traceback)

    if not ok then
        moon.error("server init failed\n", err)
        moon.exit(-1)
        return
    end

    server_ok = true
    print("MoonFarm server started.")
end)

moon.shutdown(function()
    print("receive shutdown")
    moon.async(function()
        if server_ok then
            assert(moon.call("lua", moon.queryservice("gate"), "Gate.Shutdown"))
            assert(moon.call("lua", moon.queryservice("auth"), "Auth.Shutdown"))
            moon.send("lua", moon.queryservice("db"), "save_then_quit")

            --- 等待所有服务退出
            while true do
                local size = moon.server_stats("service.count")
                if size == 2 then
                    break
                end
                moon.sleep(200)
                print("bootstrap wait all service quit, now count:", size)
            end
        else
            moon.exit(-1)
        end
        moon.quit()
    end)
end)
local moon = require "moon"
local pb = require "pb"
local buffer = require "buffer"
local seri = require "seri"
local CmdCode = require "common.CmdCode"

local concats = buffer.concat_string
local concat = buffer.concat

local pencode = pb.encode
local pdecode = pb.decode

local bunpack = buffer.unpack

local type = type

-- 消息码 -> 消息名
local id_name = {}
-- 消息码 -> 2 字节帧头缓存
local id_bytes = {}

for k, v in pairs(CmdCode) do
    assert(not id_name[v], "msgcode repeated")
    id_name[v] = k
    id_bytes[v] = string.pack("<H", v)
end

local M = {}

---@param uid integer
---@param id integer|string
---@param t table|nil
---@return string
function M.encode(uid, id, t)
    if type(id) == 'string' then
        id = CmdCode[id]
    end
    local bytes = id_bytes[id]
    if t then
        local name = id_name[id]
        if not name then
            error("Unknown cmdcode: " .. tostring(id))
        end
        return concat(seri.packs(uid), bytes, pencode(name, t))
    else
        return seri.packs(uid) .. bytes
    end
end

function M.encodestring(id, t)
    if type(id) == 'string' then
        id = CmdCode[id]
    end
    local bytes = id_bytes[id]
    if t then
        local name = id_name[id]
        assert(name, id)
        return concats(bytes, pencode(name, t))
    else
        return bytes
    end
end

--- 解码 client -> server 帧(带 uid 前缀)
function M.decode(buf)
    local id, p, n = bunpack(buf, "<HC")
    local name = id_name[id]
    if not name then
        error(string.format("Received unknown message CmdCode: %d. The client and server versions might not match.", id))
    end
    return name, pdecode(name, p, n)
end

--- 解码不带 uid 的帧(用于 gate 的首个登录包)
function M.decodestring(data)
    local id = string.unpack("<H", data)
    local pbdata = string.sub(data, 3)
    local name = id_name[id]
    if not name then
        error(string.format("Received unknown message CmdCode: %d.", id))
    end
    return name, pdecode(name, pbdata), id
end

---@return string
function M.name(id)
    return id_name[id]
end

return M
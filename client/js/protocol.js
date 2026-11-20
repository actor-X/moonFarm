(function (global) {
    'use strict';

    // ============================================================
    // 消息码表 —— 与 server/common/CmdCode.lua 保持一致
    // 帧格式(WS): [cmd LE 2字节][protobuf 消息体]
    // ============================================================
    const CmdCode = {
        C2SLogin: 1,
        S2CLogin: 2,
        C2SEnterFarm: 3,
        S2CEnterFarm: 4,
        C2SPlant: 5,
        C2SWater: 6,
        C2SFertilize: 7,
        C2SHarvest: 8,
        C2SBuy: 9,
        C2SSell: 10,
        C2SPing: 11,
        S2COk: 12,
        S2CPlotUpdate: 13,
        S2CHarvest: 14,
        S2CItemUpdate: 15,
        S2CPlayerUpdate: 16,
        S2CPong: 17,
        S2CErrorCode: 18,
        C2SHarvestAll: 19,
        S2CHarvestAll: 20,
        C2SPlantAll: 21,
        S2CPlantAll: 22,
    };

    if (typeof Long !== 'undefined' && protobuf.util && !protobuf.util.Long) {
        protobuf.util.Long = Long;
    }

    function clean(src) {
        return src
            .replace(/^\s*syntax\s*=\s*"[^"]*"\s*;[^\r\n]*$/gm, '')
            .replace(/^\s*import\s+[^;]+;[^\r\n]*$/gm, '')
            .trim();
    }

    let root = null;

    function buildRoot() {
        if (root) return root;
        const sources = global.MOON_PROTO_SOURCES;
        const text = 'syntax = "proto3";\n' +
            ['common.proto', 'farm.proto']
                .map(n => clean(sources[n])).join('\n');
        root = protobuf.parse(text, { keepCase: true }).root;
        return root;
    }

    function type(name) {
        return buildRoot().lookupType(name);
    }

    // 消息名 -> 发送帧
    function pack(name, obj) {
        const id = CmdCode[name];
        if (id === undefined) throw new Error('unknown message: ' + name);
        let body = new Uint8Array(0);
        if (obj && Object.keys(obj).length > 0) {
            body = type(name).encode(obj).finish();
        }
        const frame = new Uint8Array(2 + body.length);
        frame[0] = id & 0xff;
        frame[1] = (id >> 8) & 0xff;
        frame.set(body, 2);
        return frame;
    }

    // 帧 -> { id, name, data }
    function unpack(buf) {
        if (!buf || buf.length < 2) throw new Error('frame too short');
        const id = (buf[1] << 8) | buf[0];
        const name = id2name(id);
        if (!name) throw new Error('unknown cmdcode: ' + id);
        let data = {};
        if (buf.length > 2) {
            const t = type(name);
            data = t.toObject(t.decode(new Uint8Array(buf.buffer, buf.byteOffset + 2, buf.length - 2)), {
                longs: String,
                defaults: true,
            });
        }
        return { id, name, data };
    }

    const id2nameCache = {};
    function id2name(id) {
        if (id2nameCache[id] !== undefined) return id2nameCache[id];
        for (const k in CmdCode) {
            if (CmdCode[k] === id) return (id2nameCache[id] = k);
        }
        return null;
    }

    global.Protocol = { CmdCode, buildRoot, type, pack, unpack, id2name };
})(globalThis);
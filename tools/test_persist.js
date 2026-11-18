// 存档测试: 登录 -> 播种 -> 断开 -> 用同一 openid 重新登录 -> 地块仍在生长
// 运行: node tools/test_persist.js [host] [port]
'use strict';

global.window = globalThis;
global.Long = require('../client/js/vendor/long.min.js');
const pb = require('../client/js/vendor/protobuf.min.js');
pb.util.Long = global.Long;
global.protobuf = pb;

require('../client/js/proto-inline.js');
require('../client/js/protocol.js');
require('../client/js/net.js');

const HOST = process.argv[2] || '127.0.0.1';
const PORT = parseInt(process.argv[3] || '9002', 10);

let pass = 0, fail = 0;
function ok(cond, label, extra) {
    if (cond) { pass++; console.log('  ✔', label); }
    else { fail++; console.log('  ✘', label, extra === undefined ? '' : extra); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function session(openid, name) {
    const net = new Net();
    await net.connect(`ws://${HOST}:${PORT}/`);
    const lr = await net.call('C2SLogin', { openid, name }, 'S2CLogin');
    if (!lr.ok) throw new Error('login failed');
    const fr = await net.call('C2SEnterFarm', {}, 'S2CEnterFarm');
    if (!fr.ok) throw new Error('enter failed');
    return { net, data: fr.data.data };
}

(async function main() {
    const openid = 'persist_' + Date.now();
    console.log('Persist test:', openid);

    let s = await session(openid, '存档测试');
    const uid1 = s.data.uid;
    ok(s.data.plots.filter(p => p.state === 1).length === 6, '新号 6 块空地');
    const plot = s.data.plots.find(p => p.state === 1);
    let r = await s.net.call('C2SPlant', { index: plot.index, crop_id: 3 }, 'S2COk');
    ok(r.ok, '播种');
    const coin = Number(s.data.coin);

    // 主动断开, 触发下线落盘
    s.net.close();
    await sleep(800);

    s = await session(openid, '存档测试');
    const p2 = s.data.plots.find(p => p.index === plot.index);
    ok(p2 && p2.state === 2 && p2.crop_id === 3, '重连后种植状态仍在', p2);
    ok(Number(s.data.coin) === coin, '金币一致', { before: coin, after: s.data.coin });
    ok(s.data.uid === uid1, 'uid 稳定', { before: uid1, after: s.data.uid });

    console.log(`\n结果: ${pass} passed, ${fail} failed`);
    s.net.close();
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('Persist test failed:', e && e.stack || e);
    process.exit(1);
});
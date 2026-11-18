// 真实服务器端到端测试: 登录 -> 进农场 -> 播种 -> 浇水/施肥 -> 收获 -> 卖果实 -> 买化肥
// 前提: server 已启动 (ws://127.0.0.1:9002/)
// 运行: node tools/test_e2e.js [host] [port]
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
function withTimeout(p, ms, msg) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || '超时')), ms))]);
}

(async function main() {
    console.log('E2E:', `ws://${HOST}:${PORT}/`);
    const net = new Net();

    await withTimeout(net.connect(`ws://${HOST}:${PORT}/`), 6000, '连接超时');
    ok(true, 'WebSocket 连接成功');

    const openid = 'e2e_' + Date.now();
    const lr = await withTimeout(net.call('C2SLogin', { openid, name: 'E2E测试' }, 'S2CLogin'), 8000, '登录超时');
    ok(lr.ok && lr.data && lr.data.ok, '登录成功', lr);
    const uid = lr.data && lr.data.uid;

    const fr = await withTimeout(net.call('C2SEnterFarm', {}, 'S2CEnterFarm'), 8000, '进入农场超时');
    ok(fr.ok, '拉取农场数据');
    const data = fr.data.data;
    ok(Array.isArray(data.plots) && data.plots.length === 12, '地块数量 = 12', data.plots && data.plots.length);
    ok(data.plots.filter(p => p.state === 0).length === 6, '初始锁定 6 块');
    ok(data.plots.filter(p => p.state === 1).length === 6, '初始空地 6 块');

    const items = {};
    (data.items || []).forEach(it => { items[Number(it.id)] = Number(it.count); });
    ok((items[1003] || 0) >= 1, '新玩家有胡萝卜种子', items[1003]);

    let player = { level: Number(data.level), exp: Number(data.exp), coin: Number(data.coin) };
    const plotUpdates = [];
    const harvestMsgs = [];
    net.on('S2CPlotUpdate', m => plotUpdates.push(m.plot));
    net.on('S2CHarvest', m => harvestMsgs.push(m));
    net.on('S2CItemUpdate', m => (m.items || []).forEach(it => { items[Number(it.id)] = Number(it.count); }));
    net.on('S2CPlayerUpdate', m => {
        player = { level: Number(m.level), exp: Number(m.exp), coin: Number(m.coin) };
    });

    let plot = data.plots.find(p => p.state === 1);
    ok(!!plot, '找到一块空地');
    const index = plot.index;

    let r = await net.call('C2SPlant', { index, crop_id: 3 }, 'S2COk');
    ok(r.ok, '播种胡萝卜');
    let last = plotUpdates.filter(p => p.index === index).pop();
    ok(last && last.state === 2 && last.crop_id === 3, '地块进入生长状态');

    r = await net.call('C2SWater', { index }, 'S2COk');
    ok(r.ok, '浇水');
    last = plotUpdates.filter(p => p.index === index).pop();
    ok(last && last.watered === true, '浇水标记已同步');

    r = await net.call('C2SFertilize', { index }, 'S2COk');
    ok(r.ok, '施肥');
    last = plotUpdates.filter(p => p.index === index).pop();
    ok(last && last.fertilized === true, '施肥标记已同步');
    ok((items[2001] || 0) === 1, '化肥扣减 1');

    const readyAt = Number((last && last.ready_at) || 0);
    const waitMs = Math.max(0, readyAt - Date.now()) + 500;
    console.log('  ... 等待作物成熟', Math.round(waitMs / 1000) + 's');
    await sleep(Math.min(waitMs, 40000));

    r = await net.call('C2SHarvest', { index }, 'S2COk');
    ok(r.ok, '收获');
    ok(harvestMsgs.length === 1, '收到 S2CHarvest 推送');
    const h = harvestMsgs[0];
    ok(h && h.items && Number(h.items[0].id) === 1103 && Number(h.items[0].count) > 0, '收获胡萝卜果实', h && h.items);
    ok((items[1103] || 0) > 0, '背包里有胡萝卜');
    last = plotUpdates.filter(p => p.index === index).pop();
    ok(last && last.state === 1, '收获后地块恢复空地');

    const fruitCount = items[1103] || 0;
    const coinBefore = player.coin;
    r = await net.call('C2SSell', { item_id: 1103, count: fruitCount }, 'S2COk');
    ok(r.ok, '卖出全部胡萝卜');
    ok(player.coin === coinBefore + fruitCount * 3, '金币增加正确', { before: coinBefore, after: player.coin, fruitCount });
    ok((items[1103] || 0) === 0, '胡萝卜已清空');

    const coin1 = player.coin;
    r = await net.call('C2SBuy', { item_id: 2001, count: 1 }, 'S2COk');
    ok(r.ok, '购买化肥');
    ok(player.coin === coin1 - 20, '购买扣款正确');
    ok((items[2001] || 0) === 2, '化肥数量 +1');

    // 错误路径: 给未解锁地块播种应返回 PlotLocked(102)
    const locked = data.plots.find(p => p.state === 0);
    r = await net.call('C2SPlant', { index: locked.index, crop_id: 3 }, 'S2COk');
    ok(!r.ok && Number(r.data.code) === 102, '未解锁地块播种被拒绝 (102)', r);

    console.log(`\n结果: ${pass} passed, ${fail} failed  (uid=${uid})`);
    net.close();
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('E2E failed:', e && e.stack || e);
    process.exit(1);
});
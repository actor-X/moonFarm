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
    const harvestAllMsgs = [];
    const plantAllMsgs = [];
    let itemUpdateCount = 0;
    net.on('S2CPlotUpdate', m => plotUpdates.push(m.plot));
    net.on('S2CHarvest', m => harvestMsgs.push(m));
    net.on('S2CHarvestAll', m => harvestAllMsgs.push(m));
    net.on('S2CPlantAll', m => plantAllMsgs.push(m));
    net.on('S2CItemUpdate', m => { itemUpdateCount++; (m.items || []).forEach(it => { items[Number(it.id)] = Number(it.count); }); });
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

    // ================= 一键种植 / 一键收获 =================
    const latestPlot = (i) => plotUpdates.filter(p => Number(p.index) === Number(i)).pop();
    const emptyIdx = [];
    for (let i = 1; i <= 12; i++) {
        const p = latestPlot(i) || data.plots[i - 1];
        if (Number(p.state) === 1) emptyIdx.push(i);
    }
    ok(emptyIdx.length >= 2, '存在多块空地供批量种植', emptyIdx);

    const seedsBefore = items[1003] || 0;
    const puBeforePlant = plotUpdates.length;
    const iuBeforePlant = itemUpdateCount;
    r = await net.call('C2SPlantAll', { crop_id: 3, indices: emptyIdx }, 'S2COk');
    ok(r.ok, '一键种植请求成功', r);
    ok(plantAllMsgs.length === 1, '收到 S2CPlantAll 推送');
    const pa = plantAllMsgs[0];
    const expectPlanted = Math.min(emptyIdx.length, seedsBefore);
    ok(Number(pa.planted) === expectPlanted, '实际种植块数 = min(空地数, 种子数)', { planted: pa.planted, empty: emptyIdx.length, seeds: seedsBefore });
    ok(pa.plots.length === expectPlanted, 'S2CPlantAll 带回的地块数一致', pa.plots && pa.plots.length);
    ok(pa.plots.every(p => Number(p.state) === 2 && Number(p.crop_id) === 3), '批量种植后地块进入生长中');
    ok((items[1003] || 0) === seedsBefore - expectPlanted, '种子按实际种植块数扣减');
    ok(itemUpdateCount === iuBeforePlant + 1, '批量种植只推 1 条背包更新', itemUpdateCount - iuBeforePlant);
    ok(plotUpdates.length === puBeforePlant, '批量种植不逐块推 S2CPlotUpdate', plotUpdates.length - puBeforePlant);

    // 没有种子(草莓 1004 初始为 0) -> SeedNotEnough(112)
    r = await net.call('C2SPlantAll', { crop_id: 4, indices: emptyIdx }, 'S2COk');
    ok(!r.ok && Number(r.data.code) === 112, '没有种子时批量种植被拒绝 (112)', r);

    // 只传锁定地块 -> NoEmptyPlot(115)
    const lockedPlots = data.plots.filter(p => p.state === 0).map(p => p.index);
    r = await net.call('C2SPlantAll', { crop_id: 3, indices: lockedPlots }, 'S2COk');
    ok(!r.ok && Number(r.data.code) === 115, '没有合法空地时批量种植被拒绝 (115)', r);

    // 空列表 -> ParamInvalid(2)
    r = await net.call('C2SPlantAll', { crop_id: 3, indices: [] }, 'S2COk');
    ok(!r.ok && Number(r.data.code) === 2, '空地块列表被拒绝 (2)', r);

    // 等这批作物成熟
    const batchReady = Math.max(0, Number(pa.plots[0].ready_at) - Date.now()) + 900;
    console.log('  ... 等待批量作物成熟', Math.round(batchReady / 1000) + 's');
    await sleep(Math.min(batchReady, 40000));

    const expBeforeBatch = player.exp;
    const levelBeforeBatch = player.level;
    const fruitsBefore = items[1103] || 0;
    const puBeforeHarvest = plotUpdates.length;
    const iuBeforeHarvest = itemUpdateCount;
    r = await net.call('C2SHarvestAll', {}, 'S2COk');
    ok(r.ok, '一键收获请求成功', r);
    ok(harvestAllMsgs.length === 1, '收到 S2CHarvestAll 推送');
    const ha = harvestAllMsgs[0];
    ok(ha.plots.length === expectPlanted, '一键收获带回全部成熟地', ha.plots && ha.plots.length);
    ok(ha.plots.every(p => Number(p.state) === 1), '一键收获后地块全部恢复空地');
    ok(ha.items.length === 1 && Number(ha.items[0].id) === 1103, '果实按 id 合并成一条', ha.items);
    ok(Number(ha.items[0].count) >= expectPlanted * 2, '产量为每块随机产量之和', ha.items[0].count);
    ok(Number(ha.exp_total) === expectPlanted * 4, '总经验 = 每块经验之和', ha.exp_total);
    ok((items[1103] || 0) === fruitsBefore + Number(ha.items[0].count), '背包果实与收获量一致');
    ok(player.exp !== expBeforeBatch || player.level > levelBeforeBatch, '经验/等级已推送');
    ok(itemUpdateCount === iuBeforeHarvest + 1, '批量收获只推 1 条背包更新', itemUpdateCount - iuBeforeHarvest);
    ok(plotUpdates.length === puBeforeHarvest, '批量收获不逐块推 S2CPlotUpdate', plotUpdates.length - puBeforeHarvest);

    // 再收一次 -> NothingToHarvest(113)
    r = await net.call('C2SHarvestAll', {}, 'S2COk');
    ok(!r.ok && Number(r.data.code) === 113, '无成熟作物时一键收获被拒绝 (113)', r);

    console.log(`\n结果: ${pass} passed, ${fail} failed  (uid=${uid})`);
    net.close();
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('E2E failed:', e && e.stack || e);
    process.exit(1);
});

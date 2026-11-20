// 登录/顶号并发测试
// 前提: server 已启动 (ws://127.0.0.1:9002/), 且能读到服务端日志(用于确认 user 服务数量)
// 运行: node tools/test_login_concurrency.js [host] [port] [logfile]
'use strict';

global.window = globalThis;
global.Long = require('../client/js/vendor/long.min.js');
const pb = require('../client/js/vendor/protobuf.min.js');
pb.util.Long = global.Long;
global.protobuf = pb;

require('../client/js/proto-inline.js');
require('../client/js/protocol.js');
require('../client/js/net.js');

const fs = require('fs');
const path = require('path');

const HOST = process.argv[2] || '127.0.0.1';
const PORT = parseInt(process.argv[3] || '9002', 10);
const URL = `ws://${HOST}:${PORT}/`;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
    if (cond) { pass++; console.log('  ✔', label); }
    else { fail++; console.log('  ✘', label, extra === undefined ? '' : extra); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function safe(p) {
    return Promise.resolve(p).then(v => ({ resolved: true, value: v }), e => ({ resolved: false, error: e }));
}

function newestLogFile() {
    const dir = path.join(__dirname, '..', 'server', 'log');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('farm-') && f.endsWith('.log'))
        .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    return files.length ? path.join(dir, files[0].f) : null;
}

const LOG = process.argv[4] || newestLogFile();

// 某个 uid 的 user 服务被创建了几次
function countUserService(uid) {
    if (!LOG || !fs.existsSync(LOG)) return -1;
    const text = fs.readFileSync(LOG, 'utf8');
    const re = new RegExp('new service \\[user' + uid + '\\]', 'g');
    return (text.match(re) || []).length;
}

async function connect() {
    const net = new Net();
    await net.connect(URL);
    return net;
}

function login(net, openid, name, timeout) {
    return safe(net.call('C2SLogin', { openid, name }, 'S2CLogin', { timeout: timeout || 8000 }));
}

function resultOf(r) {
    if (!r.resolved) return null;
    const v = r.value;
    if (!v || !v.ok || !v.data || !v.data.ok) return null;
    return v.data;
}

async function enterFarm(net) {
    const r = await safe(net.call('C2SEnterFarm', {}, 'S2CEnterFarm', { timeout: 8000 }));
    if (!r.resolved) return null;
    const v = r.value;
    if (!v || !v.ok || !v.data || !v.data.data) return null;
    return v.data.data;
}

// ---------------------------------------------------------------
// 1. 两个连接同时登录同一账号: 只能有一个会话活着, 只创建一个 user 服务
// ---------------------------------------------------------------
async function caseTwoLiveConnections() {
    console.log('\n[1] 两个连接同时登录同一账号');
    const openid = 'conc1_' + Date.now();
    const a = await connect();
    const b = await connect();

    const [ra, rb] = await Promise.all([login(a, openid, 'A'), login(b, openid, 'B')]);
    await sleep(500);

    const da = resultOf(ra), db = resultOf(rb);
    const uid = (da && da.uid) || (db && db.uid) || 0;
    ok(da || db, '至少一个登录成功');
    ok(!da || !db || da.uid === db.uid, '两次登录得到同一 uid', (da && da.uid) + '/' + (db && db.uid));
    ok(a.connected !== b.connected, '只有一个连接保持在线', { a: a.connected, b: b.connected });

    const live = a.connected ? a : b;
    const farm = a.connected || b.connected ? await enterFarm(live) : null;
    ok(!!farm, '在线连接可以进入农场');
    ok(farm && Number(farm.uid) === Number(uid), '农场数据属于同一 uid');

    if (uid > 0) ok(countUserService(uid) === 1, '该 uid 只创建了一个 user 服务', countUserService(uid));

    a.close(); b.close();
}

// ---------------------------------------------------------------
// 2. 同一连接连发两个 C2SLogin: 不重连, 不重复建服务
// ---------------------------------------------------------------
async function caseDoubleLoginSameFd() {
    console.log('\n[2] 同一连接连发两个 C2SLogin');
    const openid = 'conc2_' + Date.now();
    const net = await connect();

    // 第一个包不等待响应, 第二个包紧接着发出
    net.send('C2SLogin', { openid, name: 'D' });
    const r = await login(net, openid, 'D');
    await sleep(300);

    const d = resultOf(r);
    ok(!!d, '仍能登录成功');
    ok(net.connected, '连接没有被自己踢掉');

    const farm = net.connected ? await enterFarm(net) : null;
    ok(!!farm, '登录后可进入农场');

    if (d) ok(countUserService(d.uid) === 1, '该 uid 只创建了一个 user 服务', countUserService(d.uid));

    net.close();
}

// ---------------------------------------------------------------
// 3. N 个连接并发首次登录同一个新 openid: uid 一致, 只建一个服务
// ---------------------------------------------------------------
async function caseConcurrentFirstLogin() {
    console.log('\n[3] N 个连接并发首次登录新 openid');
    const openid = 'conc3_' + Date.now();
    const N = 4;
    const nets = [];
    for (let i = 0; i < N; i++) nets.push(await connect());

    const results = await Promise.all(nets.map((n, i) => login(n, openid, 'C' + i)));
    await sleep(600);

    const uids = results.map(r => { const d = resultOf(r); return d && d.uid; }).filter(Boolean);
    ok(uids.length > 0, '至少一个登录成功', uids.length);
    ok(uids.every(u => u === uids[0]), '所有成功登录的 uid 一致', uids);

    const online = nets.filter(n => n.connected);
    ok(online.length === 1, '最终只有一个连接在线', online.length);

    if (online.length === 1) {
        const farm = await enterFarm(online[0]);
        ok(!!farm, '在线连接可以进入农场');
    }

    if (uids.length) ok(countUserService(uids[0]) === 1, '该 uid 只创建了一个 user 服务', countUserService(uids[0]));

    nets.forEach(n => n.close());
}

// ---------------------------------------------------------------
// 4. 正常顶号: 旧连接被踢, 新连接继续可用
// ---------------------------------------------------------------
async function caseKickOld() {
    console.log('\n[4] 顶号: 旧连接在线时新连接登录');
    const openid = 'conc4_' + Date.now();
    const oldNet = await connect();
    const r1 = await login(oldNet, openid, 'OLD');
    const d1 = resultOf(r1);
    ok(!!d1, '旧连接登录成功');
    await sleep(300);

    const newNet = await connect();
    const r2 = await login(newNet, openid, 'NEW');
    const d2 = resultOf(r2);
    ok(!!d2, '新连接登录成功');
    await sleep(400);

    ok(oldNet.connected === false, '旧连接已被踢下线');
    ok(newNet.connected === true, '新连接保持在线');
    ok(d1 && d2 && d1.uid === d2.uid, '两次登录 uid 一致');

    const farm = newNet.connected ? await enterFarm(newNet) : null;
    ok(!!farm, '新连接可以进入农场');
    if (d1) ok(countUserService(d1.uid) === 1, '顶号复用同一个 user 服务', countUserService(d1.uid));

    oldNet.close(); newNet.close();
}

// ---------------------------------------------------------------
// 5. 登录过程中断开: 不会留下假在线, 下一次登录正常
// ---------------------------------------------------------------
async function caseCloseDuringLogin() {
    console.log('\n[5] 登录过程中断开后重新登录');
    const openid = 'conc5_' + Date.now();
    const dead = await connect();
    dead.send('C2SLogin', { openid, name: 'DEAD' });
    dead.close();
    await sleep(600);

    const net = await connect();
    const r = await login(net, openid, 'AGAIN');
    const d = resultOf(r);
    ok(!!d, '重新登录成功');
    ok(net.connected, '连接保持在线');

    const farm = net.connected ? await enterFarm(net) : null;
    ok(!!farm, '可以进入农场');
    if (d) ok(countUserService(d.uid) === 1, '该 uid 只创建了一个 user 服务', countUserService(d.uid));

    net.close();
}

(async function main() {
    console.log('LoginConcurrency:', URL, 'log:', LOG || '(未找到服务端日志)');
    if (!LOG) console.log('  提示: 传第 3 个参数指定服务端日志, 可校验 user 服务数量');

    try {
        await caseTwoLiveConnections();
        await caseDoubleLoginSameFd();
        await caseConcurrentFirstLogin();
        await caseKickOld();
        await caseCloseDuringLogin();
    } catch (e) {
        fail++;
        console.error('测试异常:', e && e.stack || e);
    }

    console.log(`\n结果: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
})();
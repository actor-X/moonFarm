// MoonFarm 客户端: Canvas 农场渲染 + 面板交互
(function (global) {
    'use strict';

    const C = global.FarmCfg;
    const W = 960, H = 600;
    const COLS = 4, ROWS = 3, PW = 190, PH = 118, GX = 22, GY = 18;
    const GRID_W = COLS * PW + (COLS - 1) * GX;
    const START_X = (W - GRID_W) / 2;
    const START_Y = 132;

    const state = {
        net: null,
        player: null,
        plots: [],
        items: {},
        selected: 0,
        serverOffset: 0,
        busy: false,
        panel: null,
        hover: -1,
        connected: false,
    };

    const ERROR_TEXT = {
        1: '服务器内部错误',
        2: '参数错误',
        101: '地块不存在',
        102: '这块地还没解锁',
        103: '这块地已经种了东西',
        104: '这块地是空的',
        105: '作物不存在',
        106: '还没成熟',
        107: '道具不足',
        108: '金币不足',
        109: '已经浇过水了',
        110: '已经施过肥了',
        111: '该物品不能出售',
        112: '种子不足',
        113: '没有可收获的东西',
        114: '作物不在生长中',
    };

    let canvas, ctx;
    let lastTs = 0;
    let lastHudAt = 0;

    function $(id) { return document.getElementById(id); }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function now() { return Date.now() + state.serverOffset; }
    function nextExp(level) { return C.CONST.level_base_exp + (level - 1) * C.CONST.level_step_exp; }
    function cropName(id) { return (C.CROPS[id] && C.CROPS[id].name) || '作物'; }
    function itemCfg(id) { return C.ITEMS[id] || null; }

    // ---------------- 数据 ----------------

    function normalizePlot(p) {
        return {
            index: Number(p.index),
            state: Number(p.state),
            crop_id: Number(p.crop_id || 0),
            planted_at: Number(p.planted_at || 0),
            ready_at: Number(p.ready_at || 0),
            watered: !!p.watered,
            fertilized: !!p.fertilized,
        };
    }

    function plotState(p) {
        if (!p) return 0;
        if (p.state === 2 && now() >= p.ready_at) return 3;
        return p.state;
    }

    function plotProgress(p) {
        if (!p || !p.planted_at) return 0;
        if (plotState(p) === 3) return 1;
        const total = p.ready_at - p.planted_at;
        if (total <= 0) return 1;
        return clamp((now() - p.planted_at) / total, 0, 1);
    }

    function setPlayer(data) {
        state.player = {
            uid: String(data.uid),
            name: data.name || '农场主',
            level: Number(data.level || 1),
            exp: Number(data.exp || 0),
            coin: Number(data.coin || 0),
        };
        state.serverOffset = Number(data.server_time) - Date.now();

        state.plots = [];
        (data.plots || []).forEach(p => { state.plots[Number(p.index)] = normalizePlot(p); });

        state.items = {};
        (data.items || []).forEach(it => { state.items[Number(it.id)] = Number(it.count); });

        state.selected = 1;
        for (let i = 1; i <= C.CONST.plot_count; i++) {
            const st = plotState(state.plots[i]);
            if (st === 1) { state.selected = i; break; }
        }

        refreshHud();
        if (state.panel) renderPanel();
    }

    function applyPlot(plot) {
        if (!plot) return;
        state.plots[Number(plot.index)] = normalizePlot(plot);
        if (state.panel) renderPanel();
    }

    function applyItems(list) {
        (list || []).forEach(it => { state.items[Number(it.id)] = Number(it.count); });
        refreshHud();
        if (state.panel) renderPanel();
    }

    function applyPlayer(p) {
        if (!state.player || !p) return;
        state.player.level = Number(p.level);
        state.player.exp = Number(p.exp);
        state.player.coin = Number(p.coin);
        refreshHud();
    }

    // ---------------- 交互 ----------------

    function toast(msg, kind) {
        const d = document.createElement('div');
        d.className = 'toast' + (kind ? ' ' + kind : '');
        d.textContent = msg;
        $('toasts').appendChild(d);
        setTimeout(() => { d.style.transition = 'opacity .3s'; d.style.opacity = '0'; }, 1700);
        setTimeout(() => d.remove(), 2100);
    }

    function errorText(r) {
        const code = r && r.data && Number(r.data.code);
        return ERROR_TEXT[code] || ('操作失败 (' + code + ')');
    }

    // ---------------- 操作队列 ----------------
    // 连点时排队依次执行, 不再丢弃后续点击; 同一时刻只有一个请求在飞.
    // 注意: 服务端暂未回显 seq, 超时后的迟到确认包无法与下一次同类型请求区分,
    //       因此超时后先等一小段再执行下一个操作, 尽量让迟到包先被丢弃.
    const ACTION_TIMEOUT_COOLDOWN = 300;
    const MAX_QUEUED_ACTIONS = 8;
    const actionQueue = [];
    let pumping = false;

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    async function runAction(job) {
        state.busy = true;
        try {
            const r = await state.net.call(job.cmd, job.req, 'S2COk');
            if (!r.ok) { toast(errorText(r), 'err'); return null; }
            if (job.okText) toast(job.okText, 'good');
            return r;
        } catch (e) {
            if (e && e.message === '请求超时') await sleep(ACTION_TIMEOUT_COOLDOWN);
            toast(e.message || '网络错误', 'err');
            return null;
        } finally {
            state.busy = false;
        }
    }

    async function pumpActions() {
        if (pumping) return;
        pumping = true;
        try {
            while (actionQueue.length) {
                if (!state.net || !state.connected) {
                    const rest = actionQueue.splice(0);
                    for (const job of rest) job.resolve(null);
                    break;
                }
                const job = actionQueue.shift();
                job.resolve(await runAction(job));
            }
        } finally {
            pumping = false;
        }
    }

    // 入队并返回 Promise; 队列满时立即失败, 避免无限堆积
    function action(cmd, req, okText) {
        if (!state.net || !state.connected) {
            toast('连接已断开', 'err');
            return Promise.resolve(null);
        }
        if (actionQueue.length >= MAX_QUEUED_ACTIONS) {
            toast('操作太频繁，请稍候', 'err');
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            actionQueue.push({ cmd, req, okText, resolve });
            pumpActions();
        });
    }

    function selectedPlot() { return state.plots[state.selected]; }

    function actPlant() {
        const p = selectedPlot();
        if (!p) return toast('先选一块地', 'err');
        const st = plotState(p);
        if (st === 0) return toast('这块地还没解锁', 'err');
        if (st !== 1) return toast('这块地已经种着' + cropName(p.crop_id), 'err');
        openSeeds();
    }

    function actWater() {
        const p = selectedPlot();
        const st = plotState(p);
        if (st !== 2) return toast(st === 3 ? '已经成熟了，直接收获吧' : '这块地没有作物', 'err');
        action('C2SWater', { index: state.selected }, '浇水成功');
    }

    function actFert() {
        const p = selectedPlot();
        const st = plotState(p);
        if (st !== 2) return toast(st === 3 ? '已经成熟了' : '这块地没有作物', 'err');
        action('C2SFertilize', { index: state.selected }, '施肥成功');
    }

    function actHarvest() {
        const p = selectedPlot();
        const st = plotState(p);
        if (st !== 3) return toast('还没成熟', 'err');
        action('C2SHarvest', { index: state.selected });
    }

    async function plantCrop(cropId) {
        closePanel();
        await action('C2SPlant', { index: state.selected, crop_id: cropId }, '播种成功');
    }

    async function buy(itemId, count) {
        await action('C2SBuy', { item_id: itemId, count: count }, '购买成功');
    }

    async function sell(itemId, count) {
        await action('C2SSell', { item_id: itemId, count: count }, '卖出成功');
    }

    // ---------------- 面板 ----------------

    function openPanel(kind) {
        state.panel = kind;
        $('panel').classList.remove('hidden');
        $('panel-title').textContent = kind === 'bag' ? '🎒 背包' : kind === 'shop' ? '🏪 商店' : '🌱 选择种子';
        renderPanel();
    }

    function openSeeds() { openPanel('seeds'); }

    function closePanel() {
        state.panel = null;
        $('panel').classList.add('hidden');
    }

    function row(icon, name, sub, buttons) {
        return `<div class="item-row">
            <div class="item-icon">${icon}</div>
            <div class="item-main"><div class="item-name">${name}</div><div class="item-sub">${sub}</div></div>
            ${buttons || ''}
        </div>`;
    }

    function renderPanel() {
        if (!state.panel) return;
        const body = $('panel-body');
        const html = [];

        if (state.panel === 'seeds') {
            const seeds = Object.keys(state.items)
                .map(Number)
                .filter(id => { const c = itemCfg(id); return c && c.kind === 'seed' && state.items[id] > 0; })
                .sort((a, b) => a - b);
            if (!seeds.length) {
                html.push('<div class="empty-tip">没有种子了，去商店买一些吧</div>');
            } else {
                seeds.forEach(id => {
                    const it = itemCfg(id);
                    const crop = C.CROPS[it.crop_id];
                    html.push(row(it.icon, it.name, `库存 ${state.items[id]} · 成熟约 ${crop.grow_seconds}s · +${crop.exp} 经验`,
                        `<button data-act="plant" data-crop="${it.crop_id}">种植</button>`));
                });
            }
        } else if (state.panel === 'bag') {
            const ids = Object.keys(state.items).map(Number).filter(id => state.items[id] > 0).sort((a, b) => a - b);
            if (!ids.length) {
                html.push('<div class="empty-tip">背包空空如也</div>');
            } else {
                ids.forEach(id => {
                    const it = itemCfg(id);
                    if (!it) return;
                    let btns = '';
                    if (it.kind === 'fruit' && it.sell_price > 0) {
                        btns = `<button class="sell" data-act="sell" data-id="${id}" data-count="1">卖 1</button>
                                <button class="sell" data-act="sell" data-id="${id}" data-count="${state.items[id]}">全卖</button>`;
                    } else if (it.kind === 'seed' && it.crop_id) {
                        btns = `<button data-act="plant" data-crop="${it.crop_id}">去种植</button>`;
                    }
                    const sub = it.kind === 'fruit' ? `可卖 ${it.sell_price} 金币/个`
                        : it.kind === 'seed' ? `作物：${cropName(it.crop_id)}`
                            : '种植时消耗';
                    html.push(row(it.icon, `${it.name} × ${state.items[id]}`, sub, btns));
                });
            }
        } else if (state.panel === 'shop') {
            html.push('<div class="item-sub" style="opacity:.6;margin:2px 2px 4px">—— 购买 ——</div>');
            Object.keys(C.ITEMS).map(Number).filter(id => C.ITEMS[id].buy_price > 0).sort((a, b) => a - b).forEach(id => {
                const it = C.ITEMS[id];
                html.push(row(it.icon, it.name, `${it.buy_price} 金币/个 · 持有 ${state.items[id] || 0}`,
                    `<button data-act="buy" data-id="${id}" data-count="1">买 1</button>
                     <button data-act="buy" data-id="${id}" data-count="10">买 10</button>`));
            });
            html.push('<div class="item-sub" style="opacity:.6;margin:10px 2px 4px">—— 出售 ——</div>');
            Object.keys(C.ITEMS).map(Number).filter(id => C.ITEMS[id].sell_price > 0).sort((a, b) => a - b).forEach(id => {
                const it = C.ITEMS[id];
                const own = state.items[id] || 0;
                html.push(row(it.icon, it.name, `${it.sell_price} 金币/个 · 持有 ${own}`,
                    `<button class="sell" data-act="sell" data-id="${id}" data-count="1" ${own ? '' : 'disabled'}>卖 1</button>
                     <button class="sell" data-act="sell" data-id="${id}" data-count="${own || 1}" ${own ? '' : 'disabled'}>全卖</button>`));
            });
        }

        body.innerHTML = html.join('');
    }

    // ---------------- HUD ----------------

    function refreshHud() {
        const p = state.player;
        if (!p) return;
        $('hud-name').textContent = p.name;
        $('hud-level').textContent = `Lv.${p.level} · ${p.exp}/${nextExp(p.level)}`;
        $('hud-expbar').style.width = clamp(100 * p.exp / nextExp(p.level), 0, 100) + '%';
        $('hud-coin').textContent = p.coin;
    }

    function setConnected(ok) {
        if (!state.connected && !ok) return;
        state.connected = ok;
        const el = $('hud-conn');
        if (el) {
            el.textContent = ok ? '● 在线' : '● 离线';
            el.style.color = ok ? '#2f8f3f' : '#a03a34';
        }
    }

    // ---------------- 渲染 ----------------

    function plotRect(i) {
        const idx = i - 1;
        const row = Math.floor(idx / COLS), col = idx % COLS;
        return { x: START_X + col * (PW + GX), y: START_Y + row * (PH + GY), w: PW, h: PH };
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function drawSky(t) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#8fd3f2');
        g.addColorStop(0.55, '#c9ecf5');
        g.addColorStop(1, '#e8f6d8');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // 太阳
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath();
        ctx.arc(860, 58, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(860, 58, 52, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 云
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        const cx = (t * 14) % (W + 320) - 160;
        cloud(cx, 70, 1.0);
        cloud(cx + 330, 110, 0.72);
        cloud(cx + 620, 60, 0.86);
        ctx.restore();
    }

    function cloud(x, y, s) {
        ctx.beginPath();
        ctx.ellipse(x, y, 46 * s, 20 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 34 * s, y - 10 * s, 30 * s, 24 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 68 * s, y, 36 * s, 18 * s, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawGround() {
        const g = ctx.createLinearGradient(0, 96, 0, H);
        g.addColorStop(0, '#8fca63');
        g.addColorStop(1, '#5f9d46');
        ctx.fillStyle = g;
        ctx.fillRect(0, 96, W, H - 96);

        // 草地纹理
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = '#2f6b2c';
        ctx.lineWidth = 2;
        for (let x = 20; x < W; x += 46) {
            const y = 104 + ((x * 37) % (H - 130));
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x + 3, y - 7, x + 6, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawPlot(i) {
        const r = plotRect(i);
        const p = state.plots[i];
        const st = plotState(p);
        const isSel = state.selected === i;
        const isHover = state.hover === i;

        // 阴影
        ctx.save();
        ctx.fillStyle = 'rgba(20,50,20,0.18)';
        roundRect(r.x + 3, r.y + 6, r.w, r.h, 16);
        ctx.fill();
        ctx.restore();

        // 土壤
        let soilTop = '#a06a42', soilBottom = '#7a4c2c';
        if (st === 0) { soilTop = '#9aa29b'; soilBottom = '#767f78'; }
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, soilTop);
        g.addColorStop(1, soilBottom);
        ctx.fillStyle = g;
        roundRect(r.x, r.y, r.w, r.h, 16);
        ctx.fill();

        // 内圈土垄
        ctx.save();
        roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 13);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 2;
        for (let k = 1; k <= 3; k++) {
            ctx.beginPath();
            ctx.moveTo(r.x + 8, r.y + 20 + k * 26);
            ctx.quadraticCurveTo(r.x + r.w / 2, r.y + 28 + k * 26, r.x + r.w - 8, r.y + 20 + k * 26);
            ctx.stroke();
        }
        ctx.restore();

        if (st === 0) {
            ctx.save();
            ctx.font = '30px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.75;
            ctx.fillText('🔒', r.x + r.w / 2, r.y + r.h / 2 - 4);
            ctx.globalAlpha = 1;
            ctx.font = '600 12px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillText('未解锁', r.x + r.w / 2, r.y + r.h - 20);
            ctx.restore();
        } else if (st === 1) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.30)';
            ctx.lineWidth = 3;
            ctx.setLineDash([7, 6]);
            const cx = r.x + r.w / 2, cy = r.y + r.h / 2 - 6;
            ctx.beginPath();
            ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy);
            ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14);
            ctx.stroke();
            ctx.restore();
        } else {
            const crop = C.CROPS[p.crop_id];
            const prog = plotProgress(p);
            drawCrop(r.x + r.w / 2, r.y + r.h - 26, crop, prog, st === 3);

            // 生长进度
            if (st === 2) {
                const bx = r.x + 22, by = r.y + r.h - 14, bw = r.w - 44, bh = 6;
                ctx.fillStyle = 'rgba(0,0,0,0.28)';
                roundRect(bx, by, bw, bh, 4); ctx.fill();
                ctx.fillStyle = '#9fe06b';
                roundRect(bx, by, Math.max(4, bw * prog), bh, 4); ctx.fill();
                const remain = Math.max(0, Math.ceil((p.ready_at - now()) / 1000));
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = '600 10px "Microsoft YaHei", sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(remain + 's', r.x + r.w - 18, by - 4);
            }

            // 可收获
            if (st === 3) {
                const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 260);
                ctx.save();
                ctx.globalAlpha = pulse;
                ctx.shadowColor = '#ffe066';
                ctx.shadowBlur = 18;
                ctx.strokeStyle = '#ffe066';
                ctx.lineWidth = 3;
                roundRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 14);
                ctx.stroke();
                ctx.restore();

                ctx.save();
                ctx.fillStyle = '#ffd94a';
                roundRect(r.x + r.w / 2 - 34, r.y - 14, 68, 22, 11);
                ctx.fill();
                ctx.fillStyle = '#5a4300';
                ctx.font = '700 12px "Microsoft YaHei", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('可收获', r.x + r.w / 2, r.y - 2);
                ctx.restore();
            }

            // 浇水 / 施肥标记
            if (p.watered) {
                ctx.save();
                ctx.font = '14px "Segoe UI Emoji", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('💧', r.x + 8, r.y + 20);
                ctx.restore();
            }
            if (p.fertilized) {
                ctx.save();
                ctx.font = '14px "Segoe UI Emoji", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('✨', r.x + 28, r.y + 20);
                ctx.restore();
            }
        }

        if (isSel) {
            ctx.save();
            ctx.shadowColor = 'rgba(255,220,90,0.85)';
            ctx.shadowBlur = 14;
            ctx.strokeStyle = '#ffe066';
            ctx.lineWidth = 3;
            roundRect(r.x, r.y, r.w, r.h, 16);
            ctx.stroke();
            ctx.restore();
        } else if (isHover) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.lineWidth = 2;
            roundRect(r.x, r.y, r.w, r.h, 16);
            ctx.stroke();
            ctx.restore();
        }
    }

    function drawCrop(cx, baseY, crop, prog, ripe) {
        if (!crop) return;
        const t = performance.now() / 1000;
        const sway = Math.sin(t * 2 + cx * 0.05) * 2;
        const stage = prog < 0.34 ? 0 : prog < 0.67 ? 1 : 2;
        const scale = ripe ? 1 + 0.03 * Math.sin(t * 4) : 1;

        ctx.save();
        ctx.translate(cx, baseY);
        ctx.scale(scale, scale);

        // 茎
        const stemH = [14, 30, 46][stage];
        ctx.strokeStyle = '#3f7d3a';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(sway * 0.4, -stemH * 0.5, sway, -stemH);
        ctx.stroke();

        // 叶子
        const leafCount = stage === 0 ? 2 : 4;
        for (let i = 0; i < leafCount; i++) {
            const dir = i % 2 === 0 ? -1 : 1;
            const ly = -stemH * (0.35 + 0.22 * i);
            ctx.save();
            ctx.translate(sway * 0.6, ly);
            ctx.rotate(dir * (0.55 + i * 0.12) + sway * 0.01);
            ctx.fillStyle = '#4e9a45';
            ctx.beginPath();
            ctx.ellipse(dir * 11, 0, 12, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 成熟果实
        if (stage === 2) {
            const topY = -stemH + 6;
            if (crop.id === 1) {
                // 小麦: 麦穗
                for (let i = -2; i <= 2; i++) {
                    ctx.save();
                    ctx.strokeStyle = '#c9a23a';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(i * 7, 0);
                    ctx.quadraticCurveTo(i * 10 + sway, -stemH * 0.6, i * 12 + sway, topY);
                    ctx.stroke();
                    ctx.fillStyle = crop.color;
                    for (let k = 0; k < 4; k++) {
                        ctx.beginPath();
                        ctx.ellipse(i * 12 + sway, topY + k * 6, 4, 6, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();
                }
            } else if (crop.id === 2) {
                // 番茄: 果实
                ctx.fillStyle = '#4e9a45';
                ctx.beginPath();
                ctx.ellipse(sway, -stemH * 0.5, 22, 18, 0, 0, Math.PI * 2);
                ctx.fill();
                for (let i = 0; i < 4; i++) {
                    const a = i * 1.7;
                    ctx.fillStyle = crop.color;
                    ctx.beginPath();
                    ctx.arc(sway + Math.cos(a) * 14, -stemH * 0.5 + Math.sin(a) * 10, 7, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'rgba(255,255,255,0.35)';
                    ctx.beginPath();
                    ctx.arc(sway + Math.cos(a) * 14 - 2, -stemH * 0.5 + Math.sin(a) * 10 - 2, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (crop.id === 3) {
                // 胡萝卜: 露出地面的根
                ctx.fillStyle = crop.color;
                ctx.beginPath();
                ctx.moveTo(sway - 9, -6);
                ctx.lineTo(sway + 9, -6);
                ctx.lineTo(sway, 12);
                ctx.closePath();
                ctx.fill();
            } else {
                // 草莓
                ctx.fillStyle = '#4e9a45';
                ctx.beginPath();
                ctx.ellipse(sway, -stemH * 0.45, 20, 15, 0, 0, Math.PI * 2);
                ctx.fill();
                for (let i = 0; i < 3; i++) {
                    const px = sway + (i - 1) * 13;
                    const py = -stemH * 0.45 + (i % 2) * 8;
                    ctx.fillStyle = crop.color;
                    ctx.beginPath();
                    ctx.arc(px, py, 6.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'rgba(255,255,255,0.65)';
                    for (let k = 0; k < 3; k++) {
                        ctx.beginPath();
                        ctx.arc(px - 2 + k * 2, py - 2 + (k % 2) * 3, 1, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }

        ctx.restore();
    }

    function render() {
        if (!ctx) return;
        const sx = canvas.width / W, sy = canvas.height / H;
        ctx.setTransform(sx, 0, 0, sy, 0, 0);

        const t = performance.now() / 1000;
        drawSky(t);
        drawGround();
        for (let i = 1; i <= C.CONST.plot_count; i++) drawPlot(i);

        if (state.player && performance.now() - lastHudAt > 500) {
            lastHudAt = performance.now();
            refreshHud();
        }
        requestAnimationFrame(render);
    }

    // ---------------- 事件 ----------------

    function canvasPoint(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * W / rect.width,
            y: (e.clientY - rect.top) * H / rect.height,
        };
    }

    function hitPlot(x, y) {
        for (let i = 1; i <= C.CONST.plot_count; i++) {
            const r = plotRect(i);
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
        }
        return 0;
    }

    function bindUI() {
        const toolbar = $('toolbar');
        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            if (btn.dataset.act === 'plant') actPlant();
            else if (btn.dataset.act === 'water') actWater();
            else if (btn.dataset.act === 'fert') actFert();
            else if (btn.dataset.act === 'harvest') actHarvest();
        });

        $('btn-bag').addEventListener('click', () => {
            state.panel === 'bag' ? closePanel() : openPanel('bag');
        });
        $('btn-shop').addEventListener('click', () => {
            state.panel === 'shop' ? closePanel() : openPanel('shop');
        });
        $('panel-close').addEventListener('click', closePanel);

        $('panel-body').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            if (act === 'plant') plantCrop(Number(btn.dataset.crop));
            else if (act === 'buy') buy(Number(btn.dataset.id), Number(btn.dataset.count || 1));
            else if (act === 'sell') sell(Number(btn.dataset.id), Number(btn.dataset.count || 1));
        });

        canvas.addEventListener('pointermove', (e) => {
            const pt = canvasPoint(e);
            state.hover = hitPlot(pt.x, pt.y);
            canvas.style.cursor = state.hover ? 'pointer' : 'default';
        });

        canvas.addEventListener('pointerleave', () => { state.hover = -1; });

        canvas.addEventListener('pointerdown', (e) => {
            const pt = canvasPoint(e);
            const idx = hitPlot(pt.x, pt.y);
            if (!idx) return;
            state.selected = idx;
            if (state.panel) closePanel();
        });

        window.addEventListener('resize', resizeCanvas);
    }

    function resizeCanvas() {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }

    // ---------------- 对外接口 ----------------

    function init(net) {
        state.net = net;
        canvas = $('farm');
        ctx = canvas.getContext('2d');

        bindUI();
        resizeCanvas();

        net.on('S2CPlotUpdate', (m) => applyPlot(m.plot));
        net.on('S2CHarvest', (m) => {
            const gained = (m.items || []).map(it => {
                const cfg = itemCfg(Number(it.id));
                return `${cfg ? cfg.name : it.id} ×${Number(it.count)}`;
            }).join('，');
            toast(`收获 ${gained} · +${Number(m.exp)} 经验`, 'good');
        });
        net.on('S2CItemUpdate', (m) => applyItems(m.items));
        net.on('S2CPlayerUpdate', (m) => applyPlayer(m));
        net.onClose(() => {
            setConnected(false);
            toast('与服务器断开连接', 'err');
        });

        setConnected(true);
        requestAnimationFrame((ts) => { lastTs = ts; render(); });
    }

    function showGame() {
        $('hud').classList.remove('hidden');
        $('toolbar').classList.remove('hidden');
    }

    global.Game = { init, setPlayer, showGame, toast };
})(globalThis);
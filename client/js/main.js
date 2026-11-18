// 客户端入口: 建立连接 -> 登录 -> 拉取农场数据
(function (global) {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const LS = {
        openid: 'moonfarm_openid',
        name: 'moonfarm_name',
        ws: 'moonfarm_ws',
    };

    const qs = new URLSearchParams(location.search);
    const openidEl = $('login-openid');
    const nameEl = $('login-name');
    const wsEl = $('login-ws');
    const btn = $('login-btn');
    const statusEl = $('login-status');

    const defaultWs = qs.get('ws')
        || localStorage.getItem(LS.ws)
        || `ws://${location.hostname || '127.0.0.1'}:9002/`;

    openidEl.value = qs.get('openid') || localStorage.getItem(LS.openid) || 'farmer_demo';
    nameEl.value = qs.get('name') || localStorage.getItem(LS.name) || '小农夫';
    wsEl.value = defaultWs;

    let net = null;
    let pingTimer = null;

    function setStatus(msg, isError) {
        statusEl.textContent = msg || '';
        statusEl.style.color = isError ? '#a03a34' : '#3f7d3a';
    }

    async function ping() {
        if (!net || !net.connected) return;
        try {
            await net.call('C2SPing', { time: Date.now() }, 'S2CPong');
        } catch (e) { /* ignore */ }
    }

    async function login() {
        const openid = openidEl.value.trim() || 'farmer_demo';
        const name = nameEl.value.trim() || '小农夫';
        const ws = wsEl.value.trim() || defaultWs;

        if (btn.disabled) return;
        btn.disabled = true;
        setStatus('正在连接服务器...');

        try {
            net = new Net();
            await net.connect(ws);
            Game.init(net);

            const r = await net.call('C2SLogin', { openid, name }, 'S2CLogin');
            if (!r.ok) throw new Error(r.data && r.data.code ? ('登录失败，错误码 ' + r.data.code) : '登录失败');
            if (!r.data || !r.data.ok) throw new Error('登录被服务器拒绝');

            const f = await net.call('C2SEnterFarm', {}, 'S2CEnterFarm');
            if (!f.ok) throw new Error('进入农场失败');

            Game.setPlayer(f.data.data);
            Game.showGame();
            $('login').classList.add('hidden');

            localStorage.setItem(LS.openid, openid);
            localStorage.setItem(LS.name, name);
            localStorage.setItem(LS.ws, ws);

            setStatus('');
            Game.toast(`欢迎来到农场，${f.data.data.name || name}`, 'good');

            // 断线处理: 保留 Game 自己的提示, 这里恢复登录界面
            const prevClose = net.closeHandler;
            net.onClose(() => {
                if (prevClose) prevClose();
                if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
                $('login').classList.remove('hidden');
                $('toolbar').classList.add('hidden');
                $('hud').classList.add('hidden');
                btn.disabled = false;
                setStatus('连接已断开，请重新进入', true);
            });

            if (pingTimer) clearInterval(pingTimer);
            pingTimer = setInterval(ping, 25000);
        } catch (e) {
            setStatus(e.message || '连接失败', true);
            btn.disabled = false;
            try { if (net) net.close(); } catch (_) { /* ignore */ }
        }
    }

    btn.addEventListener('click', login);
    [openidEl, nameEl, wsEl].forEach(el => {
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    });

    // 带 ?auto=1 时自动登录(方便调试)
    if (qs.get('auto') === '1') {
        login();
    }
})(globalThis);
// 用 Chrome DevTools Protocol 打开页面、真实等待后截图(开发/文档用)
// 用法: node tools/screenshot.js "<url>" [out.png] [waitMs]
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8080/?auto=1&openid=shot_demo&name=截图测试';
const OUT = process.argv[3] || path.join(__dirname, '..', 'shot.png');
const WAIT = parseInt(process.argv[4] || '6000', 10);
const PORT = 9333;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getJSON(pathname) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PORT, path: pathname }, res => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

(async () => {
    const child = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars',
        `--remote-debugging-port=${PORT}`,
        '--window-size=1200,820',
        '--no-first-run', '--no-default-browser-check',
        'about:blank',
    ], { stdio: 'ignore' });

    let page;
    for (let i = 0; i < 60; i++) {
        try {
            const list = await getJSON('/json/list');
            page = list.find(t => t.type === 'page');
            if (page) break;
        } catch (e) { /* not ready */ }
        await sleep(200);
    }
    if (!page) {
        console.error('chrome devtools not ready');
        child.kill();
        process.exit(1);
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const send = (method, params) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });

    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            if (m.error) p.reject(new Error(JSON.stringify(m.error)));
            else p.resolve(m.result);
        }
    };

    await send('Page.enable', {});
    await send('Page.navigate', { url: URL });
    await sleep(WAIT);

    const cap = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(cap.data, 'base64'));
    console.log('saved', OUT);

    try { ws.close(); } catch (e) { /* ignore */ }
    child.kill();
    process.exit(0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
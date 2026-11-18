// 极简静态文件服务器(仅用于本地调试, 避免 file:// 下的浏览器限制)
// 用法: node tools/serve.js [port]     默认 http://127.0.0.1:8080/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'client');
const PORT = parseInt(process.argv[2] || '8080', 10);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.resolve(ROOT, '.' + urlPath);
    if (!filePath.startsWith(ROOT)) {   // 防目录穿越
        res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not Found: ' + urlPath); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(PORT, '127.0.0.1', () => {
    console.log('html-client 静态服务: http://127.0.0.1:' + PORT + '/');
});

// 生成候选拼图(contact sheet): 每格缩放到 120, 标注序号, 便于辨认
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
try { require('canvas'); } catch(e){ console.log('no canvas module'); process.exit(0); }

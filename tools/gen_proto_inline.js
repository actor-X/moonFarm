// 从 server/protocol/*.proto 生成 client/js/proto-inline.js
// 用法: node tools/gen_proto_inline.js  (在 myFarm 目录下)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'server', 'protocol');
const OUT = path.join(ROOT, 'client', 'js', 'proto-inline.js');

const files = ['common.proto', 'farm.proto'];

function esc(src) {
    return src.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

let out = `
// Auto-generated from server/protocol/*.proto. DO NOT EDIT.
// Regen: node tools/gen_proto_inline.js
window.MOON_PROTO_SOURCES = {
`;

for (const f of files) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    out += `    ${JSON.stringify(f)}: \`${esc(src)}\`,\n`;
}
out += '};\n';

fs.writeFileSync(OUT, out);
console.log('written', OUT, fs.statSync(OUT).size, 'bytes');
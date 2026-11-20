const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
function pngSize(buf){ if(buf[0]!==0x89) return null; return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; }
const dir = path.join(A, 'extraRes', 'gui');
const rows = [];
for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.png'))) {
  const buf = fs.readFileSync(path.join(dir, f));
  const s = pngSize(buf); if(!s) continue;
  rows.push({ f, w:s[0], h:s[1], size:buf.length });
}
// 地块常见方形/矩形 90~160 宽高
const cand = rows.filter(r => r.w>=80 && r.w<=170 && r.h>=50 && r.h<=120);
console.log('extraRes gui 总数', rows.length, '候选地块尺寸', cand.length);
cand.sort((a,b)=>b.size-a.size);
cand.slice(0,30).forEach(r=>console.log(`  ${r.f} ${r.w}x${r.h} ${r.size}B`));

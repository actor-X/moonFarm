const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
const dir = path.join(A, 'plant', 'model');
// 读 PNG IHDR 尺寸
function pngSize(buf){ if(buf[0]!==0x89) return null; return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; }
const files = fs.readdirSync(dir).filter(f=>f.endsWith('.png'));
const dist = {};
const rows = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const s = pngSize(buf);
  if (!s) continue;
  const key = s[0]+'x'+s[1];
  dist[key]=(dist[key]||0)+1;
  rows.push({ f, w:s[0], h:s[1], size:buf.length });
}
console.log('总数', rows.length);
console.log('尺寸分布', JSON.stringify(Object.entries(dist).sort((a,b)=>b[1]-a[1]).slice(0,15)));
// 偏大的立绘(成熟态候选)
rows.sort((a,b)=>b.w*b.h-a.w*b.h);
console.log('最大 12 张:');
rows.slice(0,12).forEach(r=>console.log(`  ${r.f} ${r.w}x${r.h} ${r.size}B`));

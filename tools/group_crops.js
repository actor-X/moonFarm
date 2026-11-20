const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
const sf = JSON.parse(fs.readFileSync(path.join(A, '_meta', 'sprite-frames.json'), 'utf8'));
const plant = sf.plant || [];

// 按 Crop_<编号>_<阶段> 分组
const groups = {};
for (const f of plant) {
  const m = (f.name || '').match(/Crop_(\d+)_(\w+)/);
  if (!m) continue;
  const [, id, stage] = m;
  (groups[id] = groups[id] || { Seed: [], s2: [], s3: [], s4: [], s5: [], s6: [] });
  const key = /^\d+$/.test(stage) ? 's' + stage : stage;
  (groups[id][key] = groups[id][key] || []).push(f);
}

const ids = Object.keys(groups).sort((a, b) => a - b);
console.log('作物编号数', ids.length);
// 打印阶段齐全的编号
for (const id of ids) {
  const g = groups[id];
  const stages = Object.entries(g).map(([k, v]) => `${k}:${v.length}`).join(' ');
  console.log(`Crop_${id}  ${stages}`);
}

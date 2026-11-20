const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
const sf = JSON.parse(fs.readFileSync(path.join(A, '_meta', 'sprite-frames.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(A, 'manifest.json'), 'utf8'));

// atlas base uuid -> 图片文件(plant 包)
const atlasFile = {};
for (const it of man.packages.plant.items) {
  atlasFile[it.sourceFile.replace(/\.png$/, '')] = it.file;
}

// 选阶段齐全候选: 21,84,85,86,226,228,235,256,516,523,525,526,527,529,1072,1435
const picks = ['21','84','85','86','226','228','235','256','516','523','525','526','527','529','1072','1435'];
const out = [];
for (const f of sf.plant) {
  const m = (f.name||'').match(/Crop_(\d+)_(\w+)/);
  if (m && picks.includes(m[1])) {
    out.push({ name: f.name, atlas: f.atlas, file: atlasFile[f.atlas] || null, rect: f.rect, orig: f.originalSize });
  }
}
fs.writeFileSync(path.join(A, '_meta', 'candidate-crops.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('候选帧', out.length);
for (const o of out) console.log(o.name, '->', o.file ? path.basename(o.file) : 'NOFILE', o.rect && `${o.rect.width}x${o.rect.height}`);

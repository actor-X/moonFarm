const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
const sf = JSON.parse(fs.readFileSync(path.join(A, '_meta', 'sprite-frames.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(A, 'manifest.json'), 'utf8'));
// 包内 sourceFile(去扩展名) -> file
const byPkg = {};
for (const pkg of Object.keys(man.packages)) {
  const m = {};
  for (const it of man.packages[pkg].items) m[it.sourceFile.replace(/\.[^.]+$/, '')] = it.file;
  byPkg[pkg] = m;
}
// atlas 引用的是 base uuid; 这里无法反查文件, 只列出帧名+rect
const kw = /land|dry|valid|locked|grass/i;
for (const pkg of Object.keys(sf)) {
  const hits = sf[pkg].filter(f => kw.test(f.name || ''));
  if (hits.length) {
    console.log(`[${pkg}] ${hits.length}`);
    hits.slice(0, 30).forEach(f => console.log(`  ${f.name}  ${f.rect ? f.rect.width+'x'+f.rect.height : ''}  atlas=${(f.atlas||'').slice(0,10)}`));
  }
}

const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
const paths = JSON.parse(fs.readFileSync(path.join(A, '_meta', 'paths.json'), 'utf8'));
// 关键词: 土地/地块/草/田/land/soil/grass/plot/farm/ground
const kw = /land|soil|grass|plot|farm|ground|earth|dirt|田|土|草|地/i;
for (const pkg of Object.keys(paths)) {
  const hits = paths[pkg].filter(n => kw.test(n));
  if (hits.length) {
    console.log(`[${pkg}] ${hits.length}`);
    hits.slice(0, 20).forEach(h => console.log('  ' + h));
  }
}

const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, '..', 'client', 'assets');
const paths = JSON.parse(fs.readFileSync(path.join(A, '_meta', 'paths.json'), 'utf8'));
const kw = /tomato|carrot|strawberry|wheat|corn|rice|cabbage|radish|potato|onion|pepper|eggplant|melon|apple|grape|peach|fruit|veggie|vegetable|crop/i;
for (const pkg of Object.keys(paths)) {
  const hits = paths[pkg].filter(n => kw.test(n));
  if (hits.length) {
    console.log(`[${pkg}] ${hits.length}`);
    [...new Set(hits)].slice(0, 40).forEach(h => console.log('  ' + h));
  }
}

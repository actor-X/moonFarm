/**
 * 从微信小游戏 Cocos 缓存中抽取可用素材(PNG / MP3)到 client/assets。
 *
 * 背景: 该缓存把 import(元数据 json) 与 native(位图/音频) 平铺在各包目录,
 * 文件名是下载时间戳; 脱离 Cocos 工程无法把单个 native 文件精确反查到原始资源名。
 * 因此本脚本:
 *   1. 按 包/分类 原样拷贝全部合法 PNG、MP3;
 *   2. 解析清单 paths, 导出原始资源名清单 assets/_meta/paths.json;
 *   3. 解析 SpriteFrame 元数据, 导出图集裁剪帧清单 assets/_meta/sprite-frames.json;
 *   4. 生成 manifest.json 汇总每个拷贝文件的来源、大小、类型。
 *
 * 仅抽取可直接使用的位图与音频; bin / spine 骨骼数据 / plist / atlas / 字体等引擎元数据不拷贝。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 源目录只从参数/环境变量取, 不写死本机路径
//   node tools/extract_assets.js <小游戏缓存的 gamecaches 目录>
//   WX_GAMECACHES=<目录> node tools/extract_assets.js
const SRC = process.argv[2] || process.env.WX_GAMECACHES;
if (!SRC || !fs.existsSync(SRC)) {
  console.error('用法: node tools/extract_assets.js <gamecaches 目录>');
  console.error('      或设置环境变量 WX_GAMECACHES');
  process.exit(1);
}
const DEST = path.join(__dirname, '..', 'client', 'assets');
const META = path.join(DEST, '_meta');

const PACK_DIRS = ['plant', 'animal', 'petdog', 'mainscene', 'mcRes', 'commonRes', 'extraRes', 'delayRes', 'audio'];

const EXT_MEDIA = { png: 'image', mp3: 'audio', ogg: 'audio', wav: 'audio' };

// 清单 paths 首级目录 -> 分类
const CLASSIFY = {
  model: 'model', texture: 'texture', spine: 'spine', gui: 'gui', effect: 'effect',
  scene: 'scene', res: 'res', unit: 'unit', audio: 'sfx', mcAudio: 'sfx',
  config: 'config', mcconfig: 'config', light2d: 'light2d', shader: 'shader',
  fonts: 'fonts', text: 'text', bianbian: 'texture', cangshu: 'texture',
};

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function extOf(f) { return f.split('.').pop().toLowerCase(); }

// 读取一个包内所有清单: 返回 paths(索引->原始名) 与 spriteFrame 元数据
function readManifests(dirPath) {
  const files = fs.readdirSync(dirPath);
  const paths = {};
  const frames = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let o;
    try { o = JSON.parse(fs.readFileSync(path.join(dirPath, f), 'utf8')); } catch (e) { continue; }
    if (o && o.paths) {
      for (const k of Object.keys(o.paths)) {
        const v = o.paths[k];
        if (Array.isArray(v) && typeof v[0] === 'string') paths[Number(k)] = v[0];
      }
    }
    // 单条 SpriteFrame 记录: [1, [图集uuid], ["_textureSource"], ["cc.SpriteFrame"], 0, [{name,rect,offset,originalSize,rotated,uv...}]]
    if (Array.isArray(o) && o[3] && o[3][0] === 'cc.SpriteFrame') {
      const meta = o[5] && o[5][0];
      if (meta) {
        frames.push({
          name: meta.name || null,
          atlas: (o[1] && o[1][0] || '').split('@')[0] || null,
          rect: meta.rect || null,
          offset: meta.offset || null,
          originalSize: meta.originalSize || null,
          rotated: !!meta.rotated,
          uv: meta.vertices && meta.vertices.uv || null,
          sourceJson: f,
        });
      }
    }
  }
  return { files, paths, frames };
}

function classify(pkg, rawName) {
  if (pkg === 'audio') return 'sfx';
  const top = (rawName || '').split('/')[0] || 'misc';
  return CLASSIFY[top] || top;
}

// 包内各分类计数(用于在无法反查单文件时选择主分类)
function majorityClass(pkg, paths) {
  if (pkg === 'audio') return 'sfx';
  const c = {};
  for (const n of Object.values(paths)) { const cl = classify(pkg, n); c[cl] = (c[cl] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'misc';
}

const manifest = { generated: new Date().toISOString(), source: SRC, packages: {} };
const allPaths = {};
const allFrames = {};
const stats = { image: 0, audio: 0, bytes: 0, skipped: 0 };

for (const pkg of PACK_DIRS) {
  const dirPath = path.join(SRC, pkg);
  if (!fs.existsSync(dirPath)) { console.log('缺失包', pkg); continue; }
  const { files, paths, frames } = readManifests(dirPath);
  const mainCat = majorityClass(pkg, paths);

  const media = files.filter(f => EXT_MEDIA[extOf(f)]);
  const pkgEntry = { total: media.length, copied: 0, items: [] };
  allPaths[pkg] = Object.values(paths);
  allFrames[pkg] = frames;

  for (const f of media) {
    const ext = extOf(f);
    const type = EXT_MEDIA[ext];
    const srcFile = path.join(dirPath, f);
    let buf;
    try { buf = fs.readFileSync(srcFile); } catch (e) { stats.skipped++; continue; }
    // 合法性校验: PNG 头 / MP3 帧头或 ID3
    if (ext === 'png' && !(buf[0] === 0x89 && buf[1] === 0x50)) { stats.skipped++; continue; }
    if (ext === 'mp3' && !(buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) && !(buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) { stats.skipped++; continue; }

    // 分类: 图片归包内主分类; 音频统一 sfx(单文件无法反查原始名)
    const cat = type === 'audio' ? 'sfx' : mainCat;
    const outDir = path.join(DEST, pkg, cat);
    fs.mkdirSync(outDir, { recursive: true });
    const hash = crypto.createHash('md5').update(pkg + f).digest('hex').slice(0, 6);
    const outName = `${f.replace(/\.[^.]+$/, '')}_${hash}.${ext}`;
    const outFile = path.join(outDir, outName);
    fs.writeFileSync(outFile, buf);
    stats[type]++;
    stats.bytes += buf.length;
    pkgEntry.copied++;
    pkgEntry.items.push({
      file: `${pkg}/${cat}/${outName}`,
      type, ext, size: buf.length, sourceFile: f,
    });
  }
  manifest.packages[pkg] = pkgEntry;
  console.log(`[${pkg}] 媒体 ${media.length} 已拷贝 ${pkgEntry.copied}, 帧元数据 ${frames.length}`);
}

fs.mkdirSync(META, { recursive: true });
fs.writeFileSync(path.join(META, 'paths.json'), JSON.stringify(allPaths, null, 2), 'utf8');
fs.writeFileSync(path.join(META, 'sprite-frames.json'), JSON.stringify(allFrames, null, 2), 'utf8');
fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\n完成: 图片=${stats.image} 音频=${stats.audio} 跳过=${stats.skipped} 总大小=${(stats.bytes / 1024 / 1024).toFixed(1)}MB`);

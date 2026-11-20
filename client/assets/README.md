# 客户端美术资源说明（client/assets）

本目录素材提取自微信小游戏本地缓存（Cocos Creator 打包产物），仅用于本机学习/毕业设计，
**不包含任何原游戏代码**；正式发布或商用前需替换为原创或已授权素材。

## 目录结构

```
client/assets/
├── manifest.json          # 全量清单: 每个拷贝文件的来源包、类型、大小、原缓存文件名
├── _meta/
│   ├── paths.json          # 各包清单里的原始资源名表（索引 -> 原始路径名）
│   └── sprite-frames.json  # SpriteFrame 元数据: 帧名、图集 UUID、裁剪 rect、偏移、原始尺寸、UV
├── plant/model/           # 作物立绘 PNG（458 张，透明底单株/阶段图）
├── animal/texture/         # 动物贴图 PNG（59 张）
├── petdog/gui/             # 宠物狗贴图 PNG（17 张）
├── mainscene/config/      # 主场景图集/布景 PNG（等距地块、树、云、装饰）
├── mainscene/sfx/          # 主场景音效 MP3（34 个）
├── mcRes/gui/              # 牧场/建筑/UI 贴图 PNG（207 张）
├── commonRes/gui/          # 公共 UI 贴图 PNG（44 张）
├── extraRes/gui/          # 额外 UI/特效/场景贴图 PNG（877 张）
├── delayRes/gui/          # 延迟加载的季节/活动 UI 贴图 PNG（304 张）
└── audio/sfx/             # 通用音效 MP3（79 个）
```

## 数量与体积

- 图片 PNG：1976 张；音频 MP3：113 个；总体积约 335 MB。
- 提取脚本：`tools/extract_assets.js`（可重复执行，会按包/分类重新拷贝并刷新清单）。

## 重要限制（缓存格式决定）

1. **文件名为缓存时间戳 + 短哈希**，不是原始资源名。缓存把 import（元数据 json）与
   native（位图/音频）平铺、按下载时间戳命名；脱离 Cocos 工程无法把单个 native 文件
   精确反查到原始资源名，因此图片先按「包/分类」归类，原始名表见 `_meta/paths.json`。
2. **图集切片信息在 `_meta/sprite-frames.json`**：一张图集 PNG 内含多个小图，
   `rect` 是裁剪矩形、`originalSize` 是原尺寸、`uv` 是纹理坐标；贴到 Canvas 时按 rect 截取。
3. **未拷贝的引擎元数据**：`.bin`（序列化场景/预制体/动画）、spine 骨骼数据、
   `.plist/.atlas`（粒子/图集配置）、字体、shader 等，脱离引擎不能直接使用，未纳入本目录。
4. 部分贴图为活动/季节/UI 皮肤，与当前农场玩法无关，可在接入时按需挑选。

## 后续接入建议

- 作物：按 `sprite-frames.json` 中 `Crop_<编号>_<阶段>`（Seed/2/3/4/5/6）分组，
  映射到现有 `server/common/config/crops.lua` 的作物阶段图。
- 场景：从 `mainscene/config`、`mcRes/gui` 挑选地块、树、云、房屋等布景做分层背景。
- 音效：`audio/sfx` 与 `mainscene/sfx` 按用途（浇水、收获、点击、金币）挑选懒加载。
- 上线前对图片压缩、降分辨率、合并图集，控制手机端首屏体积。

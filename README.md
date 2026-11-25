# 奶龙大笑相似度

一个纯前端的“奶龙大笑相似度”小游戏：浏览器录下你的笑声，在本机提取 MFCC 与能量包络特征，再和项目根目录的参考音频比较，给出 0–100 分。

- 纯 HTML / CSS / JavaScript，单页应用；游戏逻辑无后端、无框架、无构建步骤。
- 所有录音与音频分析都只发生在浏览器本地，**录音不会上传到任何服务器**。
- 参考音频已按你的要求放入包内：`reference.mp3`。
- 页面图片和参考音频由使用者在本地提供；缺图时显示浅黄虚线占位框，后续直接替换同名文件即可。
- 部署目标是 GitHub Pages；所有业务资源使用相对路径，兼容项目子路径。
- 声音特征提取使用 [Meyda 5.6.3](https://meyda.js.org/)（CDN 引入）。

---

## 1. 文件结构

```text
奶龙大笑相似度/
├── index.html                页面结构与图片槽
├── style.css                 奶龙黄主题、响应式与占位样式
├── app.js                    录音、解码、Meyda 特征、评分与错误处理
├── reference.mp3             用户提供的参考音频
├── README.md                 本文件
├── 使用说明.txt              最简单的本地打开方式
├── GitHub上传教程.md         网页上传与 Git 命令上传教程
├── 启动游戏.bat              Windows 一键启动本地服务器并打开浏览器
├── server.js                 仅本地预览用的静态文件服务器（不是游戏后端）
├── .nojekyll                 防止 GitHub Pages 走 Jekyll
└── assets/
    ├── hero.jpg
    ├── recording.gif
    ├── result-win.jpg
    ├── result-mid.jpg
    ├── result-low.jpg
    └── README.md             图片清单与推荐尺寸
```

参考音频可以叫 `reference.mp3` 或 `reference.wav`，都必须放在**项目根目录**，与 `index.html` 同级，不要放进 `assets/`。本包内已含 `reference.mp3`。

---

## 2. 如何打开游戏（解决打不开 localhost:8000）

### 最简单：双击 `启动游戏.bat`

1. 双击文件夹中的 **`启动游戏.bat`**。
2. 会打开一个黑色命令行窗口，并在本机启动静态服务器。
3. 浏览器通常会自动打开游戏。如果没有自动打开，请复制黑色窗口里显示的地址（默认类似 `http://localhost:8000/`）到浏览器。
4. 第一次点击“开始录音”时，请在浏览器提示中选择允许麦克风。
5. **不要关闭黑色窗口**；关闭窗口或按 Ctrl+C 后，服务器停止，localhost 地址就会重新变得无法访问。

### 为什么之前打不开 localhost:8000？

`localhost` 不是磁盘上的文件，也不是一旦打开就永久存在的服务。它只是“本机正在运行的服务器”的地址：

- 没有启动本地服务器时，访问 `http://localhost:8000/` 当然会失败；
- 直接双击 `index.html` 也不行，因为 `file://` 页面无法使用麦克风；
- 必须通过 `http://localhost` 或 HTTPS 打开页面。

如果双击 `启动游戏.bat` 提示找不到 Node.js，请先安装 Node.js（<https://nodejs.org/zh-cn>），安装后重新双击脚本。

如果 8000 端口已被其他程序占用，`server.js` 会自动尝试 8001–8010，并在黑色窗口中打印实际地址；请以窗口里的地址为准。

### 手动启动

需要 Node.js：

```bash
node server.js
```

也可以在有 Python 的电脑上使用：

```bash
python -m http.server 8000
```

然后打开窗口中的地址。首次录音时允许麦克风。

> `server.js` 只负责把本文件夹作为静态网站提供给浏览器，不处理、保存或上传录音，不参与评分。GitHub Pages 部署时不需要它。

---

## 3. 参考音频

本包根目录已经包含：

```text
reference.mp3
```

这是由你提供的参考音频，原文件名为 `奶龙大笑_爱给网_aigei_com.mp3`。

- 页面优先加载 `./reference.mp3`；如果没有，则自动尝试 `./reference.wav`。
- 两个文件都不存在时，页面会显示“缺少参考音频 reference.mp3 / reference.wav”的提示。
- 参考音频会随站点部署；请确认你拥有公开使用和传播它的权利。
- 超过 10 秒的部分不会被用于评分：预处理后会取裁剪静音后的前 10 秒。
- 支持浏览器能够解码的 MP3、WAV；建议使用清晰、少噪声的奶龙笑声片段。

### 图片清单（当前已放入 5 张，可继续替换）

所有图片缺省时自动显示固定高度 180px 的浅黄虚线占位框，不会出现破图图标，也不会产生 JavaScript 异常。把同名文件放进 `assets/` 后刷新页面即可生效：

| 文件名 | 显示状态 | 推荐尺寸 | 实际展示区域 |
| --- | --- | --- | --- |
| `assets/hero.jpg` | 开始页 | 1200 × 900（4:3） | 最宽 560 × 420 |
| `assets/recording.gif` | 录音中 | 600 × 600（1:1） | 最宽 300 × 300 |
| `assets/result-win.jpg` | 结果 ≥ 85 分 | 800 × 800（1:1，其他比例也可） | 340 × 340 内完整显示 |
| `assets/result-mid.jpg` | 结果 50–84 分 | 800 × 800（1:1，其他比例也可） | 340 × 340 内完整显示 |
| `assets/result-low.jpg` | 结果 < 50 分 | 800 × 800（1:1，其他比例也可） | 340 × 340 内完整显示 |

- **图片会等比完整显示，不再裁切。** 已加载图片使用 `object-fit: contain`，不同长宽比都可以；建议使用上面接近的比例以获得更好的留白效果。
- 只有缺图时才使用固定 180px 高的虚线占位框。
- 结果页只显示分数对应档位的一张图，其余隐藏。
- **扩展名必须和真实格式一致**：`.jpg` 必须是真正的 JPEG，不能只是把 `.webp` 改名。格式不匹配时浏览器可能无法显示图片。
- GIF 建议小于 3 MB。
- 详细清单也见 `assets/README.md`。

---

## 4. 部署到 GitHub Pages

更详细的网页上传步骤、截图替代说明和常见问题见 [GitHub上传教程.md](GitHub上传教程.md)。

简要步骤：

1. 在 GitHub 新建一个 **Public** 仓库，不要初始化 README。
2. 进入仓库，点击 **Add file → Upload files**。
3. 打开本文件夹，选中**文件夹里面的全部内容**（必须包含 `index.html`、`reference.mp3` 和整个 `assets/`），拖到 GitHub 上传。
4. 底部点击 **Commit changes**。
5. 进入 **Settings → Pages**，Source 选择 **Deploy from a branch**，Branch 选择 `main`，目录选择 `/ (root)`，点击 **Save**。
6. 等待 1–3 分钟，访问：

   ```text
   https://<用户名>.github.io/<仓库名>/
   ```

注意事项：

- 上传时不要连外层 `奶龙大笑相似度` 文件夹一起上传，否则网站会多一层路径。
- `.nojekyll` 最好一起上传；如果没上传，也可以临时省略或通过 GitHub 新建空文件。
- `启动游戏.bat`、`server.js`、`使用说明.txt` 仅供本地预览，不需要部署；部署了也不影响线上游戏。
- 页面业务资源全部使用相对路径，因此在 `/<仓库名>/` 子路径下可正常工作。
- GitHub Pages 默认提供 HTTPS，满足麦克风需要 secure context 的要求。
- **隐私与版权提醒**：把 `reference.mp3` 和图片放进公开仓库后，任何访问站点的人都可以下载它们。请只上传你拥有传播权的内容；你的录音仍然不会上传。
- 若替换图片后显示旧图，请强制刷新（Ctrl+F5 / Cmd+Shift+R）或等待缓存更新。
- GitHub Pages 有体积限制；参考音频和 GIF 不宜过大。

---

## 5. 评分算法简述

全部计算都在浏览器本地执行。

### 5.1 预处理

1. 使用**同一个 AudioContext** 解码用户录音和参考音频，采样率使用 `AudioContext.sampleRate` 的实际值。
2. 多声道音频按通道求平均，转成单声道 `Float32Array`。
3. 静音门限：用户录音原始峰值 `< 0.01` 或 RMS `< 0.001` 时，直接给 0 分并提示“没有录到有效声音”。该判断发生在峰值归一化之前，避免把底噪放大成有效声音。
4. 两段音频分别做峰值归一化。
5. 用帧长 1024、帧移 512 的帧 RMS 裁剪首尾静音：活跃阈值为 `max(0.004, 最大帧 RMS × 0.06)`，首尾各保留 50ms 余量。
6. 参考音频取裁剪后的前 10 秒；用户录音最长 10 秒；不足一帧（1024 个采样点）的尾部直接丢弃，不补零。
7. 有效声音不足 0.18 秒时，按“没有录到有效声音”处理。

### 5.2 特征提取（Meyda）

- 帧长 **1024**、帧移 **512**，手动应用 **Hann 窗**。
- 关闭 Meyda 内建窗函数（避免重复加窗），每帧调用：

  ```js
  Meyda.extract('mfcc', frame, {
    sampleRate,
    bufferSize: 1024,
    melBands: 26,
    numberOfMFCCCoefficients: 13
  });
  ```

- 每帧得到 **13 维 MFCC**。对 MFCC 序列逐维取均值，再计算逐维一阶差分的均值，拼接为 **26 维特征向量**。
- **频谱比较去掉第 0 维 c0，使用 c1–c12 的 12 维均值 + 12 维差分 = 24 维频谱向量。** c0 主要反映响度/麦克风增益，保留它会让大喊、噪声等无关声音仅凭“能量大”就获得虚高相似度。13 维 MFCC 仍完整计算，调试信息中展示 13 维原始维度。
- 每帧 RMS 能量组成包络，重采样到 **100 个点**保留；节奏比较时另外生成 **50ms 固定时间网格**，以便按真实时间对齐不同长度的录音。

### 5.3 相似度与分数映射

1. 24 维频谱向量计算余弦相似度 `cos` ∈ [-1, 1]。
2. **频谱相似度映射**：先截断为 `max(0, cos)`，再平方：

   ```text
   mfccSim = max(0, cos)²
   ```

   负相关视为 0。平方用于压低高维余弦中“无关音频也偏高”的模糊相似基线，同时保留真正接近的匹配；该映射固定、通用，不针对测试样本调参。

3. **节奏相似度**：两段音频的 50ms 能量包络不再强制首尾对齐，而是把较短的一方在较长的一方上滑动，在所有合法起点中取皮尔逊相关系数最高值 `r` ∈ [-1, 1]。这样，用户的笑声不必和参考音频同时开始、同长度结束，也不会因为整体时长不同而被误判。
4. **包络相似度映射**：`envSim = max(0, r)`，负相关视为 0。
5. 当任一包络方差接近 0（例如恒定音量）导致相关系数无效时，只使用频谱相似度：
   - 包络有效：`finalSimilarity = 0.8 × mfccSim + 0.2 × envSim`
   - 包络无效：`finalSimilarity = mfccSim`
6. 分数为 `round(100 × finalSimilarity)`，范围 0–100；页面另外显示保留一位小数的综合相似度百分比。
7. 结果文案按整数分数判定：
   - **≥ 85**：奶龙本龙！
   - **70–84**：有内味了
   - **50–69**：再练练
   - **< 50**：不太像，再来一次
8. 结果配图：`≥ 85` 用 `result-win.jpg`，`50–84` 用 `result-mid.jpg`，`< 50` 用 `result-low.jpg`。

**为什么随机声音不再容易拿高分，真实笑声分数也不会被压低？** 之前的实现直接比较包含 c0 的 26 维余弦，c0 的响度成分会让任何大声、能量充足的声音都获得很高的基础相似度；同时包络强制与参考音频首尾对齐，长度或起始时间不同的真实笑声会在节奏分上被误伤。现在频谱只看 c1–c12 的音色/频谱形状，包络按最佳时间位置对齐，并且原始静音门限仍然保留。算法不依赖特定测试音频，也没有针对某个测试用例写死分数。

### 5.4 性能设计

- 评分开始前先切换到“分析中…”并等待一帧渲染，再开始解码和特征计算。
- 每 32 个分析帧主动让出主线程（`setTimeout`），刷新进度条，避免 10 秒音频一次阻塞页面。
- 参考音频特征在同一页面会话中缓存；重新录制时只需再分析用户录音。
- 包络对齐最多只需比较几十个 50ms 起点，计算量可以忽略。

---

## 6. 隐私说明

- 麦克风录音仅存在于当前页面的内存与 Blob 中，分析结束后不会保存、上传或写入服务器。
- 页面没有账号、业务后端、统计代码或广告脚本。
- 页面通过浏览器本地 `fetch('./reference.mp3')` 读取参考音频；该文件是站点静态资源，因此部署后访问者可以下载它。
- `server.js` 只是本地静态文件服务器；它不接收、不记录、不保存任何录音。
- 除从 jsDelivr 加载 Meyda 脚本外，不向第三方发送音频或录音数据。若使用本地 `vendor/meyda.min.js`，页面运行时不依赖第三方 CDN。
- 请仅公开部署你有权传播的参考音频。

---

## 7. Meyda CDN 不可用时的回退方案

页面当前从固定版本 CDN 加载：

```html
<script defer src="https://cdn.jsdelivr.net/npm/meyda@5.6.3/dist/web/meyda.min.js"
        onerror="window.__meydaLoadFailed = true;"></script>
```

如果 CDN 在你的网络环境中不可用：

1. 在项目中创建 `vendor/` 目录。
2. 下载 Meyda 5.6.3 的浏览器构建文件，保存为 `vendor/meyda.min.js`。

   macOS / Linux：

   ```bash
   mkdir -p vendor
   curl -L https://cdn.jsdelivr.net/npm/meyda@5.6.3/dist/web/meyda.min.js -o vendor/meyda.min.js
   ```

   Windows PowerShell：

   ```powershell
   New-Item -ItemType Directory -Force vendor
   Invoke-WebRequest `
     -Uri "https://cdn.jsdelivr.net/npm/meyda@5.6.3/dist/web/meyda.min.js" `
     -OutFile "vendor/meyda.min.js"
   ```

   也可以从 npm 包中取文件：

   ```bash
   npm pack meyda@5.6.3
   tar -xf meyda-5.6.3.tgz
   mkdir -p vendor
   cp package/dist/web/meyda.min.js vendor/meyda.min.js
   ```

3. 把 `index.html` 中的 CDN 地址改为本地相对路径：

   ```html
   <script defer src="vendor/meyda.min.js"
           onerror="window.__meydaLoadFailed = true;"></script>
   ```

4. 刷新页面。`app.js` 不需要改。
5. 不要忘了把 `vendor/meyda.min.js` 一起部署，否则线上仍会缺少依赖。

CDN 加载失败时，页面顶部会显示中文提示，并阻止开始评分，不会静默算错。

---

## 8. 浏览器支持与常见问题

- 推荐最新版 Chrome / Edge / Safari / Firefox 桌面或移动版。
- 需要浏览器支持 `getUserMedia`、`MediaRecorder`、Web Audio API，并运行在 HTTPS 或 localhost。
- **打不开 localhost:8000**：确认黑色服务器窗口仍在运行；它关闭后地址就失效。直接双击 `index.html` 不符合麦克风的安全要求。
- **报错找不到 Node.js**：双击启动脚本时提示；安装 Node.js 后重试。
- **麦克风被拒绝**：在地址栏站点权限里重新允许，或刷新页面。
- **提示缺少参考音频**：确认根目录存在 `reference.mp3` 或 `reference.wav`，文件名大小写一致，并且是通过服务器访问而不是双击 HTML。
- **提示参考音频无法解码**：换用常见 MP3 或 16-bit PCM WAV。
- **录音没有声音**：确认系统输入设备、浏览器权限和麦克风静音状态；录音时观察音量条。
- **图片显示占位**：把对应文件名放进 `assets/` 后刷新；如果文件其实存在，请确认扩展名与真实格式一致（例如 `.jpg` 不能是改名后的 WebP），并强制刷新缓存。占位不会影响录音评分。

---

## 9. 素材版权

- 本包内的图片由使用者自行提供；参考音频 `reference.mp3` 由使用者提供，原文件名 `奶龙大笑_爱给网_aigei_com.mp3`。其版权/授权状态由提供者自行确认；如果不确定是否拥有公开传播权，请不要将它部署到公开网站。
- 项目仅供娱乐与学习，不包含、内置或生成任何替代的参考音频。

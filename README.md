# 办公工具箱

本地离线的多功能网页工具箱：批量下载、文本整理、格式转换、发票字段提取……  
**一个入口，双击 `index.html` 就能用。** 不用装 Python、不用起服务、不用上传数据。

> 原「链接批量下载器」已完整保留为其中一项工具，并扩展了十余个办公常用能力。

---

## 快速开始

1. 下载/克隆本仓库
2. **双击 `index.html`**（推荐 Chrome / Edge 86+）— 网页版
3. 左侧选工具，用完即走

### 桌面版（exe）

- 推荐分发：`dist/办公工具箱_1.1.0_x64-setup.exe`（**精简包**，体积更小）  
- 便携：拷贝 `dist/portable/` 整个文件夹（含 `resources\bin\`）

桌面版能力：

| 功能 | 依赖 |
|---|---|
| 音视频转码 | **内置 FFmpeg** |
| 图片 OCR | **Windows 系统 OCR**（PixPin 同类；可选装 Tesseract 增强） |
| Office → PDF | 可选安装 LibreOffice（应用内提供下载链接） |
| 托盘 / 右键菜单 / 大文件清理 | 无额外依赖 |

打开 **桌面设置 → 可选增强组件**，即可看到 Tesseract、LibreOffice、FFmpeg 完整版的官方下载链接。

自己从源码打包见 **[BUILD_TAURI.md](BUILD_TAURI.md)**。

所有处理都在浏览器/本机完成，**文件与文本不会上传到任何服务器**。

---

## 工具一览

### 下载与校验
| 工具 | 说明 |
|---|---|
| **批量下载** | 扫描文件夹里所有 txt 的下载链接，按文件名自动分目录；断点续传、并发、SHA-256、导出 TXT/Excel |
| **哈希校验** | 本地文件/文件夹 SHA-256 / MD5，可写 `_checksums.sha256.txt` |
| **哈希对比** | 比较两段哈希或两个文件的 SHA-256 是否一致 |
| **批量重命名** | 规则预览后重命名（替换/前后缀/编号），Chrome 可原地改文件夹 |

### 文本处理
| 工具 | 说明 |
|---|---|
| **文本处理** | 多行→一行（自定义分隔符）、去重、排序、加序号、提取链接/邮箱/手机号/身份证、批量前后缀、查找替换 |
| **JSON 工具** | 格式化、压缩、键排序、转义，JSON ↔ CSV |
| **SQL 格式化** | 本地美化 SQL（关键字大写、子句换行） |
| **编码转换** | Base64（含 URL-safe）、URL、HTML 实体；UTF-8 / GBK / UTF-16 文本编码（GBK 请走「从文件读取」） |
| **正则测试** | 实时匹配高亮，常用模板（手机/邮箱/链接/身份证） |
| **文本对比** | 行级 Diff，新增/删除高亮 |

### 格式转换
| 工具 | 说明 |
|---|---|
| **表格互转** | CSV / TSV / JSON 数组 / Markdown 表格 互转，一键导出 `.xlsx` |
| **图片工具** | PNG / JPG / WebP 互转、质量压缩、最长边缩放、右下角水印，打包 ZIP 下载 |
| **图片裁剪** | 拖拽框选、1:1/16:9 等比例锁、导出 PNG/JPG/WebP |
| **长图拼接** | 多图拼横向/竖向长图，间距、背景、宽度上限可调 |
| **PDF 工具** | 合并、拆分、旋转、加页码、提取页、查看信息（本地 pdf-lib） |
| **PDF 加密** | 本地加密/解密 PDF（打开密码） |
| **Markdown 编辑器** | 左写右预览、工具栏、草稿自动保存、导出 .md / 自包含 HTML |

### 办公实用
| 工具 | 说明 |
|---|---|
| **发票提取** | 从发票文字 / 带文字层 PDF 提取：发票号码、开票日期、价税合计、购销方、税额等，导出 CSV/Excel |
| **二维码生成** | 文本/链接 → 二维码 PNG，可调纠错与颜色 |
| **颜色 / 色板** | HEX/RGB/HSL 转换，图片提取主色 |
| **时间戳** | 秒/毫秒 ↔ 本地时间、UTC |
| **密码 / UUID** | 强随机密码、UUID v4、验证码、随机串 |
| **房贷 / 利息** | 等额本息/等额本金月供，单利复利终值 |
| **文本统计** | 字数、行数、中英数字、段落、预计阅读时间 |
| **JWT 查看** | 本地解析 Header / Payload，不验签不上传 |
| **AES / HMAC** | AES-256-GCM 加解密（PBKDF2）、HMAC-SHA* 签名 |
| **统一输出目录** | 设置常用文件夹后，各类导出优先写入该目录 |

首页支持**工具搜索**（也可按 `/` 快捷聚焦）。

---

## 批量下载（原功能保留）

```
文档清单/
├── R5300.txt          <- 原始清单
├── R5300/             <- 自动创建，存放 R5300.txt 里的所有下载
│   ├── 产品白皮书.pdf
│   └── ...
```

支持 txt 四种写法：纯链接 / 序号+标题+链接 / 标题行+链接行 / Markdown 链接。  
同名策略：续传（推荐）/ 跳过 / 重新下载。详见工具内「帮助」折叠说明。

**必须用 Chrome / Edge**（File System Access API）。Firefox / Safari 无法读写本地文件夹，其余文本类工具仍可用。

---

## 发票识别说明

为保持**完全离线、零依赖**，本工具不做图片 OCR：

1. **电子发票 PDF**（有文字层）→ 点「从 PDF 提取文字」通常可直接解析  
2. **扫描件 / 图片** → 先用微信、QQ 或专业 OCR 识别文字，再粘贴  
3. **批量** → 多张文字用空行或 `====` 分隔，或拖入多个 `.txt`

自动字段：发票代码/号码、开票日期、校验码后 6 位、购销方名称与税号、金额、税额、价税合计（含大写）。

---

## 目录结构

```
Project_010_链接批量下载器/
├── index.html          # 入口（双击打开）
├── css/style.css
├── js/
│   ├── core.js         # 通知 / 哈希 / XLSX / ZIP 等公共库
│   ├── download.js     # 批量下载
│   ├── hash.js         # 哈希校验
│   ├── text.js         # 文本处理
│   ├── json.js         # JSON
│   ├── encode.js       # 编码
│   ├── regexdiff.js    # 正则 + Diff
│   ├── convert.js      # 表格互转
│   ├── image.js        # 图片
│   ├── invoice.js      # 发票提取
│   ├── qrcode.js       # 二维码
│   ├── extras.js       # 时间戳 / 密码
│   ├── imgedit.js      # 裁剪 / 拼接
│   ├── pdf.js          # PDF 工具
│   ├── markdown.js     # Markdown 编辑器
│   ├── office.js       # JWT / 文本统计 / 房贷利息
│   ├── aescrypto.js    # AES / HMAC
│   ├── rename.js       # 批量重命名
│   ├── extra-tools.js  # 加密PDF/哈希对比/颜色/SQL
│   ├── outdir.js       # 统一输出目录
│   ├── vendor/         # 本地第三方（pdf-lib、markdown-it）
│   └── app.js          # 导航与首页搜索
├── scripts/sync-web.cjs  # 同步网页资源到 web/（Tauri 用）
├── src-tauri/            # Tauri 桌面壳（打包 exe）
├── package.json
├── BUILD_TAURI.md
├── dist/                 # 本地生成的安装包（gitignore）
├── 链接批量下载器.html  # 旧版单文件（可删，功能已并入）
├── README.md
└── LICENSE
```

旧的 `链接批量下载器.html` 仍可单独使用；新入口统一走 `index.html`。

---

## 技术说明

| | |
|---|---|
| 语言 | 原生 HTML + CSS + JS，**零构建**；库文件本地 vendor，无外网 CDN |
| 文件读写 | File System Access API（下载/哈希/文件夹选图） |
| 下载 | `fetch` + `ReadableStream` 流式落盘 + Range 续传 |
| Excel / ZIP | 浏览器 `CompressionStream` 手写 OOXML / ZIP |
| 二维码 | 内置精简 QR 编码器（byte 模式，纠错 L/M/Q/H） |
| PDF 编辑 | [pdf-lib](https://github.com/Hopding/pdf-lib)（本地 vendor） |
| Markdown | [markdown-it](https://github.com/markdown-it/markdown-it)（本地 vendor） |
| PDF 文字 | 内置轻量解析（FlateDecode + ToUnicode），电子发票文字层可用；扫描件需先 OCR |
| 额外依赖 | 仅 `js/vendor/` 下两个库，仍可完全离线双击使用 |

---

## 常见问题

**Q：为什么不上传文件？**  
A：设计目标是「本地离线」。所有计算都在你电脑的浏览器里完成，适合处理带隐私的发票、清单、内部文档。

**Q：Firefox 打不开批量下载？**  
A：Firefox 不支持 File System Access API。请用 Chrome / Edge。

**Q：图片发票怎么提取？**  
A：先 OCR 成文字再粘贴进「发票提取」。纯离线方案无法内置完整中文 OCR（体积与版权限制）。

**Q：能拷到 U 盘给别人吗？**  
A：可以。整个文件夹拷走即可，注意保持 `index.html` 与 `css/`、`js/` 的相对路径。

---

## License

MIT

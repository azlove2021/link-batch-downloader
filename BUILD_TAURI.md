# 打包成 Windows exe（Tauri）

当前仓库里：

- **网页版**：双击根目录 `index.html` 即可用（推荐 Chrome / Edge）
- **桌面版（exe）**：用 `src-tauri/` 壳把同一套页面打进安装包

## 前置条件（只装一次）

1. **Node.js** 18+（你已有）
2. **Rust**（stable / MSVC）  
   下载安装：https://rustup.rs  
   安装时选默认 MSVC 工具链
3. **WebView2**  
   Win10/11 一般自带；没有的话安装器会提示

安装 Rust 后新开一个终端，确认：

```powershell
rustc --version
cargo --version
```

## 安装依赖

在项目根目录：

```powershell
npm install
```

## 开发预览（不打安装包）

```powershell
npm run dev
```

会弹出桌面窗口，内容与网页版相同。

## 打正式 exe / 安装包

```powershell
# 1) 准备随包依赖（本机有 FFmpeg/Tesseract 时拷贝；只需一次）
powershell -ExecutionPolicy Bypass -File scripts\fetch-bundled-deps.ps1

# 2) 打包
npm run build
```

产物（在 `dist\` 或 `src-tauri\target\release\bundle\nsis\`）：

```
办公工具箱_1.1.0_x64-setup.exe   # 推荐发给别人（已含 FFmpeg + Tesseract）
```

## 随安装包分发的依赖

| 依赖 | 用途 | 是否打进安装包 |
|---|---|---|
| **FFmpeg（仅 ffmpeg.exe）** | 音视频转码 | **是** |
| **Windows 系统 OCR** | 图片识别（PixPin 同类） | 无需打包 |
| Tesseract | 更强离线 OCR | **否** — 应用内「增强组件」提供链接 |
| LibreOffice | Office → PDF | **否** — 应用内提供链接 |
| ffprobe | 探测 | **否**（精简包不带） |

打包前先准备内置 ffmpeg：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fetch-bundled-deps.ps1
npm run build
```

`resources/bin/` 默认 **不进 Git**；安装包会带上内置 ffmpeg。

## 首次构建可能较慢

首次要编译 Rust 依赖，可能 5～20 分钟。之后增量会快很多。

## 图标

`src-tauri/icons/` 里需要至少：

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.ico`

若尚无图标，可先用 `npm run tauri icon path/to/icon.png` 从一张 1024×1024 PNG 生成全套。

## 和网页版的关系

| | 网页版 | 桌面版 |
|---|---|---|
| 入口 | `index.html` | 安装后的「办公工具箱」 |
| 代码 | 同一套 `css/` `js/` | 同一套 |
| FFmpeg / OCR | 不可用 | **安装包自带** |
| 更新 | 拷文件即可 | 重新 `npm run build` |

桌面壳包含：窗口、系统托盘、右键菜单、FFmpeg 转码、Tesseract OCR、大文件清理等。

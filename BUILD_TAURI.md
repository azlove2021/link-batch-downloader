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
npm run build
```

成功后产物大致在：

```
src-tauri\target\release\bundle\
  nsis\办公工具箱_1.0.0_x64-setup.exe   # 推荐发给别人
  msi\办公工具箱_1.0.0_x64_en-US.msi
```

把 **setup.exe** 拷给别人安装即可。

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
| 更新 | 拷文件即可 | 重新 `npm run build` |

桌面壳目前是**最小骨架**：窗口 + 原页面。后续可再加：系统托盘、右键菜单、检测本机 FFmpeg、全局快捷键等。

//! 桌面能力：环境检测、FFmpeg 转码、LibreOffice 转换、OCR、大文件清理、右键菜单、原生下载
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
pub struct EnvStatus {
    pub app_version: String,
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub soffice: Option<String>,
    pub tesseract: Option<String>,
    pub is_desktop: bool,
}

fn which(cmd: &str) -> Option<String> {
    // PATH
    if let Ok(paths) = std::env::var("PATH") {
        for p in std::env::split_paths(&paths) {
            let mut cand = p.join(cmd);
            if cand.is_file() {
                return Some(cand.to_string_lossy().to_string());
            }
            cand = p.join(format!("{}.exe", cmd));
            if cand.is_file() {
                return Some(cand.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn first_existing(cands: &[PathBuf]) -> Option<String> {
    for c in cands {
        if c.is_file() {
            return Some(c.to_string_lossy().to_string());
        }
    }
    None
}

/// 应用自带依赖目录：安装后 <装目录>\resources\bin\
fn bundled_bin() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for cand in [
        dir.join("resources").join("bin"),
        dir.join("bin"),
    ] {
        if cand.is_dir() {
            return Some(cand);
        }
    }
    // 开发模式：src-tauri/resources/bin
    if let Some(dev) = dir
        .ancestors()
        .map(|a| a.join("src-tauri").join("resources").join("bin"))
        .find(|p| p.is_dir())
    {
        return Some(dev);
    }
    None
}

fn bundled_tool(rel: &str) -> Option<String> {
    let base = bundled_bin()?;
    let p = base.join(rel);
    if p.is_file() {
        return Some(p.to_string_lossy().to_string());
    }
    None
}

pub fn detect_ffmpeg() -> Option<String> {
    // 优先用软件自带（分发给他人也能用）
    if let Some(p) = bundled_tool("ffmpeg/ffmpeg.exe") {
        return Some(p);
    }
    if let Some(p) = which("ffmpeg") {
        return Some(p);
    }
    first_existing(&[
        PathBuf::from(r"C:\ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(r"D:\ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"),
    ])
}

pub fn detect_ffprobe() -> Option<String> {
    if let Some(p) = bundled_tool("ffmpeg/ffprobe.exe") {
        return Some(p);
    }
    if let Some(p) = which("ffprobe") {
        return Some(p);
    }
    first_existing(&[
        PathBuf::from(r"C:\ffmpeg\bin\ffprobe.exe"),
        PathBuf::from(r"D:\ffmpeg\bin\ffprobe.exe"),
    ])
}

pub fn detect_soffice() -> Option<String> {
    if let Ok(p) = std::env::var("SOFFICE_PATH") {
        if Path::new(&p).is_file() {
            return Some(p);
        }
    }
    if let Some(p) = which("soffice") {
        return Some(p);
    }
    if let Some(p) = which("soffice.com") {
        return Some(p);
    }
    if let Some(p) = which("soffice.exe") {
        return Some(p);
    }
    first_existing(&[
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.com"),
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.com"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
        PathBuf::from(r"D:\Program Files\LibreOffice\program\soffice.com"),
        PathBuf::from(r"D:\Program Files\LibreOffice\program\soffice.exe"),
    ])
}

fn user_tessdata() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(home).join("tessdata");
        if p.join("eng.traineddata").is_file() || p.join("chi_sim.traineddata").is_file() {
            return Some(p);
        }
    }
    if let Ok(p) = std::env::var("TESSDATA_PREFIX") {
        let pb = PathBuf::from(&p);
        if pb.is_dir() {
            return Some(pb);
        }
    }
    None
}

fn preferred_tessdata() -> Option<PathBuf> {
    if let Some(p) = user_tessdata() {
        return Some(p);
    }
    None
}

pub fn detect_tesseract() -> Option<String> {
    // 不再打包 Tesseract；仅检测用户是否自行安装
    if let Ok(p) = std::env::var("TESSERACT_PATH") {
        if Path::new(&p).is_file() {
            return Some(p);
        }
    }
    if let Some(p) = which("tesseract") {
        return Some(p);
    }
    first_existing(&[
        PathBuf::from(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
        dirs::data_local_dir()
            .map(|d| d.join("Programs\\Tesseract-OCR\\tesseract.exe"))
            .unwrap_or_default(),
    ])
}

#[tauri::command]
pub fn env_status() -> EnvStatus {
    EnvStatus {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        ffmpeg: detect_ffmpeg(),
        ffprobe: detect_ffprobe(),
        soffice: detect_soffice(),
        tesseract: detect_tesseract(),
        is_desktop: true,
    }
}

fn run_capture(cmd: &str, args: &[String], timeout_note: &str) -> Result<String, String> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("无法启动 {}：{}", cmd, e))?;
    let mut msg = String::new();
    if !out.stdout.is_empty() {
        msg.push_str(&String::from_utf8_lossy(&out.stdout));
    }
    if !out.stderr.is_empty() {
        if !msg.is_empty() {
            msg.push('\n');
        }
        msg.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    if !out.status.success() {
        return Err(format!("{}（退出码 {:?}）\n{}", timeout_note, out.status.code(), msg));
    }
    Ok(msg)
}

/// 用 FFmpeg 转码：input → output（output 可放在同一目录，扩展名决定格式）
#[tauri::command]
pub fn ffmpeg_convert(
    ffmpeg: String,
    input: String,
    output: String,
    extra_args: Option<Vec<String>>,
) -> Result<String, String> {
    let outp = PathBuf::from(&output);
    if let Some(dir) = outp.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut args = vec![
        "-y".into(),
        "-i".into(),
        input.clone(),
    ];
    if let Some(extra) = extra_args {
        args.extend(extra);
    }
    // 默认按容器重编码视频+音频；用户可用 extra_args 覆盖
    if !args.iter().any(|a| a == "-c:v" || a == "-c:a" || a == "-c") {
        args.push("-c:v".into());
        args.push("libx264".into());
        args.push("-preset".into());
        args.push("veryfast".into());
        args.push("-crf".into());
        args.push("23".into());
        args.push("-c:a".into());
        args.push("aac".into());
        args.push("-b:a".into());
        args.push("160k".into());
        args.push("-movflags".into());
        args.push("+faststart".into());
    }
    args.push(output.clone());
    run_capture(&ffmpeg, &args, "FFmpeg 转码失败")
}

/// 音频提取：视频 → 音频
#[tauri::command]
pub fn ffmpeg_extract_audio(ffmpeg: String, input: String, output: String) -> Result<String, String> {
    let mut args = vec![
        "-y".into(), "-i".into(), input,
        "-vn".into(), "-acodec".into(), "libmp3lame".into(),
        "-q:a".into(), "2".into(), output,
    ];
    let _ = &mut args;
    run_capture(&ffmpeg, &args, "提取音频失败")
}

/// LibreOffice / WPS：Office 文档 → PDF
#[tauri::command]
pub fn office_to_pdf(soffice: String, input: String, out_dir: String) -> Result<String, String> {
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let outp = PathBuf::from(&out_dir);
    // headless convert-to pdf
    let args = vec![
        "--headless".into(),
        "--norestore".into(),
        format!("-env:UserInstallation=file:///{}", unique_profile()),
        "--convert-to".into(),
        "pdf".into(),
        "--outdir".into(),
        out_dir.clone(),
        input.clone(),
    ];
    run_capture(&soffice, &args, "Office 转 PDF 失败")?;
    let stem = Path::new(&input)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let pdf = outp.join(format!("{}.pdf", stem));
    if pdf.is_file() {
        Ok(pdf.to_string_lossy().to_string())
    } else {
        Err(format!("未找到输出文件：{}", pdf.display()))
    }
}

fn unique_profile() -> String {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    format!("lo-profile-{}", t).replace('\\', "/")
}

/// Windows OCR（WinRT）via PowerShell —— 系统自带，无需下载模型
#[tauri::command]
pub fn ocr_image_powershell(path: String) -> Result<String, String> {
    let escaped = path.replace('\'', "''");
    let ps = format!(
        r#"
$ErrorActionPreference = 'Stop'
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$file = [Windows.Storage.StorageFile]::GetFileFromPathAsync('{escaped}').AsTask().GetAwaiter().GetResult()
$stream = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read).AsTask().GetAwaiter().GetResult()
$decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream).AsTask().GetAwaiter().GetResult()
$bitmap = $decoder.GetSoftwareBitmapAsync().AsTask().GetAwaiter().GetResult()
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {{ throw '系统 OCR 引擎不可用（可能未安装语言包）' }}
$result = $engine.RecognizeAsync($bitmap).AsTask().GetAwaiter().GetResult()
$result.Text
"#,
        escaped = escaped
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps])
        .output()
        .map_err(|e| format!("启动 PowerShell 失败：{}", e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        // 回退 tesseract
        if let Some(tess) = detect_tesseract() {
            return ocr_tesseract(tess, path);
        }
        return Err(format!("Windows OCR 失败：{}", err));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn ocr_tesseract(tesseract: String, path: String) -> Result<String, String> {
    let tessdata = preferred_tessdata();
    let mut base_args: Vec<String> = vec![];
    if let Some(td) = &tessdata {
        base_args.push("--tessdata-dir".into());
        base_args.push(td.to_string_lossy().to_string());
    }
    let mut args_chi = base_args.clone();
    args_chi.push(path.clone());
    args_chi.push("stdout".into());
    args_chi.push("-l".into());
    args_chi.push("chi_sim+eng".into());

    let out = Command::new(&tesseract)
        .args(&args_chi)
        .output()
        .map_err(|e| format!("Tesseract 启动失败：{}", e))?;
    if !out.status.success() {
        let mut args_en = base_args;
        args_en.push(path);
        args_en.push("stdout".into());
        args_en.push("-l".into());
        args_en.push("eng".into());
        let out2 = Command::new(&tesseract)
            .args(&args_en)
            .output()
            .map_err(|e| e.to_string())?;
        if !out2.status.success() {
            return Err(String::from_utf8_lossy(&out2.stderr).to_string());
        }
        return Ok(String::from_utf8_lossy(&out2.stdout).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub fn ocr_image(path: String, tesseract: Option<String>) -> Result<String, String> {
    // 默认 Windows 系统 OCR（安装包不带 Tesseract）；系统失败时再尝试本机已装的 Tesseract
    let tess_path = tesseract
        .filter(|s| !s.is_empty() && Path::new(s).is_file())
        .or_else(detect_tesseract);

    match ocr_image_powershell(path.clone()) {
        Ok(text) => Ok(text),
        Err(sys_err) => {
            if let Some(t) = tess_path {
                match ocr_tesseract(t, path) {
                    Ok(t2) => Ok(t2),
                    Err(e) => Err(format!("系统 OCR 失败：{}\nTesseract 失败：{}", sys_err, e)),
                }
            } else {
                Err(format!(
                    "{}\n（可在「桌面设置」安装可选 Tesseract 增强包，或在 Windows 设置中安装 OCR 语言包）",
                    sys_err
                ))
            }
        }
    }
}

#[derive(Serialize)]
pub struct LargeFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: Option<String>,
}

#[tauri::command]
pub fn scan_large_files(
    root: String,
    min_mb: u64,
    max_results: Option<u32>,
) -> Result<Vec<LargeFile>, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err("目录不存在".into());
    }
    let min = min_mb.max(1) * 1024 * 1024;
    let max = max_results.unwrap_or(200).min(1000) as usize;
    let mut out: Vec<LargeFile> = Vec::new();
    let mut stack = vec![root];
    let skip = ["$Recycle.Bin", "System Volume Information", "Windows", "node_modules", ".git"];
    while let Some(dir) = stack.pop() {
        if out.len() >= max {
            break;
        }
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for ent in rd.flatten() {
            if out.len() >= max {
                break;
            }
            let path = ent.path();
            let name = ent.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if skip.iter().any(|s| name.eq_ignore_ascii_case(s)) {
                    continue;
                }
                stack.push(path);
            } else if path.is_file() {
                if let Ok(md) = ent.metadata() {
                    let len = md.len();
                    if len >= min {
                        let modified = md
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| {
                                let secs = d.as_secs() as i64;
                                format!("{}", secs)
                            });
                        out.push(LargeFile {
                            path: path.to_string_lossy().to_string(),
                            name,
                            size: len,
                            modified,
                        });
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(out)
}

/// 移到回收站（PowerShell VB FileSystem）
#[tauri::command]
pub fn recycle_file(path: String) -> Result<(), String> {
    let escaped = path.replace('\'', "''");
    let ps = format!(
        r#"Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{escaped}','OnlyErrorDialogs','SendToRecycleBin')"#,
        escaped = escaped
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

/// 注册 Windows 右键菜单（.txt / .pdf / 文件夹空白处 → 用办公工具箱打开）
#[tauri::command]
pub fn register_context_menu(exe_path: Option<String>) -> Result<String, String> {
    let exe = exe_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.replace('\\', "\\\\"))
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "\\\\"))
        })
        .ok_or("无法确定程序路径")?;
    let ps = format!(
        r#"
$exe = '{exe}'
function Set-Menu($key) {{
  $base = "HKCU:\Software\Classes\$key\shell\OfficeToolbox"
  New-Item -Path $base -Force | Out-Null
  Set-ItemProperty -Path $base -Name '(default)' -Value '用办公工具箱处理'
  Set-ItemProperty -Path $base -Name 'Icon' -Value "$exe,0"
  New-Item -Path "$base\command" -Force | Out-Null
  Set-ItemProperty -Path "$base\command" -Name '(default)' -Value ('"' + $exe + '" "%1"')
}}
Set-Menu 'SystemFileAssociations\.txt'
Set-Menu 'SystemFileAssociations\.pdf'
Set-Menu 'Directory\Background'
'OK: ' + $exe
"#,
        exe = exe
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub fn unregister_context_menu() -> Result<String, String> {
    let ps = r#"
$keys = @(
  'HKCU:\Software\Classes\SystemFileAssociations\.txt\shell\OfficeToolbox',
  'HKCU:\Software\Classes\SystemFileAssociations\.pdf\shell\OfficeToolbox',
  'HKCU:\Software\Classes\Directory\Background\shell\OfficeToolbox'
)
foreach ($k in $keys) { Remove-Item -Path $k -Recurse -Force -ErrorAction SilentlyContinue }
'OK'
"#;
    let out = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok("已移除右键菜单".into())
}

/// 打开资源管理器并选中文件
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    Command::new("explorer")
        .args(["/select,", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/* ================= 原生下载通道（reqwest） =================
 * 价值：webview 的 fetch 发不出 Cookie/Referer/User-Agent 等禁止头，
 * 跨域也会被 CORS 拦——内网系统、防盗链链接在浏览器里就是下不了。
 * Rust 端没有这些限制：请求头原样发送、流式落盘、进度用事件推给前端。
 * 取消/中断时保留半截文件，配合 Range 续传。 */

use futures_util::StreamExt;
use std::io::{Read as IoRead, Seek, SeekFrom, Write as IoWrite};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

/// 下载任务的取消标志表（id 由前端分配）
#[derive(Default)]
pub struct DlCancel(pub Mutex<std::collections::HashMap<u64, Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
struct DlProgress {
    id: u64,
    loaded: u64,
    total: Option<u64>,
    done: bool,
}

/// 流式下载 url 到 dest。resume=true 且本地已有半截文件时自动 Range 续传。
/// 返回最终文件字节数；取消/断网返回 Err（半截文件保留，下次可续传）。
#[tauri::command]
pub async fn http_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, DlCancel>,
    id: u64,
    url: String,
    dest: String,
    headers: Vec<(String, String)>,
    resume: bool,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    let mut has_range = false;
    for (k, v) in &headers {
        if k.eq_ignore_ascii_case("range") {
            has_range = true;
        }
        req = req.header(k.as_str(), v.as_str());
    }
    let path = Path::new(&dest);
    let mut start: u64 = 0;
    if resume && path.is_file() {
        start = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if start > 0 && !has_range {
            req = req.header("Range", format!("bytes={}-", start));
        }
    }
    let resp = req.send().await.map_err(|e| format!("网络错误：{}", e))?;
    let code = resp.status().as_u16();
    if code == 416 && start > 0 {
        return Ok(start); // Range 不满足：本地多半已经是完整文件
    }
    if !(200..300).contains(&code) {
        return Err(format!("HTTP {}", code));
    }
    if start > 0 && code != 206 {
        start = 0; // 服务器不支持续传 → 从头下
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{}", e))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(start == 0)
        .open(path)
        .map_err(|e| format!("无法写入文件：{}", e))?;
    if start > 0 {
        file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    }

    let total = resp.content_length().map(|l| l + start);
    let cancel = Arc::new(AtomicBool::new(false));
    state.0.lock().unwrap().insert(id, cancel.clone());

    let mut stream = resp.bytes_stream();
    let mut loaded = start;
    let mut last_emit = std::time::Instant::now();
    let mut failure: Option<String> = None;
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            failure = Some("cancelled".into());
            break;
        }
        match chunk {
            Ok(bytes) => {
                if let Err(e) = file.write_all(&bytes) {
                    failure = Some(format!("写盘失败：{}", e));
                    break;
                }
                loaded += bytes.len() as u64;
                if last_emit.elapsed().as_millis() >= 100 {
                    last_emit = std::time::Instant::now();
                    let _ = app.emit(
                        "http-progress",
                        DlProgress { id, loaded, total, done: false },
                    );
                }
            }
            Err(e) => {
                failure = Some(format!("连接中断：{}", e));
                break;
            }
        }
    }
    let _ = file.flush();
    drop(file);
    state.0.lock().unwrap().remove(&id);
    if let Some(msg) = failure {
        return Err(msg);
    }
    let _ = app.emit("http-progress", DlProgress { id, loaded, total, done: true });
    Ok(loaded)
}

/// 取消进行中的下载（半截文件保留，可续传）
#[tauri::command]
pub fn http_cancel(state: tauri::State<'_, DlCancel>, id: u64) -> Result<(), String> {
    if let Some(flag) = state.0.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// 文件大小（不存在返回 0 —— 前端 skip/resume 判断用）
#[tauri::command]
pub fn file_size(path: String) -> Result<u64, String> {
    match std::fs::metadata(&path) {
        Ok(m) if m.is_file() => Ok(m.len()),
        _ => Ok(0),
    }
}

/// 本地文件 SHA-256（原生模式下载完校验用；浏览器句柄够不到原生路径的文件）
#[tauri::command]
pub fn sha256_file(path: String) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

/// 写文本文件（原生模式落 _checksums.sha256.txt 用）
#[tauri::command]
pub fn save_text(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

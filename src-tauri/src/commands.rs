//! 桌面能力：环境检测、FFmpeg 转码、LibreOffice 转换、OCR、大文件清理、右键菜单
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

pub fn detect_ffmpeg() -> Option<String> {
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

pub fn detect_tesseract() -> Option<String> {
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
    let tessdata = user_tessdata();
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
    if let Some(t) = tesseract.filter(|s| !s.is_empty()) {
        if Path::new(&t).is_file() {
            return ocr_tesseract(t, path);
        }
    }
    if let Some(t) = detect_tesseract() {
        return ocr_tesseract(t, path);
    }
    ocr_image_powershell(path)
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

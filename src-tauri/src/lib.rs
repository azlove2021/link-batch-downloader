// 办公工具箱 · Tauri 壳
// 前端是 web/（由 scripts/sync-web.cjs 同步自仓库根目录）；
// 桌面能力：托盘、FFmpeg/LibreOffice/OCR、转码、Office→PDF、大文件清理、右键菜单。

mod commands;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

#[tauri::command]
fn app_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "name": "办公工具箱",
        "version": env!("CARGO_PKG_VERSION"),
        "shell": "tauri2",
        "mode": "desktop"
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ctx = tauri::generate_context!();

    // 命令行参数：右键菜单传入的文件路径
    let open_path: Option<String> = std::env::args().nth(1);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // 系统托盘
            let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
            let env = MenuItem::with_id(app, "env", "检测本机工具…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &env, &quit])?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("办公工具箱 · 本地离线")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "env" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.emit("navigate-tool", "av");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            if let Some(p) = open_path.filter(|s| !s.is_empty()) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.emit("open-file", p);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::env_status,
            commands::ffmpeg_convert,
            commands::ffmpeg_extract_audio,
            commands::office_to_pdf,
            commands::ocr_image,
            commands::scan_large_files,
            commands::recycle_file,
            commands::register_context_menu,
            commands::unregister_context_menu,
            commands::reveal_in_explorer,
        ])
        .run(ctx)
        .expect("error while running tauri application");
}

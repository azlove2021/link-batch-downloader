// 办公工具箱 · Tauri 壳
// 前端就是仓库根目录的 index.html / css / js，逻辑全在网页侧；
// 这里只提供窗口与后续可扩展的 Rust 命令入口。

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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

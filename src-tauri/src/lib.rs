use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Backup file I/O for the desktop build.
//
// WKWebView has no File System Access API (showDirectoryPicker is Chromium
// only), so the browser transport in src/backup/fileBackup.ts cannot run inside
// Orbit.app. These commands are the desktop transport: plain std::fs against a
// user-picked absolute path, which is what makes an external drive a valid
// backup target.
//
// Deliberately NOT tauri-plugin-fs — its scope system is built around known
// roots ($HOME, $APPDATA) and fights arbitrary /Volumes paths. The app is not
// App-Sandboxed (see entitlements.plist: hardened runtime only), so std::fs
// reaches any path the user has granted access to, subject to the usual macOS
// TCC prompt on first touch of a removable volume.
// ---------------------------------------------------------------------------

/// Reject anything that isn't a bare filename. The directory always comes from
/// the folder picker; the name is app-generated, but this keeps a malformed or
/// tampered name from escaping the chosen folder.
fn safe_join(dir: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("Unsafe backup filename: {name}"));
    }
    Ok(Path::new(dir).join(name))
}

/// True when the backup folder is currently reachable — false for an unplugged
/// drive, which the UI surfaces instead of silently failing every autosave.
#[tauri::command]
fn backup_dir_available(dir: String) -> bool {
    Path::new(&dir).is_dir()
}

/// Read one file from the backup folder. Ok(None) when it doesn't exist yet
/// (first run), Err only for a real I/O failure.
#[tauri::command]
fn backup_read(dir: String, name: String) -> Result<Option<String>, String> {
    let path = safe_join(&dir, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Write one file into the backup folder, atomically: a full write to a
/// temporary file followed by a rename, so a crash or a drive yanked mid-write
/// can never leave a truncated orbit-db-latest.json where the whole database
/// used to be. The rename stays inside the same directory, so it is a real
/// atomic replace rather than a cross-device copy.
#[tauri::command]
fn backup_write(dir: String, name: String, contents: String) -> Result<(), String> {
    if !Path::new(&dir).is_dir() {
        return Err(format!("Backup folder is not available: {dir}"));
    }
    let path = safe_join(&dir, &name)?;
    let tmp = safe_join(&dir, &format!("{name}.tmp"))?;
    fs::write(&tmp, contents).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save {}: {e}", path.display())
    })
}

/// List the backup folder's *.json files (snapshot rotation reads this).
#[tauri::command]
fn backup_list(dir: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&dir).map_err(|e| format!("Could not open {dir}: {e}"))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".json") {
                    names.push(name.to_string());
                }
            }
        }
    }
    Ok(names)
}

/// Delete one file from the backup folder (snapshot pruning).
#[tauri::command]
fn backup_remove(dir: String, name: String) -> Result<(), String> {
    let path = safe_join(&dir, &name)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    // External links (venue website, Instagram, mailto, Neo4j Browser, the
    // Cypher tutorial) don't open anything on their own inside a Tauri
    // webview -- a plain <a target="_blank"> click is a no-op without this.
    // Frontend calls openUrl() from @tauri-apps/plugin-opener; see
    // src/utils/openExternal.ts.
    .plugin(tauri_plugin_opener::init())
    // Lets the scraper client issue requests from Rust instead of the webview.
    // The shared worker only sends CORS headers for https://venues.atharux.com,
    // so a direct fetch from a tauri:// origin is blocked by WKWebView — see
    // the transport note in src/scraper.ts.
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![
      backup_dir_available,
      backup_read,
      backup_write,
      backup_list,
      backup_remove
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

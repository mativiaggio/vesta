use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

mod local_database;

const SETUP_FILE_NAME: &str = "desktop-setup.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum DeploymentMode {
    SelfManaged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSetup {
    config_version: u8,
    mode: DeploymentMode,
    data_directory: String,
}

fn setup_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve the app config directory: {error}"))?;
    path.push(SETUP_FILE_NAME);
    Ok(path)
}

#[tauri::command]
fn get_desktop_setup(app: AppHandle) -> Result<Option<DesktopSetup>, String> {
    let path = setup_file_path(&app)?;
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read desktop setup: {error}")),
    };

    serde_json::from_slice(&contents)
        .map(Some)
        .map_err(|error| format!("Could not parse desktop setup: {error}"))
}

pub(crate) fn configured_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let setup = get_desktop_setup(app.clone())?
        .ok_or_else(|| "Choose a data folder before opening the local database.".to_owned())?;
    let requested_path = match setup.mode {
        DeploymentMode::SelfManaged => PathBuf::from(setup.data_directory),
    };
    if !requested_path.is_absolute() {
        return Err("The configured data folder must be an absolute path.".to_owned());
    }
    let data_directory = requested_path
        .canonicalize()
        .map_err(|error| format!("Could not resolve the configured data folder: {error}"))?;
    if !data_directory.is_dir() {
        return Err("The configured data folder is not available.".to_owned());
    }
    Ok(data_directory)
}

#[tauri::command]
fn get_default_data_directory(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("workspace-data").to_string_lossy().into_owned())
        .map_err(|error| format!("Could not resolve the default data directory: {error}"))
}

#[tauri::command]
fn save_self_managed_setup(app: AppHandle, data_directory: String) -> Result<DesktopSetup, String> {
    if data_directory.trim().is_empty() {
        return Err("Choose a data directory.".to_owned());
    }
    let requested_path = PathBuf::from(data_directory);
    if !requested_path.is_absolute() {
        return Err("The data directory must be an absolute path.".to_owned());
    }

    fs::create_dir_all(&requested_path)
        .map_err(|error| format!("Could not create the selected data directory: {error}"))?;
    let data_directory = requested_path
        .canonicalize()
        .map_err(|error| format!("Could not resolve the selected data directory: {error}"))?;
    if !data_directory.is_dir() || data_directory.file_name().is_none() {
        return Err("Choose a writable folder for Vesta's data.".to_owned());
    }
    ensure_writable_directory(&data_directory)?;
    local_database::initialize_database_at(&data_directory)?;

    let setup = DesktopSetup {
        config_version: 1,
        mode: DeploymentMode::SelfManaged,
        data_directory: data_directory.to_string_lossy().into_owned(),
    };
    let path = setup_file_path(&app)?;
    let config_directory = path
        .parent()
        .ok_or_else(|| "Could not resolve the setup file location.".to_owned())?;
    fs::create_dir_all(config_directory)
        .map_err(|error| format!("Could not create the app config directory: {error}"))?;

    let serialized = serde_json::to_vec_pretty(&setup)
        .map_err(|error| format!("Could not encode desktop setup: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = path.with_file_name(format!("{SETUP_FILE_NAME}.tmp-{timestamp}"));
    fs::write(&temporary_path, serialized)
        .map_err(|error| format!("Could not write desktop setup: {error}"))?;
    if let Err(error) = fs::rename(&temporary_path, &path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Could not save desktop setup: {error}"));
    }

    Ok(setup)
}

fn ensure_writable_directory(path: &std::path::Path) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let probe_path = path.join(format!(".vesta-write-check-{timestamp}"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe_path)
        .map_err(|error| format!("Could not write to the selected data directory: {error}"))?;
    let write_result = file
        .write_all(b"Vesta directory check")
        .and_then(|()| file.sync_all());
    drop(file);
    let remove_result = fs::remove_file(probe_path);

    write_result
        .map_err(|error| format!("Could not write to the selected data directory: {error}"))?;
    remove_result
        .map_err(|error| format!("Could not clean up the data directory check file: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_desktop_setup,
            get_default_data_directory,
            save_self_managed_setup,
            local_database::get_local_preference,
            local_database::set_local_preference,
            local_database::get_local_workspace_state,
            local_database::create_local_workspace,
            local_database::update_local_workspace,
            local_database::delete_local_workspace,
            local_database::activate_local_workspace,
            local_database::get_local_clients,
            local_database::create_local_client,
            local_database::update_local_client,
            local_database::delete_local_client,
            local_database::get_local_tickets,
            local_database::get_local_tickets_for_sync,
            local_database::get_next_local_ticket_ot_number,
            local_database::create_local_ticket,
            local_database::update_local_ticket,
            local_database::delete_local_ticket,
            local_database::get_local_ticket_attachments,
            local_database::add_local_ticket_attachments,
            local_database::delete_local_ticket_attachment,
            local_database::open_local_ticket_attachment,
            local_database::read_local_ticket_attachment_preview,
            local_database::open_local_ticket_attachment_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

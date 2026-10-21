mod clients;
mod preferences;
mod workspaces;

use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::AppHandle;

const DATABASE_FILE_NAME: &str = "vesta.sqlite3";
const DATABASE_VERSION: i64 = 2;

#[tauri::command]
pub fn get_local_clients(
    app: AppHandle,
    workspace_id: String,
    cursor: Option<clients::ClientCursor>,
    search: String,
) -> Result<clients::LocalClientPage, String> {
    clients::get_local_clients_impl(app, workspace_id, cursor, search)
}

#[tauri::command]
pub fn create_local_client(
    app: AppHandle,
    input: clients::CreateClientInput,
) -> Result<clients::LocalClientPage, String> {
    clients::create_local_client_impl(app, input)
}

#[tauri::command]
pub fn update_local_client(
    app: AppHandle,
    workspace_id: String,
    client_id: String,
    input: clients::UpdateClientInput,
    cursor: Option<clients::ClientCursor>,
    search: String,
) -> Result<clients::LocalClientPage, String> {
    clients::update_local_client_impl(app, workspace_id, client_id, input, cursor, search)
}

#[tauri::command]
pub fn delete_local_client(
    app: AppHandle,
    workspace_id: String,
    client_id: String,
    expected_version: i64,
) -> Result<clients::LocalClientDeletion, String> {
    clients::delete_local_client_impl(app, workspace_id, client_id, expected_version)
}

#[tauri::command]
pub fn get_local_preference(app: AppHandle, key: String) -> Result<Option<String>, String> {
    preferences::get_local_preference_impl(app, key)
}

#[tauri::command]
pub fn set_local_preference(app: AppHandle, key: String, value: String) -> Result<(), String> {
    preferences::set_local_preference_impl(app, key, value)
}

#[tauri::command]
pub fn get_local_workspace_state(
    app: AppHandle,
) -> Result<workspaces::LocalWorkspaceState, String> {
    workspaces::get_local_workspace_state_impl(app)
}

#[tauri::command]
pub fn create_local_workspace(
    app: AppHandle,
    input: workspaces::CreateWorkspaceInput,
) -> Result<workspaces::LocalWorkspaceState, String> {
    workspaces::create_local_workspace_impl(app, input)
}

#[tauri::command]
pub fn update_local_workspace(
    app: AppHandle,
    workspace_id: String,
    input: workspaces::UpdateWorkspaceInput,
) -> Result<workspaces::LocalWorkspaceState, String> {
    workspaces::update_local_workspace_impl(app, workspace_id, input)
}

#[tauri::command]
pub fn delete_local_workspace(
    app: AppHandle,
    workspace_id: String,
    confirmation_name: String,
) -> Result<workspaces::LocalWorkspaceState, String> {
    workspaces::delete_local_workspace_impl(app, workspace_id, confirmation_name)
}

#[tauri::command]
pub fn activate_local_workspace(
    app: AppHandle,
    workspace_id: String,
) -> Result<workspaces::LocalWorkspaceState, String> {
    workspaces::activate_local_workspace_impl(app, workspace_id)
}

pub(super) fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let data_directory = crate::configured_data_directory(app)?;
    open_database_at(&data_directory)
}

pub(crate) fn initialize_database_at(data_directory: &Path) -> Result<(), String> {
    open_database_at(data_directory).map(drop)
}

fn open_database_at(data_directory: &Path) -> Result<Connection, String> {
    let data_directory = data_directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve the configured data folder: {error}"))?;
    if !data_directory.is_dir() {
        return Err("The configured data folder is not available.".to_owned());
    }

    let database_path = data_directory.join(DATABASE_FILE_NAME);
    ensure_database_file_is_inside_directory(&database_path, &data_directory)?;

    let mut connection = Connection::open(&database_path)
        .map_err(|error| format!("Could not open the local Vesta database: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Could not configure the local Vesta database: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not configure the local Vesta database: {error}"))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Could not configure the local Vesta database: {error}"))?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|error| format!("Could not configure the local Vesta database: {error}"))?;

    migrate(&mut connection)?;
    Ok(connection)
}

fn ensure_database_file_is_inside_directory(
    database_path: &Path,
    data_directory: &Path,
) -> Result<(), String> {
    match fs::symlink_metadata(database_path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("The local database file cannot be a symbolic link.".to_owned())
        }
        Ok(metadata) if !metadata.is_file() => {
            Err("The local database path is not a file.".to_owned())
        }
        Ok(_) => {
            let resolved_path = database_path
                .canonicalize()
                .map_err(|error| format!("Could not resolve the local database path: {error}"))?;
            if resolved_path.parent() != Some(data_directory) {
                return Err(
                    "The local database must remain inside the configured data folder.".to_owned(),
                );
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not inspect the local database path: {error}"
        )),
    }
}

fn migrate(connection: &mut Connection) -> Result<(), String> {
    let current_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("Could not read the local database version: {error}"))?;
    if current_version > DATABASE_VERSION {
        return Err("This local database was created by a newer version of Vesta.".to_owned());
    }
    if current_version == DATABASE_VERSION {
        return Ok(());
    }

    if current_version < 1 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not prepare the local database: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE workspaces (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 48),
                accent_color TEXT NOT NULL CHECK(accent_color IN ('olive', 'blue', 'terracotta', 'plum', 'teal', 'graphite', 'sage', 'indigo', 'amber', 'rose', 'sky', 'sand')),
                icon TEXT NOT NULL CHECK(icon IN ('briefcase', 'folder', 'layers', 'notebook-pen', 'laptop', 'palette', 'building-2', 'book-open', 'code-2', 'chart-no-axes-combined', 'camera', 'pen-tool')),
                last_accessed_at TEXT,
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                membership_version INTEGER NOT NULL DEFAULT 1 CHECK(membership_version > 0),
                is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE INDEX workspace_active_name_idx ON workspaces(name COLLATE NOCASE, id) WHERE deleted_at IS NULL;
            CREATE UNIQUE INDEX workspace_single_active_idx ON workspaces(is_active) WHERE is_active = 1 AND deleted_at IS NULL;

            CREATE TABLE app_preferences (
                key TEXT PRIMARY KEY NOT NULL CHECK(key IN ('vesta.language', 'vesta.theme', 'vesta.date-format')),
                value TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

                PRAGMA user_version = 1;",
            )
            .map_err(|error| format!("Could not create the local Vesta database: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not finish the local database setup: {error}"))?;
    }

    if current_version < 2 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not prepare the local database upgrade: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE clients (
                    id TEXT PRIMARY KEY NOT NULL,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    code TEXT NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 64),
                    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
                    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    created_by_user_id TEXT NOT NULL,
                    updated_by_user_id TEXT NOT NULL,
                    deleted_by_user_id TEXT
                );
                CREATE UNIQUE INDEX client_workspace_code_active_unique
                    ON clients(workspace_id, code COLLATE NOCASE) WHERE deleted_at IS NULL;
                CREATE INDEX client_workspace_created_active_idx
                    ON clients(workspace_id, created_at, id) WHERE deleted_at IS NULL;
                PRAGMA user_version = 2;",
            )
            .map_err(|error| format!("Could not upgrade the local Vesta database: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not finish the local database upgrade: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::migrate;
    use rusqlite::Connection;

    #[test]
    fn migration_creates_soft_deletable_clients_without_removing_workspace_data() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite database");
        migrate(&mut connection).expect("migrations should apply");

        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("database version");
        let client_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'clients'",
                [],
                |row| row.get(0),
            )
            .expect("clients table should exist");

        assert_eq!(version, 2);
        assert_eq!(client_table_count, 1);
    }
}

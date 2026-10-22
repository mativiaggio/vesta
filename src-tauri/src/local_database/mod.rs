mod attachments;
mod clients;
mod note_attachments;
mod notes;
mod preferences;
mod tickets;
mod workspaces;

use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::AppHandle;

const DATABASE_FILE_NAME: &str = "vesta.sqlite3";
const DATABASE_VERSION: i64 = 7;

#[tauri::command]
pub fn get_local_notes(
    app: AppHandle,
    workspace_id: String,
    cursor: Option<notes::NoteCursor>,
    ticket_id: Option<String>,
) -> Result<notes::LocalNotePage, String> {
    notes::get_local_notes_impl(app, workspace_id, cursor, ticket_id)
}

#[tauri::command]
pub fn create_local_note(
    app: AppHandle,
    input: notes::CreateNoteInput,
) -> Result<notes::LocalNotePage, String> {
    notes::create_local_note_impl(app, input)
}

#[tauri::command]
pub fn update_local_note(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    input: notes::UpdateNoteInput,
    cursor: Option<notes::NoteCursor>,
    ticket_filter: Option<String>,
) -> Result<notes::LocalNotePage, String> {
    notes::update_local_note_impl(app, workspace_id, note_id, input, cursor, ticket_filter)
}

#[tauri::command]
pub fn delete_local_note(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    expected_version: i64,
) -> Result<notes::LocalNoteDeletion, String> {
    notes::delete_local_note_impl(app, workspace_id, note_id, expected_version)
}

#[tauri::command]
pub fn get_local_note_attachments(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    cursor: Option<attachments::AttachmentCursor>,
) -> Result<note_attachments::LocalNoteAttachmentPage, String> {
    note_attachments::list_local_note_attachments_impl(app, workspace_id, note_id, cursor)
}

#[tauri::command]
pub async fn add_local_note_attachments(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
) -> Result<Vec<note_attachments::LocalNoteAttachment>, String> {
    note_attachments::choose_and_add_local_note_attachments_impl(app, workspace_id, note_id)
}

#[tauri::command]
pub fn delete_local_note_attachment(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    attachment_id: String,
) -> Result<(), String> {
    note_attachments::delete_local_note_attachment_impl(app, workspace_id, note_id, attachment_id)
}

#[tauri::command]
pub fn open_local_note_attachment(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    attachment_id: String,
) -> Result<(), String> {
    note_attachments::open_local_note_attachment_impl(app, workspace_id, note_id, attachment_id)
}

#[tauri::command]
pub fn read_local_note_attachment_preview(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    attachment_id: String,
) -> Result<tauri::ipc::Response, String> {
    note_attachments::read_local_note_attachment_preview_impl(
        app,
        workspace_id,
        note_id,
        attachment_id,
    )
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn get_local_ticket_attachments(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    cursor: Option<attachments::AttachmentCursor>,
) -> Result<attachments::LocalTicketAttachmentPage, String> {
    attachments::list_local_ticket_attachments_impl(app, workspace_id, ticket_id, cursor)
}

#[tauri::command]
pub async fn add_local_ticket_attachments(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
) -> Result<Vec<attachments::LocalTicketAttachment>, String> {
    attachments::choose_and_add_local_ticket_attachments_impl(app, workspace_id, ticket_id)
}

#[tauri::command]
pub fn delete_local_ticket_attachment(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    attachment_id: String,
) -> Result<(), String> {
    attachments::delete_local_ticket_attachment_impl(app, workspace_id, ticket_id, attachment_id)
}

#[tauri::command]
pub fn open_local_ticket_attachment(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    attachment_id: String,
) -> Result<(), String> {
    attachments::open_local_ticket_attachment_impl(app, workspace_id, ticket_id, attachment_id)
}

#[tauri::command]
pub fn read_local_ticket_attachment_preview(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    attachment_id: String,
) -> Result<tauri::ipc::Response, String> {
    attachments::read_local_ticket_attachment_preview_impl(
        app,
        workspace_id,
        ticket_id,
        attachment_id,
    )
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn open_local_ticket_attachment_folder(app: AppHandle) -> Result<(), String> {
    attachments::open_local_ticket_attachment_folder_impl(app)
}

#[tauri::command]
pub fn get_local_tickets(
    app: AppHandle,
    workspace_id: String,
    cursor: Option<tickets::TicketCursor>,
    search: String,
    status: Option<String>,
    priority: Option<String>,
) -> Result<tickets::LocalTicketPage, String> {
    tickets::get_local_tickets_impl(app, workspace_id, cursor, search, status, priority, false)
}

#[tauri::command]
pub fn get_local_tickets_for_sync(
    app: AppHandle,
    workspace_id: String,
    cursor: Option<tickets::TicketCursor>,
) -> Result<tickets::LocalTicketPage, String> {
    tickets::get_local_tickets_impl(app, workspace_id, cursor, String::new(), None, None, true)
}

#[tauri::command]
pub fn get_next_local_ticket_ot_number(
    app: AppHandle,
    workspace_id: String,
) -> Result<i64, String> {
    tickets::get_next_local_ticket_ot_number_impl(app, workspace_id)
}

#[tauri::command]
pub fn create_local_ticket(
    app: AppHandle,
    input: tickets::CreateTicketInput,
) -> Result<tickets::LocalTicketPage, String> {
    tickets::create_local_ticket_impl(app, input)
}

#[tauri::command]
pub fn update_local_ticket(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    input: tickets::UpdateTicketInput,
    page_query: tickets::TicketPageQuery,
) -> Result<tickets::LocalTicketPage, String> {
    tickets::update_local_ticket_impl(app, workspace_id, ticket_id, input, page_query)
}

#[tauri::command]
pub fn delete_local_ticket(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    expected_version: i64,
) -> Result<tickets::LocalTicketDeletion, String> {
    tickets::delete_local_ticket_impl(app, workspace_id, ticket_id, expected_version)
}

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
    attachments::ensure_attachment_directory(&data_directory)?;

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

    if current_version < 3 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not prepare the local database upgrade: {error}"))?;
        transaction
            .execute_batch(
                "ALTER TABLE app_preferences RENAME TO app_preferences_before_tickets;
                CREATE TABLE app_preferences (
                    key TEXT PRIMARY KEY NOT NULL CHECK(key IN ('vesta.language', 'vesta.theme', 'vesta.date-format', 'vesta.tickets-view')),
                    value TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                INSERT INTO app_preferences (key, value, created_at, updated_at, deleted_at)
                    SELECT key, value, created_at, updated_at, deleted_at FROM app_preferences_before_tickets;
                DROP TABLE app_preferences_before_tickets;

                CREATE TABLE tickets (
                    id TEXT PRIMARY KEY NOT NULL,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    client_id TEXT REFERENCES clients(id),
                    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
                    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 20000),
                    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('urgent', 'high', 'medium', 'low')),
                    status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'analysis', 'development', 'review', 'correction', 'delivered', 'production')),
                    estimated_hours REAL NOT NULL DEFAULT 0 CHECK(estimated_hours >= 0 AND estimated_hours <= 999999.99),
                    worked_hours REAL NOT NULL DEFAULT 0 CHECK(worked_hours >= 0 AND worked_hours <= 999999.99),
                    coding_finished_at TEXT,
                    production_at TEXT,
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    created_by_user_id TEXT NOT NULL,
                    updated_by_user_id TEXT NOT NULL,
                    deleted_by_user_id TEXT
                );
                CREATE INDEX ticket_workspace_created_active_idx
                    ON tickets(workspace_id, created_at, id) WHERE deleted_at IS NULL;
                CREATE INDEX ticket_workspace_status_active_idx
                    ON tickets(workspace_id, status, created_at, id) WHERE deleted_at IS NULL;
                CREATE INDEX ticket_workspace_priority_active_idx
                    ON tickets(workspace_id, priority, created_at, id) WHERE deleted_at IS NULL;
                CREATE INDEX ticket_workspace_updated_idx ON tickets(workspace_id, updated_at, id);
                PRAGMA user_version = 3;",
            )
            .map_err(|error| format!("Could not upgrade the local database: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not finish the local database upgrade: {error}"))?;
    }

    if current_version < 4 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not prepare the local database upgrade: {error}"))?;
        transaction
            .execute_batch(
                "ALTER TABLE tickets ADD COLUMN ot_number INTEGER NOT NULL DEFAULT 1
                    CHECK(ot_number BETWEEN 1 AND 2147483647);
                WITH numbered AS (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS number
                    FROM tickets
                )
                UPDATE tickets SET ot_number = (
                    SELECT number FROM numbered WHERE numbered.id = tickets.id
                );
                CREATE UNIQUE INDEX ticket_workspace_ot_number_unique
                    ON tickets(workspace_id, ot_number);
                PRAGMA user_version = 4;",
            )
            .map_err(|error| format!("Could not upgrade the local database: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not finish the local database upgrade: {error}"))?;
    }

    if current_version < 5 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not prepare the local database upgrade: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE ticket_attachments (
                    id TEXT PRIMARY KEY NOT NULL,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    ticket_id TEXT NOT NULL REFERENCES tickets(id),
                    file_name TEXT NOT NULL CHECK(length(trim(file_name)) BETWEEN 1 AND 255),
                    content_type TEXT NOT NULL CHECK(length(trim(content_type)) BETWEEN 1 AND 255),
                    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
                    checksum_sha256 TEXT CHECK(checksum_sha256 IS NULL OR (length(checksum_sha256) = 64 AND checksum_sha256 NOT GLOB '*[^a-f0-9]*')),
                    storage_key TEXT NOT NULL UNIQUE,
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                    created_by_user_id TEXT NOT NULL,
                    updated_by_user_id TEXT NOT NULL,
                    deleted_by_user_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE INDEX ticket_attachment_ticket_created_active_idx
                    ON ticket_attachments(ticket_id, created_at, id) WHERE deleted_at IS NULL;
                CREATE INDEX ticket_attachment_workspace_updated_idx
                    ON ticket_attachments(workspace_id, updated_at, id);
                PRAGMA user_version = 5;",
            )
            .map_err(|error| format!("Could not upgrade the local database: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not finish the local database upgrade: {error}"))?;
    }

    if current_version < 6 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not prepare the local database upgrade: {error}"))?;
        transaction
            .execute_batch(
                "ALTER TABLE app_preferences RENAME TO app_preferences_before_ticket_detail;
                CREATE TABLE app_preferences (
                    key TEXT PRIMARY KEY NOT NULL CHECK(key IN ('vesta.language', 'vesta.theme', 'vesta.date-format', 'vesta.tickets-view', 'vesta.ticket-detail-presentation')),
                    value TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                INSERT INTO app_preferences (key, value, created_at, updated_at, deleted_at)
                    SELECT key, value, created_at, updated_at, deleted_at FROM app_preferences_before_ticket_detail;
                DROP TABLE app_preferences_before_ticket_detail;
                PRAGMA user_version = 6;",
            )
            .map_err(|error| format!("Could not upgrade the local database: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not finish the local database upgrade: {error}"))?;
    }

    if current_version < 7 {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Could not prepare the local database upgrade: {error}"))?;
        transaction
            .execute_batch(
                "CREATE TABLE notes (
                    id TEXT PRIMARY KEY NOT NULL,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    ticket_id TEXT NOT NULL REFERENCES tickets(id),
                    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
                    content TEXT NOT NULL CHECK(json_valid(content)),
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    created_by_user_id TEXT NOT NULL,
                    updated_by_user_id TEXT NOT NULL,
                    deleted_by_user_id TEXT
                );
                CREATE INDEX note_workspace_created_active_idx
                    ON notes(workspace_id, created_at, id) WHERE deleted_at IS NULL;
                CREATE INDEX note_ticket_created_active_idx
                    ON notes(ticket_id, created_at, id) WHERE deleted_at IS NULL;
                CREATE INDEX note_workspace_updated_idx ON notes(workspace_id, updated_at, id);

                CREATE TABLE note_attachments (
                    id TEXT PRIMARY KEY NOT NULL,
                    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                    note_id TEXT NOT NULL REFERENCES notes(id),
                    file_name TEXT NOT NULL CHECK(length(trim(file_name)) BETWEEN 1 AND 255),
                    content_type TEXT NOT NULL CHECK(length(trim(content_type)) BETWEEN 1 AND 255),
                    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
                    checksum_sha256 TEXT CHECK(checksum_sha256 IS NULL OR (length(checksum_sha256) = 64 AND checksum_sha256 NOT GLOB '*[^a-f0-9]*')),
                    storage_key TEXT NOT NULL UNIQUE,
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                    created_by_user_id TEXT NOT NULL,
                    updated_by_user_id TEXT NOT NULL,
                    deleted_by_user_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE INDEX note_attachment_note_created_active_idx
                    ON note_attachments(note_id, created_at, id) WHERE deleted_at IS NULL;
                CREATE INDEX note_attachment_workspace_updated_idx
                    ON note_attachments(workspace_id, updated_at, id);
                PRAGMA user_version = 7;",
            )
            .map_err(|error| format!("Could not upgrade the local database: {error}"))?;
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
    fn migration_creates_soft_deletable_clients_and_tickets_without_removing_workspace_data() {
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
        let ticket_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tickets'",
                [],
                |row| row.get(0),
            )
            .expect("tickets table should exist");
        let ticket_attachment_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'ticket_attachments'",
                [],
                |row| row.get(0),
            )
            .expect("ticket attachments table should exist");
        let note_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
                [],
                |row| row.get(0),
            )
            .expect("notes table should exist");
        let note_attachment_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'note_attachments'",
                [],
                |row| row.get(0),
            )
            .expect("note attachments table should exist");

        assert_eq!(version, 7);
        assert_eq!(client_table_count, 1);
        assert_eq!(ticket_table_count, 1);
        assert_eq!(ticket_attachment_table_count, 1);
        assert_eq!(note_table_count, 1);
        assert_eq!(note_attachment_table_count, 1);
        connection
            .execute(
                "INSERT INTO app_preferences (key, value, created_at, updated_at)
                 VALUES ('vesta.ticket-detail-presentation', 'fullscreen', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                [],
            )
            .expect("ticket detail presentation preference should be supported");
    }

    #[test]
    fn migration_backfills_ot_numbers_for_existing_local_tickets() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite database");
        migrate(&mut connection).expect("initial migrations should apply");
        connection
            .execute(
                "INSERT INTO workspaces (id, name, accent_color, icon, is_active, created_at, updated_at)
                 VALUES ('ac01e94f-379f-4e03-9d3b-94231ac32fab', 'Local', 'olive', 'briefcase', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
                [],
            )
            .expect("workspace should be inserted");
        connection
            .execute_batch(
                "DROP INDEX ticket_workspace_ot_number_unique;
                DROP TABLE note_attachments;
                DROP TABLE notes;
                DROP TABLE ticket_attachments;
                ALTER TABLE tickets DROP COLUMN ot_number;
                PRAGMA user_version = 3;
                INSERT INTO tickets (id, workspace_id, title, created_at, updated_at, created_by_user_id, updated_by_user_id)
                    VALUES ('c1a63af1-19ba-4473-aaf4-e75d9032e487', 'ac01e94f-379f-4e03-9d3b-94231ac32fab', 'Older', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'local', 'local');
                INSERT INTO tickets (id, workspace_id, title, created_at, updated_at, created_by_user_id, updated_by_user_id, deleted_at)
                    VALUES ('c1a63af1-19ba-4473-aaf4-e75d9032e488', 'ac01e94f-379f-4e03-9d3b-94231ac32fab', 'Deleted', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'local', 'local', '2026-01-02T00:00:00.000Z');",
            )
            .expect("version-three ticket data should be prepared");

        migrate(&mut connection).expect("ticket numbers should be backfilled");
        let numbers: Vec<i64> = connection
            .prepare("SELECT ot_number FROM tickets ORDER BY created_at, id")
            .expect("ticket numbers query")
            .query_map([], |row| row.get(0))
            .expect("ticket numbers should be readable")
            .collect::<Result<_, _>>()
            .expect("ticket number rows should be valid");

        assert_eq!(numbers, vec![1, 2]);
    }
}

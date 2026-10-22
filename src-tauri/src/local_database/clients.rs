use super::open_database;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const PAGE_SIZE: i64 = 25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalClient {
    id: String,
    workspace_id: String,
    code: String,
    name: String,
    active: bool,
    version: i64,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
    created_by_user_id: String,
    updated_by_user_id: String,
    deleted_by_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClientCursor {
    created_at: String,
    id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalClientPage {
    clients: Vec<LocalClient>,
    next_cursor: Option<ClientCursor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalClientDeletion {
    deleted_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateClientInput {
    id: String,
    workspace_id: String,
    code: String,
    name: String,
    active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateClientInput {
    code: Option<String>,
    name: Option<String>,
    active: Option<bool>,
    expected_version: i64,
}

pub(super) fn get_local_clients_impl(
    app: AppHandle,
    workspace_id: String,
    cursor: Option<ClientCursor>,
    search: String,
) -> Result<LocalClientPage, String> {
    validate_id(&workspace_id)?;
    let cursor = validate_cursor(cursor)?;
    let search = validate_search(search)?;
    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &workspace_id)?;
    read_state(&connection, &workspace_id, cursor.as_ref(), &search)
}

pub(super) fn create_local_client_impl(
    app: AppHandle,
    input: CreateClientInput,
) -> Result<LocalClientPage, String> {
    validate_id(&input.id)?;
    validate_id(&input.workspace_id)?;
    let code = validate_text(input.code, 64, "code")?;
    let name = validate_text(input.name, 120, "name")?;
    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &input.workspace_id)?;
    let now = current_timestamp(&connection)?;
    connection
        .execute(
            "INSERT INTO clients (
                id, workspace_id, code, name, active, version, created_at, updated_at,
                deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, NULL, 'local', 'local', NULL)",
            params![input.id, input.workspace_id, code, name, input.active, now],
        )
        .map_err(|error| format!("Could not save the local client: {error}"))?;
    read_state(&connection, &input.workspace_id, None, "")
}

pub(super) fn update_local_client_impl(
    app: AppHandle,
    workspace_id: String,
    client_id: String,
    input: UpdateClientInput,
    cursor: Option<ClientCursor>,
    search: String,
) -> Result<LocalClientPage, String> {
    validate_id(&workspace_id)?;
    validate_id(&client_id)?;
    if input.expected_version < 1 {
        return Err("The client version is invalid.".to_owned());
    }
    let code = input
        .code
        .map(|value| validate_text(value, 64, "code"))
        .transpose()?;
    let name = input
        .name
        .map(|value| validate_text(value, 120, "name"))
        .transpose()?;
    if code.is_none() && name.is_none() && input.active.is_none() {
        return Err("No client changes were provided.".to_owned());
    }
    let cursor = validate_cursor(cursor)?;
    let search = validate_search(search)?;

    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &workspace_id)?;
    let now = current_timestamp(&connection)?;
    let changed = connection
        .execute(
            "UPDATE clients SET
                code = COALESCE(?1, code),
                name = COALESCE(?2, name),
                active = COALESCE(?3, active),
                updated_at = ?4,
                updated_by_user_id = 'local',
                version = version + 1
             WHERE id = ?5 AND workspace_id = ?6 AND version = ?7 AND deleted_at IS NULL",
            params![
                code,
                name,
                input.active,
                now,
                client_id,
                workspace_id,
                input.expected_version
            ],
        )
        .map_err(|error| format!("Could not update the local client: {error}"))?;
    if changed != 1 {
        return Err("The client changed elsewhere or is no longer available.".to_owned());
    }
    read_state(&connection, &workspace_id, cursor.as_ref(), &search)
}

pub(super) fn delete_local_client_impl(
    app: AppHandle,
    workspace_id: String,
    client_id: String,
    expected_version: i64,
) -> Result<LocalClientDeletion, String> {
    validate_id(&workspace_id)?;
    validate_id(&client_id)?;
    if expected_version < 1 {
        return Err("The client version is invalid.".to_owned());
    }
    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &workspace_id)?;
    let now = current_timestamp(&connection)?;
    let changed = connection
        .execute(
            "UPDATE clients SET
                deleted_at = ?1,
                deleted_by_user_id = 'local',
                updated_by_user_id = 'local',
                updated_at = ?1,
                version = version + 1
             WHERE id = ?2 AND workspace_id = ?3 AND version = ?4 AND deleted_at IS NULL",
            params![now, client_id, workspace_id, expected_version],
        )
        .map_err(|error| format!("Could not delete the local client: {error}"))?;
    if changed != 1 {
        return Err("The client changed elsewhere or is no longer available.".to_owned());
    }
    Ok(LocalClientDeletion { deleted_at: now })
}

fn read_state(
    connection: &Connection,
    workspace_id: &str,
    cursor: Option<&ClientCursor>,
    search: &str,
) -> Result<LocalClientPage, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, workspace_id, code, name, active, version, created_at, updated_at, deleted_at,
                    created_by_user_id, updated_by_user_id, deleted_by_user_id
             FROM clients
             WHERE workspace_id = ?1 AND deleted_at IS NULL
               AND (?2 = '' OR instr(lower(code), lower(?2)) > 0 OR instr(lower(name), lower(?2)) > 0)
               AND (?3 IS NULL OR created_at > ?3 OR (created_at = ?3 AND id > ?4))
             ORDER BY created_at, id
             LIMIT ?5",
        )
        .map_err(|error| format!("Could not read local clients: {error}"))?;
    let clients = statement
        .query_map(
            params![
                workspace_id,
                search,
                cursor.map(|value| value.created_at.as_str()),
                cursor.map(|value| value.id.as_str()),
                PAGE_SIZE + 1,
            ],
            |row| {
                Ok(LocalClient {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    code: row.get(2)?,
                    name: row.get(3)?,
                    active: row.get(4)?,
                    version: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    deleted_at: row.get(8)?,
                    created_by_user_id: row.get(9)?,
                    updated_by_user_id: row.get(10)?,
                    deleted_by_user_id: row.get(11)?,
                })
            },
        )
        .map_err(|error| format!("Could not read local clients: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read local clients: {error}"))?;
    let has_more = clients.len() > PAGE_SIZE as usize;
    let mut clients = clients;
    clients.truncate(PAGE_SIZE as usize);
    let next_cursor = if has_more {
        clients
            .get(PAGE_SIZE as usize - 1)
            .map(|client| ClientCursor {
                created_at: client.created_at.clone(),
                id: client.id.clone(),
            })
    } else {
        None
    };
    Ok(LocalClientPage {
        clients,
        next_cursor,
    })
}

fn ensure_workspace_available(connection: &Connection, workspace_id: &str) -> Result<(), String> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?1 AND deleted_at IS NULL)",
            [workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not verify the local workspace: {error}"))?;
    if exists {
        Ok(())
    } else {
        Err("The local workspace is no longer available.".to_owned())
    }
}

fn current_timestamp(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("Could not create a local timestamp: {error}"))
}

fn validate_text(value: String, maximum: usize, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let length = trimmed.encode_utf16().count();
    if length == 0 || length > maximum {
        return Err(format!(
            "The client {label} must contain between 1 and {maximum} characters."
        ));
    }
    Ok(trimmed.to_owned())
}

fn validate_search(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.encode_utf16().count() > 120 {
        return Err("The client search is too long.".to_owned());
    }
    Ok(trimmed.to_owned())
}

fn validate_cursor(cursor: Option<ClientCursor>) -> Result<Option<ClientCursor>, String> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    validate_id(&cursor.id)?;
    let bytes = cursor.created_at.as_bytes();
    let valid = bytes.len() == 24
        && [4, 7, 10, 13, 16, 19, 23]
            .iter()
            .enumerate()
            .all(|(separator, position)| {
                let expected = b"--T::.Z"[separator];
                bytes[*position] == expected
            })
        && bytes.iter().enumerate().all(|(index, byte)| {
            [4, 7, 10, 13, 16, 19, 23].contains(&index) || byte.is_ascii_digit()
        });
    if valid {
        Ok(Some(cursor))
    } else {
        Err("The client page cursor is invalid.".to_owned())
    }
}

fn validate_id(value: &str) -> Result<(), String> {
    let valid = value.len() == 36
        && value.as_bytes().iter().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    if valid {
        Ok(())
    } else {
        Err("The client identifier is invalid.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::{current_timestamp, read_state};
    use crate::local_database::migrate;
    use rusqlite::Connection;

    const WORKSPACE_ID: &str = "ac01e94f-379f-4e03-9d3b-94231ac32fab";
    const CLIENT_ID: &str = "c1a63af1-19ba-4473-aaf4-e75d9032e487";

    #[test]
    fn soft_deleted_clients_are_hidden_and_remain_persisted() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite database");
        migrate(&mut connection).expect("migrations should apply");
        let now = current_timestamp(&connection).expect("timestamp");
        connection
            .execute(
                "INSERT INTO workspaces (id, name, accent_color, icon, is_active, created_at, updated_at)
                 VALUES (?1, 'Local', 'olive', 'briefcase', 1, ?2, ?2)",
                rusqlite::params![WORKSPACE_ID, now],
            )
            .expect("workspace should be inserted");
        connection
            .execute(
                "INSERT INTO clients (id, workspace_id, code, name, active, version, created_at, updated_at, created_by_user_id, updated_by_user_id)
                 VALUES (?1, ?2, 'V-001', 'Example', 1, 1, ?3, ?3, 'local', 'local')",
                rusqlite::params![CLIENT_ID, WORKSPACE_ID, now],
            )
            .expect("client should be inserted");
        connection
            .execute(
                "UPDATE clients SET deleted_at = ?1, deleted_by_user_id = 'local' WHERE id = ?2",
                rusqlite::params![now, CLIENT_ID],
            )
            .expect("client should be soft-deleted");

        assert!(
            read_state(&connection, WORKSPACE_ID, None, "")
                .expect("state")
                .clients
                .is_empty()
        );
        let persisted_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM clients WHERE id = ?1",
                [CLIENT_ID],
                |row| row.get(0),
            )
            .expect("persisted row count");
        assert_eq!(persisted_count, 1);
    }

    #[test]
    fn local_client_pages_apply_search_before_limit_and_follow_stable_cursors() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite database");
        migrate(&mut connection).expect("migrations should apply");
        let now = current_timestamp(&connection).expect("timestamp");
        connection
            .execute(
                "INSERT INTO workspaces (id, name, accent_color, icon, is_active, created_at, updated_at)
                 VALUES (?1, 'Local', 'olive', 'briefcase', 1, ?2, ?2)",
                rusqlite::params![WORKSPACE_ID, now],
            )
            .expect("workspace should be inserted");
        for number in 0..27 {
            let id = format!("c1a63af1-19ba-4473-aaf4-{number:012x}");
            let name = if number == 26 {
                "Target Client"
            } else {
                "Other Client"
            };
            connection
                .execute(
                    "INSERT INTO clients (id, workspace_id, code, name, active, version, created_at, updated_at, created_by_user_id, updated_by_user_id)
                     VALUES (?1, ?2, ?3, ?4, 1, 1, ?5, ?5, 'local', 'local')",
                    rusqlite::params![id, WORKSPACE_ID, format!("C-{number:03}"), name, format!("2026-10-21T12:00:{number:02}.000Z")],
                )
                .expect("client should be inserted");
        }

        let first_page = read_state(&connection, WORKSPACE_ID, None, "").expect("first page");
        assert_eq!(first_page.clients.len(), 25);
        let cursor = first_page.next_cursor.expect("next page cursor");
        let last_page =
            read_state(&connection, WORKSPACE_ID, Some(&cursor), "").expect("last page");
        assert_eq!(last_page.clients.len(), 2);
        assert!(last_page.next_cursor.is_none());

        let filtered =
            read_state(&connection, WORKSPACE_ID, None, "target").expect("filtered page");
        assert_eq!(filtered.clients.len(), 1);
        assert_eq!(filtered.clients[0].name, "Target Client");
        assert!(filtered.next_cursor.is_none());
    }
}

use super::open_database;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalWorkspace {
    id: String,
    name: String,
    accent_color: String,
    icon: String,
    last_accessed_at: Option<String>,
    version: i64,
    membership_version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalWorkspaceState {
    workspaces: Vec<LocalWorkspace>,
    active_workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateWorkspaceInput {
    id: String,
    name: String,
    accent_color: String,
    icon: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateWorkspaceInput {
    name: Option<String>,
    accent_color: Option<String>,
    icon: Option<String>,
}

pub(super) fn get_local_workspace_state_impl(
    app: AppHandle,
) -> Result<LocalWorkspaceState, String> {
    let connection = open_database(&app)?;
    read_state(&connection)
}

pub(super) fn create_local_workspace_impl(
    app: AppHandle,
    input: CreateWorkspaceInput,
) -> Result<LocalWorkspaceState, String> {
    validate_id(&input.id)?;
    let name = validate_name(input.name)?;
    validate_accent(&input.accent_color)?;
    validate_icon(&input.icon)?;

    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not prepare the local workspace: {error}"))?;
    transaction
        .execute(
            "INSERT INTO workspaces (id, name, accent_color, icon, last_accessed_at, version, membership_version, is_active, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 1,
                     CASE WHEN EXISTS(SELECT 1 FROM workspaces WHERE is_active = 1 AND deleted_at IS NULL) THEN 0 ELSE 1 END,
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL)",
            params![input.id, name, input.accent_color, input.icon],
        )
        .map_err(|error| format!("Could not create the local workspace: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not finish creating the local workspace: {error}"))?;
    read_state(&connection)
}

pub(super) fn update_local_workspace_impl(
    app: AppHandle,
    workspace_id: String,
    input: UpdateWorkspaceInput,
) -> Result<LocalWorkspaceState, String> {
    validate_id(&workspace_id)?;
    if input.name.is_none() && input.accent_color.is_none() && input.icon.is_none() {
        return Err("Choose at least one workspace setting to update.".to_owned());
    }
    let name = input.name.map(validate_name).transpose()?;
    if let Some(accent_color) = &input.accent_color {
        validate_accent(accent_color)?;
    }
    if let Some(icon) = &input.icon {
        validate_icon(icon)?;
    }

    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not prepare the local workspace: {error}"))?;
    let changed = transaction
        .execute(
            "UPDATE workspaces SET
               name = COALESCE(?2, name),
               accent_color = COALESCE(?3, accent_color),
               icon = COALESCE(?4, icon),
               version = version + 1,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND deleted_at IS NULL",
            params![workspace_id, name, input.accent_color, input.icon],
        )
        .map_err(|error| format!("Could not update the local workspace: {error}"))?;
    if changed != 1 {
        return Err("The workspace is no longer available.".to_owned());
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not finish updating the local workspace: {error}"))?;
    read_state(&connection)
}

pub(super) fn delete_local_workspace_impl(
    app: AppHandle,
    workspace_id: String,
    confirmation_name: String,
) -> Result<LocalWorkspaceState, String> {
    validate_id(&workspace_id)?;
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not prepare the local workspace: {error}"))?;
    let current: Option<(String, bool)> = transaction
        .query_row(
            "SELECT name, is_active = 1 FROM workspaces WHERE id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read the local workspace: {error}"))?;
    let Some((name, was_active)) = current else {
        return Err("The workspace is no longer available.".to_owned());
    };
    if confirmation_name != name {
        return Err("The workspace name does not match the confirmation.".to_owned());
    }

    transaction
        .execute(
            "UPDATE tickets SET
                deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                deleted_by_user_id = 'local',
                updated_by_user_id = 'local',
                version = version + 1
             WHERE workspace_id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
        )
        .map_err(|error| format!("Could not delete local workspace tickets: {error}"))?;

    transaction
        .execute(
            "UPDATE ticket_attachments SET
                deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                deleted_by_user_id = 'local', updated_by_user_id = 'local', version = version + 1
             WHERE workspace_id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
        )
        .map_err(|error| format!("Could not delete local workspace attachments: {error}"))?;

    transaction
        .execute(
            "UPDATE note_attachments SET
                deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                deleted_by_user_id = 'local', updated_by_user_id = 'local', version = version + 1
             WHERE workspace_id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
        )
        .map_err(|error| format!("Could not delete local workspace note attachments: {error}"))?;

    transaction
        .execute(
            "UPDATE notes SET
                deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                deleted_by_user_id = 'local', updated_by_user_id = 'local', version = version + 1
             WHERE workspace_id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
        )
        .map_err(|error| format!("Could not delete local workspace notes: {error}"))?;

    transaction
        .execute(
            "UPDATE clients SET
                deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                deleted_by_user_id = 'local',
                updated_by_user_id = 'local',
                version = version + 1
             WHERE workspace_id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
        )
        .map_err(|error| format!("Could not delete local workspace clients: {error}"))?;

    transaction
        .execute(
            "UPDATE workspaces SET is_active = 0, deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1
             WHERE id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
        )
        .map_err(|error| format!("Could not delete the local workspace: {error}"))?;
    if was_active {
        transaction
            .execute(
                "UPDATE workspaces SET is_active = 1, last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1
                 WHERE id = (SELECT id FROM workspaces WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id LIMIT 1)",
                [],
            )
            .map_err(|error| format!("Could not select the next local workspace: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not finish deleting the local workspace: {error}"))?;
    read_state(&connection)
}

pub(super) fn activate_local_workspace_impl(
    app: AppHandle,
    workspace_id: String,
) -> Result<LocalWorkspaceState, String> {
    validate_id(&workspace_id)?;
    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not prepare the local workspace: {error}"))?;
    transaction
        .execute(
            "UPDATE workspaces SET is_active = 0 WHERE is_active = 1 AND deleted_at IS NULL",
            [],
        )
        .map_err(|error| format!("Could not switch the local workspace: {error}"))?;
    let target_changed = transaction
        .execute(
            "UPDATE workspaces SET is_active = 1, last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1
             WHERE id = ?1 AND deleted_at IS NULL",
            params![workspace_id],
        )
        .map_err(|error| format!("Could not open the local workspace: {error}"))?;
    if target_changed != 1 {
        return Err("The workspace is no longer available.".to_owned());
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not finish switching the local workspace: {error}"))?;
    read_state(&connection)
}

fn read_state(connection: &Connection) -> Result<LocalWorkspaceState, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, accent_color, icon, last_accessed_at, version, membership_version
             FROM workspaces WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, id",
        )
        .map_err(|error| format!("Could not prepare the local workspace list: {error}"))?;
    let workspaces = statement
        .query_map([], |row| {
            Ok(LocalWorkspace {
                id: row.get(0)?,
                name: row.get(1)?,
                accent_color: row.get(2)?,
                icon: row.get(3)?,
                last_accessed_at: row.get(4)?,
                version: row.get(5)?,
                membership_version: row.get(6)?,
            })
        })
        .map_err(|error| format!("Could not read the local workspace list: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read a local workspace: {error}"))?;
    let active_workspace_id = connection
        .query_row(
            "SELECT id FROM workspaces WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read the active local workspace: {error}"))?;
    Ok(LocalWorkspaceState {
        workspaces,
        active_workspace_id,
    })
}

fn validate_id(value: &str) -> Result<(), String> {
    let valid = value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    if valid {
        Ok(())
    } else {
        Err("The workspace identifier is invalid.".to_owned())
    }
}

fn validate_name(value: String) -> Result<String, String> {
    let value = value.trim().to_owned();
    if value.is_empty() || value.encode_utf16().count() > 48 {
        Err("Workspace names must contain between 1 and 48 characters.".to_owned())
    } else {
        Ok(value)
    }
}

fn validate_accent(value: &str) -> Result<(), String> {
    if [
        "olive",
        "blue",
        "terracotta",
        "plum",
        "teal",
        "graphite",
        "sage",
        "indigo",
        "amber",
        "rose",
        "sky",
        "sand",
    ]
    .contains(&value)
    {
        Ok(())
    } else {
        Err("The workspace color is invalid.".to_owned())
    }
}

fn validate_icon(value: &str) -> Result<(), String> {
    if [
        "briefcase",
        "folder",
        "layers",
        "notebook-pen",
        "laptop",
        "palette",
        "building-2",
        "book-open",
        "code-2",
        "chart-no-axes-combined",
        "camera",
        "pen-tool",
    ]
    .contains(&value)
    {
        Ok(())
    } else {
        Err("The workspace icon is invalid.".to_owned())
    }
}

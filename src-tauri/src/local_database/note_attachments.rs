use super::attachments::{
    AttachmentCursor, data_directory, database_timestamp, ensure_attachment_directory,
    image_content_type, restrict_directory_permissions, safe_storage_path, sanitized_file_name,
    storage_extension,
};
use super::open_database;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const PAGE_SIZE: i64 = 25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalNoteAttachment {
    id: String,
    workspace_id: String,
    note_id: String,
    file_name: String,
    content_type: String,
    size_bytes: i64,
    checksum_sha256: Option<String>,
    version: i64,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalNoteAttachmentPage {
    attachments: Vec<LocalNoteAttachment>,
    next_cursor: Option<AttachmentCursor>,
}

fn valid_id(value: &str) -> bool {
    value.len() == 36
        && value.as_bytes().iter().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn validate_id(value: &str) -> Result<(), String> {
    if valid_id(value) {
        Ok(())
    } else {
        Err("The note attachment identifier is invalid.".to_owned())
    }
}

fn validate_note(connection: &Connection, workspace_id: &str, note_id: &str) -> Result<(), String> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM notes n JOIN tickets t ON t.id = n.ticket_id AND t.workspace_id = n.workspace_id
             WHERE n.id = ?1 AND n.workspace_id = ?2 AND n.deleted_at IS NULL AND t.deleted_at IS NULL)",
            params![note_id, workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not verify the local note: {error}"))?;
    if exists {
        Ok(())
    } else {
        Err("The local note is unavailable.".to_owned())
    }
}

fn validate_cursor(cursor: &Option<AttachmentCursor>) -> Result<(), String> {
    if let Some(cursor) = cursor {
        validate_id(&cursor.id)?;
        if cursor.created_at.len() != 24 {
            return Err("The attachment page cursor is invalid.".to_owned());
        }
    }
    Ok(())
}

pub(super) fn list_local_note_attachments_impl(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    cursor: Option<AttachmentCursor>,
) -> Result<LocalNoteAttachmentPage, String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    validate_cursor(&cursor)?;
    let connection = open_database(&app)?;
    validate_note(&connection, &workspace_id, &note_id)?;
    let mut statement = connection.prepare(
        "SELECT id, workspace_id, note_id, file_name, content_type, size_bytes, checksum_sha256, version,
                created_at, updated_at, deleted_at
         FROM note_attachments
         WHERE workspace_id = ?1 AND note_id = ?2 AND deleted_at IS NULL
           AND (?3 IS NULL OR created_at > ?3 OR (created_at = ?3 AND id > ?4))
         ORDER BY created_at, id LIMIT ?5",
    ).map_err(|error| format!("Could not read local note attachments: {error}"))?;
    let mut rows = statement
        .query(params![
            workspace_id,
            note_id,
            cursor.as_ref().map(|value| value.created_at.as_str()),
            cursor.as_ref().map(|value| value.id.as_str()),
            PAGE_SIZE + 1,
        ])
        .map_err(|error| format!("Could not read local note attachments: {error}"))?;
    let mut attachments = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Could not read local note attachments: {error}"))?
    {
        attachments.push(LocalNoteAttachment {
            id: row.get(0).map_err(|error| error.to_string())?,
            workspace_id: row.get(1).map_err(|error| error.to_string())?,
            note_id: row.get(2).map_err(|error| error.to_string())?,
            file_name: row.get(3).map_err(|error| error.to_string())?,
            content_type: row.get(4).map_err(|error| error.to_string())?,
            size_bytes: row.get(5).map_err(|error| error.to_string())?,
            checksum_sha256: row.get(6).map_err(|error| error.to_string())?,
            version: row.get(7).map_err(|error| error.to_string())?,
            created_at: row.get(8).map_err(|error| error.to_string())?,
            updated_at: row.get(9).map_err(|error| error.to_string())?,
            deleted_at: row.get(10).map_err(|error| error.to_string())?,
        });
    }
    let has_more = attachments.len() as i64 > PAGE_SIZE;
    if has_more {
        attachments.pop();
    }
    let next_cursor = has_more
        .then(|| {
            attachments.last().map(|attachment| AttachmentCursor {
                created_at: attachment.created_at.clone(),
                id: attachment.id.clone(),
            })
        })
        .flatten();
    Ok(LocalNoteAttachmentPage {
        attachments,
        next_cursor,
    })
}

pub(super) fn add_local_note_attachment_impl(
    app: AppHandle,
    attachment_id: String,
    workspace_id: String,
    note_id: String,
    source_path: String,
) -> Result<LocalNoteAttachment, String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    validate_id(&attachment_id)?;
    let source = PathBuf::from(source_path)
        .canonicalize()
        .map_err(|error| format!("Could not open the selected attachment: {error}"))?;
    if !source.is_file() {
        return Err("The selected attachment must be a file.".to_owned());
    }
    let file_name = sanitized_file_name(&source)?;
    let source_metadata = fs::metadata(&source)
        .map_err(|error| format!("Could not inspect the selected attachment: {error}"))?;
    let data_root = data_directory(&app)?;
    let attachment_root = ensure_attachment_directory(&data_root)?;
    let connection = open_database(&app)?;
    validate_note(&connection, &workspace_id, &note_id)?;

    let storage_key = format!(
        "attachments/{}/{}{}",
        &attachment_id[..2],
        attachment_id,
        storage_extension(&file_name)
    );
    let prefix_path = attachment_root.join(&attachment_id[..2]);
    fs::create_dir_all(&prefix_path)
        .map_err(|error| format!("Could not create the attachment directory: {error}"))?;
    let prefix_metadata = fs::symlink_metadata(&prefix_path)
        .map_err(|error| format!("Could not inspect the attachment directory: {error}"))?;
    if prefix_metadata.file_type().is_symlink() || !prefix_metadata.is_dir() {
        return Err("The attachment directory is unsafe.".to_owned());
    }
    restrict_directory_permissions(&prefix_path)?;
    let target = safe_storage_path(&data_root, &storage_key)?;
    let temporary = target.with_extension("upload");
    let mut reader = File::open(&source)
        .map_err(|error| format!("Could not read the selected attachment: {error}"))?;
    let mut write_options = OpenOptions::new();
    write_options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        write_options.mode(0o600);
    }
    let mut writer = write_options
        .open(&temporary)
        .map_err(|error| format!("Could not save the attachment: {error}"))?;
    let mut buffer = [0_u8; 128 * 1024];
    let copy_result = (|| -> std::io::Result<i64> {
        let mut total = 0_i64;
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            total = total.checked_add(count as i64).ok_or_else(|| {
                std::io::Error::other("Attachment size exceeds supported storage range.")
            })?;
            writer.write_all(&buffer[..count])?;
        }
        writer.sync_all()?;
        Ok(total)
    })();
    drop(writer);
    let size_bytes = match copy_result {
        Ok(size) => size,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(format!("Could not save the attachment: {error}"));
        }
    };
    if source_metadata.len() > i64::MAX as u64 || source_metadata.len() != size_bytes as u64 {
        let _ = fs::remove_file(&temporary);
        return Err("The selected attachment changed while it was being copied.".to_owned());
    }
    fs::rename(&temporary, &target).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not finish saving the attachment: {error}")
    })?;
    let now = database_timestamp(&connection)?;
    let content_type = image_content_type(&file_name).unwrap_or("application/octet-stream");
    if let Err(error) = connection.execute(
        "INSERT INTO note_attachments (id, workspace_id, note_id, file_name, content_type, size_bytes, storage_key, version,
            created_by_user_id, updated_by_user_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 'local', 'local', ?8, ?8)",
        params![attachment_id, workspace_id, note_id, file_name, content_type, size_bytes, storage_key, now],
    ) {
        let _ = fs::remove_file(&target);
        return Err(format!("Could not save attachment details: {error}"));
    }
    Ok(LocalNoteAttachment {
        id: attachment_id,
        workspace_id,
        note_id,
        file_name,
        content_type: content_type.to_owned(),
        size_bytes,
        checksum_sha256: None,
        version: 1,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    })
}

pub(super) fn choose_and_add_local_note_attachments_impl(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
) -> Result<Vec<LocalNoteAttachment>, String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    let Some(selected_files) = app.dialog().file().blocking_pick_files() else {
        return Ok(Vec::new());
    };
    let mut attachments = Vec::with_capacity(selected_files.len());
    for selected_file in selected_files {
        let source = selected_file
            .into_path()
            .map_err(|error| format!("Could not access the selected attachment: {error}"))?;
        attachments.push(add_local_note_attachment_impl(
            app.clone(),
            Uuid::new_v4().to_string(),
            workspace_id.clone(),
            note_id.clone(),
            source.to_string_lossy().into_owned(),
        )?);
    }
    Ok(attachments)
}

pub(super) fn delete_local_note_attachment_impl(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    attachment_id: String,
) -> Result<(), String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    validate_id(&attachment_id)?;
    let connection = open_database(&app)?;
    let now = database_timestamp(&connection)?;
    let changed = connection.execute(
        "UPDATE note_attachments SET deleted_at = ?1, updated_at = ?1, deleted_by_user_id = 'local', updated_by_user_id = 'local', version = version + 1
         WHERE id = ?2 AND workspace_id = ?3 AND note_id = ?4 AND deleted_at IS NULL
           AND EXISTS(SELECT 1 FROM notes n JOIN tickets t ON t.id = n.ticket_id AND t.workspace_id = n.workspace_id
             WHERE n.id = ?4 AND n.workspace_id = ?3 AND n.deleted_at IS NULL AND t.deleted_at IS NULL)",
        params![now, attachment_id, workspace_id, note_id],
    ).map_err(|error| format!("Could not delete the local note attachment: {error}"))?;
    if changed != 1 {
        return Err("The local note attachment is unavailable.".to_owned());
    }
    Ok(())
}

pub(super) fn open_local_note_attachment_impl(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    attachment_id: String,
) -> Result<(), String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    validate_id(&attachment_id)?;
    let connection = open_database(&app)?;
    let storage_key: Option<String> = connection.query_row(
        "SELECT a.storage_key FROM note_attachments a
         JOIN notes n ON n.id = a.note_id AND n.workspace_id = a.workspace_id AND n.deleted_at IS NULL
         JOIN tickets t ON t.id = n.ticket_id AND t.workspace_id = n.workspace_id AND t.deleted_at IS NULL
         WHERE a.id = ?1 AND a.workspace_id = ?2 AND a.note_id = ?3 AND a.deleted_at IS NULL",
        params![attachment_id, workspace_id, note_id],
        |row| row.get(0),
    ).optional().map_err(|error| format!("Could not find the local note attachment: {error}"))?;
    let storage_key = storage_key.ok_or("The local note attachment is unavailable.")?;
    let path = safe_storage_path(&data_directory(&app)?, &storage_key)?;
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|error| format!("Could not open the note attachment: {error}"))
}

pub(super) fn read_local_note_attachment_preview_impl(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    attachment_id: String,
) -> Result<Vec<u8>, String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    validate_id(&attachment_id)?;
    let connection = open_database(&app)?;
    let record: Option<(String, String)> = connection
        .query_row(
            "SELECT a.storage_key, a.file_name FROM note_attachments a
             JOIN notes n ON n.id = a.note_id AND n.workspace_id = a.workspace_id AND n.deleted_at IS NULL
             JOIN tickets t ON t.id = n.ticket_id AND t.workspace_id = n.workspace_id AND t.deleted_at IS NULL
             WHERE a.id = ?1 AND a.workspace_id = ?2 AND a.note_id = ?3 AND a.deleted_at IS NULL",
            params![attachment_id, workspace_id, note_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not find the local note attachment: {error}"))?;
    let (storage_key, file_name) = record.ok_or("The local note attachment is unavailable.")?;
    if image_content_type(&file_name).is_none() {
        return Err("Only supported image attachments can be previewed.".to_owned());
    }
    let path = safe_storage_path(&data_directory(&app)?, &storage_key)?;
    fs::read(path).map_err(|error| format!("Could not read the note image preview: {error}"))
}

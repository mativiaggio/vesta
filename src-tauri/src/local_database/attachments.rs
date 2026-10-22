use super::open_database;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const PAGE_SIZE: i64 = 25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTicketAttachment {
    id: String,
    workspace_id: String,
    ticket_id: String,
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
pub(crate) struct LocalTicketAttachmentPage {
    attachments: Vec<LocalTicketAttachment>,
    next_cursor: Option<AttachmentCursor>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AttachmentCursor {
    created_at: String,
    id: String,
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
        Err("The ticket attachment identifier is invalid.".to_owned())
    }
}

fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    crate::configured_data_directory(app)
}

pub(super) fn ensure_attachment_directory(data_directory: &Path) -> Result<PathBuf, String> {
    let data_directory = data_directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve the configured data folder: {error}"))?;
    let root = data_directory.join("attachments");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create the attachment folder: {error}"))?;
    let metadata = fs::symlink_metadata(&root)
        .map_err(|error| format!("Could not inspect the attachment folder: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The attachment folder cannot be a symbolic link or a file.".to_owned());
    }
    restrict_directory_permissions(&root)?;
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("Could not resolve the attachment folder: {error}"))?;
    if !canonical.starts_with(&data_directory) {
        return Err(
            "The attachment folder must remain inside the configured data folder.".to_owned(),
        );
    }
    Ok(canonical)
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("Could not secure the attachment folder: {error}"))
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn safe_storage_path(data_directory: &Path, storage_key: &str) -> Result<PathBuf, String> {
    let mut components = Path::new(storage_key).components();
    let (
        Some(Component::Normal(root_name)),
        Some(Component::Normal(prefix)),
        Some(Component::Normal(file_name)),
    ) = (components.next(), components.next(), components.next())
    else {
        return Err("The attachment storage key is invalid.".to_owned());
    };
    if components.next().is_some() || root_name != "attachments" {
        return Err("The attachment storage key is invalid.".to_owned());
    }
    let prefix = prefix
        .to_str()
        .ok_or("The attachment storage key is invalid.")?;
    let file_name = file_name
        .to_str()
        .ok_or("The attachment storage key is invalid.")?;
    if !file_name.is_ascii()
        || prefix.len() != 2
        || !prefix.bytes().all(|value| value.is_ascii_hexdigit())
        || file_name.len() < 36
        || !valid_id(&file_name[..36])
        || (file_name.len() > 36
            && (!file_name.starts_with(&file_name[..36])
                || !file_name[36..].strip_prefix('.').is_some_and(|extension| {
                    (1..=10).contains(&extension.len())
                        && extension.bytes().all(|value| value.is_ascii_alphanumeric())
                })))
        || !file_name[..2].eq_ignore_ascii_case(prefix)
    {
        return Err("The attachment storage key is invalid.".to_owned());
    }
    let attachment_root = ensure_attachment_directory(data_directory)?;
    let directory = attachment_root.join(prefix);
    let directory_metadata = fs::symlink_metadata(&directory)
        .map_err(|error| format!("Could not inspect the attachment directory: {error}"))?;
    if directory_metadata.file_type().is_symlink() || !directory_metadata.is_dir() {
        return Err("The attachment directory is unsafe.".to_owned());
    }
    let resolved_directory = directory
        .canonicalize()
        .map_err(|error| format!("Could not resolve the attachment directory: {error}"))?;
    if !resolved_directory.starts_with(&attachment_root) {
        return Err("The attachment path escaped its storage directory.".to_owned());
    }
    let target = resolved_directory.join(file_name);
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("The attachment file is unsafe.".to_owned());
        }
        let resolved = target
            .canonicalize()
            .map_err(|error| format!("Could not resolve the attachment file: {error}"))?;
        if !resolved.starts_with(&resolved_directory) {
            return Err("The attachment path escaped its storage directory.".to_owned());
        }
    }
    Ok(target)
}

fn sanitized_file_name(source: &Path) -> Result<String, String> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("The selected attachment does not have a valid file name.")?;
    let sanitized: String = name
        .chars()
        .filter(|character| !character.is_control() && *character != '/' && *character != '\\')
        .collect::<String>()
        .trim()
        .to_owned();
    if sanitized.is_empty() || sanitized.encode_utf16().count() > 255 {
        return Err("The attachment file name must contain 1 to 255 characters.".to_owned());
    }
    Ok(sanitized)
}

fn storage_extension(file_name: &str) -> String {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if (1..=10).contains(&extension.len())
        && extension.bytes().all(|value| value.is_ascii_alphanumeric())
    {
        format!(".{}", extension.to_ascii_lowercase())
    } else {
        String::new()
    }
}

fn image_content_type(file_name: &str) -> Option<&'static str> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        _ => None,
    }
}

pub(super) fn list_local_ticket_attachments_impl(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    cursor: Option<AttachmentCursor>,
) -> Result<LocalTicketAttachmentPage, String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    if let Some(cursor) = &cursor {
        validate_id(&cursor.id)?;
        if cursor.created_at.len() != 24 {
            return Err("The attachment page cursor is invalid.".to_owned());
        }
    }
    let connection = open_database(&app)?;
    let ticket_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tickets WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL)",
            params![ticket_id, workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not verify the local ticket: {error}"))?;
    if !ticket_exists {
        return Err("The local ticket is unavailable.".to_owned());
    }
    let mut statement = connection
        .prepare(
            "SELECT id, workspace_id, ticket_id, file_name, content_type, size_bytes, checksum_sha256,
                    version, created_at, updated_at, deleted_at
             FROM ticket_attachments
             WHERE workspace_id = ?1 AND ticket_id = ?2 AND deleted_at IS NULL
               AND (?3 IS NULL OR created_at > ?3 OR (created_at = ?3 AND id > ?4))
             ORDER BY created_at, id LIMIT ?5",
        )
        .map_err(|error| format!("Could not read local ticket attachments: {error}"))?;
    let mut rows = statement
        .query(params![
            workspace_id,
            ticket_id,
            cursor.as_ref().map(|value| value.created_at.as_str()),
            cursor.as_ref().map(|value| value.id.as_str()),
            PAGE_SIZE + 1,
        ])
        .map_err(|error| format!("Could not read local ticket attachments: {error}"))?;
    let mut attachments = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Could not read local ticket attachments: {error}"))?
    {
        attachments.push(LocalTicketAttachment {
            id: row.get(0).map_err(|error| error.to_string())?,
            workspace_id: row.get(1).map_err(|error| error.to_string())?,
            ticket_id: row.get(2).map_err(|error| error.to_string())?,
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
            attachments.last().map(|last| AttachmentCursor {
                created_at: last.created_at.clone(),
                id: last.id.clone(),
            })
        })
        .flatten();
    Ok(LocalTicketAttachmentPage {
        attachments,
        next_cursor,
    })
}

pub(super) fn add_local_ticket_attachment_impl(
    app: AppHandle,
    attachment_id: String,
    workspace_id: String,
    ticket_id: String,
    source_path: String,
) -> Result<LocalTicketAttachment, String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    validate_id(&attachment_id)?;
    let source = PathBuf::from(source_path)
        .canonicalize()
        .map_err(|error| format!("Could not open the selected attachment: {error}"))?;
    if !source.is_file() {
        return Err("The selected attachment must be a file.".to_owned());
    }
    let file_name = sanitized_file_name(&source)?;
    let metadata = fs::metadata(&source)
        .map_err(|error| format!("Could not inspect the selected attachment: {error}"))?;
    let data_root = data_directory(&app)?;
    let attachment_root = ensure_attachment_directory(&data_root)?;
    let connection = open_database(&app)?;
    let ticket_exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tickets WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL)",
            params![ticket_id, workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not verify the local ticket: {error}"))?;
    if !ticket_exists {
        return Err("The local ticket is unavailable.".to_owned());
    }
    let id = attachment_id;
    let prefix = &id[..2];
    let extension = storage_extension(&file_name);
    let storage_key = format!("attachments/{prefix}/{id}{extension}");
    let prefix_path = attachment_root.join(prefix);
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
    if metadata.len() > i64::MAX as u64 || metadata.len() != size_bytes as u64 {
        let _ = fs::remove_file(&temporary);
        return Err("The selected attachment changed while it was being copied.".to_owned());
    }
    fs::rename(&temporary, &target).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not finish saving the attachment: {error}")
    })?;
    let now = database_timestamp(&connection)?;
    let content_type = image_content_type(&file_name).unwrap_or("application/octet-stream");
    let insertion = connection.execute(
        "INSERT INTO ticket_attachments (
            id, workspace_id, ticket_id, file_name, content_type, size_bytes,
            storage_key, version, created_by_user_id, updated_by_user_id, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 'local', 'local', ?8, ?8)",
        params![
            id,
            workspace_id,
            ticket_id,
            file_name,
            content_type,
            size_bytes,
            storage_key,
            now
        ],
    );
    if let Err(error) = insertion {
        let _ = fs::remove_file(&target);
        return Err(format!("Could not save attachment details: {error}"));
    }
    Ok(LocalTicketAttachment {
        id,
        workspace_id,
        ticket_id,
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

pub(super) fn choose_and_add_local_ticket_attachments_impl(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
) -> Result<Vec<LocalTicketAttachment>, String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    let Some(selected_files) = app.dialog().file().blocking_pick_files() else {
        return Ok(Vec::new());
    };
    let mut attachments = Vec::with_capacity(selected_files.len());
    for selected_file in selected_files {
        let source = selected_file
            .into_path()
            .map_err(|error| format!("Could not access the selected attachment: {error}"))?;
        attachments.push(add_local_ticket_attachment_impl(
            app.clone(),
            Uuid::new_v4().to_string(),
            workspace_id.clone(),
            ticket_id.clone(),
            source.to_string_lossy().into_owned(),
        )?);
    }
    Ok(attachments)
}

pub(super) fn delete_local_ticket_attachment_impl(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    attachment_id: String,
) -> Result<(), String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    validate_id(&attachment_id)?;
    let connection = open_database(&app)?;
    let now = database_timestamp(&connection)?;
    let changed = connection
        .execute(
            "UPDATE ticket_attachments SET deleted_at = ?1, updated_at = ?1, deleted_by_user_id = 'local',
                    updated_by_user_id = 'local', version = version + 1
             WHERE id = ?2 AND workspace_id = ?3 AND ticket_id = ?4 AND deleted_at IS NULL
               AND EXISTS(SELECT 1 FROM tickets WHERE id = ?4 AND workspace_id = ?3 AND deleted_at IS NULL)",
            params![now, attachment_id, workspace_id, ticket_id],
        )
        .map_err(|error| format!("Could not delete the local ticket attachment: {error}"))?;
    if changed != 1 {
        return Err("The local ticket attachment is unavailable.".to_owned());
    }
    Ok(())
}

pub(super) fn open_local_ticket_attachment_impl(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    attachment_id: String,
) -> Result<(), String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    validate_id(&attachment_id)?;
    let connection = open_database(&app)?;
    let storage_key: Option<String> = connection
        .query_row(
            "SELECT a.storage_key FROM ticket_attachments a
             JOIN tickets t ON t.id = a.ticket_id AND t.workspace_id = a.workspace_id AND t.deleted_at IS NULL
             WHERE a.id = ?1 AND a.workspace_id = ?2 AND a.ticket_id = ?3 AND a.deleted_at IS NULL",
            params![attachment_id, workspace_id, ticket_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not find the local ticket attachment: {error}"))?;
    let storage_key = storage_key.ok_or("The local ticket attachment is unavailable.")?;
    let path = safe_storage_path(&data_directory(&app)?, &storage_key)?;
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|error| format!("Could not open the ticket attachment: {error}"))
}

pub(super) fn read_local_ticket_attachment_preview_impl(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    attachment_id: String,
) -> Result<Vec<u8>, String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    validate_id(&attachment_id)?;
    let connection = open_database(&app)?;
    let record: Option<(String, String)> = connection
        .query_row(
            "SELECT a.storage_key, a.file_name FROM ticket_attachments a
             JOIN tickets t ON t.id = a.ticket_id AND t.workspace_id = a.workspace_id AND t.deleted_at IS NULL
             WHERE a.id = ?1 AND a.workspace_id = ?2 AND a.ticket_id = ?3 AND a.deleted_at IS NULL",
            params![attachment_id, workspace_id, ticket_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not find the local ticket attachment: {error}"))?;
    let (storage_key, file_name) = record.ok_or("The local ticket attachment is unavailable.")?;
    if image_content_type(&file_name).is_none() {
        return Err("Only supported image attachments can be previewed.".to_owned());
    }
    let path = safe_storage_path(&data_directory(&app)?, &storage_key)?;
    fs::read(path).map_err(|error| format!("Could not read the ticket image preview: {error}"))
}

pub(super) fn open_local_ticket_attachment_folder_impl(app: AppHandle) -> Result<(), String> {
    let folder = ensure_attachment_directory(&data_directory(&app)?)?;
    tauri_plugin_opener::open_path(folder, None::<&str>)
        .map_err(|error| format!("Could not open the attachment folder: {error}"))
}

fn database_timestamp(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("Could not get the local database time: {error}"))
}

#[cfg(test)]
mod tests {
    use super::image_content_type;

    #[test]
    fn local_preview_mime_types_are_limited_to_raster_images() {
        assert_eq!(image_content_type("work.PNG"), Some("image/png"));
        assert_eq!(image_content_type("photo.jpeg"), Some("image/jpeg"));
        assert_eq!(image_content_type("drawing.svg"), None);
        assert_eq!(image_content_type("notes.txt"), None);
    }
}

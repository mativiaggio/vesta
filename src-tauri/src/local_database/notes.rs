use super::open_database;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

const PAGE_SIZE: i64 = 25;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NoteCursor {
    created_at: String,
    id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalNoteTicket {
    ot_number: i64,
    title: String,
    status: String,
    client_id: Option<String>,
    client_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalNote {
    id: String,
    workspace_id: String,
    ticket_id: String,
    title: String,
    content: Value,
    version: i64,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
    created_by_user_id: String,
    updated_by_user_id: String,
    deleted_by_user_id: Option<String>,
    ticket: LocalNoteTicket,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalNotePage {
    notes: Vec<LocalNote>,
    next_cursor: Option<NoteCursor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalNoteDeletion {
    deleted_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateNoteInput {
    id: String,
    workspace_id: String,
    ticket_id: String,
    title: String,
    content: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateNoteInput {
    ticket_id: Option<String>,
    title: Option<String>,
    content: Option<Value>,
    expected_version: i64,
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
        Err("The note identifier is invalid.".to_owned())
    }
}

fn validate_cursor(cursor: Option<NoteCursor>) -> Result<Option<NoteCursor>, String> {
    if let Some(cursor) = &cursor {
        validate_id(&cursor.id)?;
        if cursor.created_at.len() > 40 || !cursor.created_at.ends_with('Z') {
            return Err("The note cursor is invalid.".to_owned());
        }
    }
    Ok(cursor)
}

fn validate_title(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    let length = trimmed.encode_utf16().count();
    if length == 0 || length > 160 {
        return Err("The note title must contain between 1 and 160 characters.".to_owned());
    }
    Ok(trimmed.to_owned())
}

fn safe_href(value: &str) -> bool {
    if value.chars().any(char::is_whitespace) || value.chars().any(char::is_control) {
        return false;
    }
    let Some((scheme, remainder)) = value.split_once(':') else {
        return false;
    };
    if remainder.is_empty() {
        return false;
    }
    match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" => remainder.starts_with("//") && remainder.len() > 2,
        "mailto" => !remainder.starts_with("//"),
        _ => false,
    }
}

fn validate_rich_text(content: &Value) -> Result<String, String> {
    let root = content.as_object().ok_or("The note content is invalid.")?;
    if content.get("type").and_then(Value::as_str) != Some("doc")
        || !content.get("content").and_then(Value::as_array).is_some()
        || root.keys().any(|key| key != "type" && key != "content")
    {
        return Err("The note content is invalid.".to_owned());
    }
    let mut stack: Vec<(&Value, usize, &str)> = content
        .get("content")
        .and_then(Value::as_array)
        .expect("validated document content")
        .iter()
        .map(|node| (node, 1, "doc"))
        .collect();
    let mut nodes = 1_usize;
    let mut text_length = 0_usize;
    let known_nodes = [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "text",
        "hardBreak",
    ];
    let blocks = [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "blockquote",
        "codeBlock",
        "horizontalRule",
    ];
    while let Some((node, depth, parent)) = stack.pop() {
        nodes += 1;
        if depth > 32 || nodes > 5_000 {
            return Err("The note content is too complex.".to_owned());
        }
        let kind = node
            .get("type")
            .and_then(Value::as_str)
            .ok_or("The note content is invalid.")?;
        if !known_nodes.contains(&kind) {
            return Err("The note content contains an unsupported element.".to_owned());
        }
        let valid_parent = match parent {
            "doc" | "listItem" | "blockquote" => blocks.contains(&kind),
            "paragraph" | "heading" => ["text", "hardBreak"].contains(&kind),
            "bulletList" | "orderedList" => kind == "listItem",
            "codeBlock" => kind == "text",
            _ => false,
        };
        if !valid_parent {
            return Err("The note content structure is invalid.".to_owned());
        }
        let object = node.as_object().ok_or("The note content is invalid.")?;
        let allowed_fields: &[&str] = if kind == "text" {
            &["type", "text", "marks"]
        } else {
            &["type", "attrs", "content"]
        };
        if object
            .keys()
            .any(|key| !allowed_fields.contains(&key.as_str()))
        {
            return Err("The note content contains unsupported fields.".to_owned());
        }
        if kind == "text" {
            let text = node
                .get("text")
                .and_then(Value::as_str)
                .ok_or("The note text is invalid.")?;
            if text.is_empty() {
                return Err("The note text is invalid.".to_owned());
            }
            text_length += text.encode_utf16().count();
            if text_length > 100_000 {
                return Err("The note content is too long.".to_owned());
            }
            if let Some(marks_value) = node.get("marks") {
                let marks = marks_value
                    .as_array()
                    .ok_or("The note formatting is invalid.")?;
                if marks.len() > 8 {
                    return Err("The note formatting is invalid.".to_owned());
                }
                for mark in marks {
                    let mark_object = mark.as_object().ok_or("The note formatting is invalid.")?;
                    let mark_type = mark
                        .get("type")
                        .and_then(Value::as_str)
                        .ok_or("The note formatting is invalid.")?;
                    if !["bold", "italic", "underline", "strike", "code", "link"]
                        .contains(&mark_type)
                    {
                        return Err("The note formatting contains an unsupported style.".to_owned());
                    }
                    if mark_object
                        .keys()
                        .any(|key| key != "type" && key != "attrs")
                    {
                        return Err("The note formatting contains unsupported fields.".to_owned());
                    }
                    if mark_type == "link" {
                        let attrs = mark
                            .get("attrs")
                            .and_then(Value::as_object)
                            .ok_or("The note formatting is invalid.")?;
                        if attrs.keys().any(|key| {
                            !["href", "target", "rel", "class", "title"].contains(&key.as_str())
                        }) {
                            return Err(
                                "The note formatting contains unsupported fields.".to_owned()
                            );
                        }
                        let href = attrs.get("href").and_then(Value::as_str);
                        if !href.is_some_and(safe_href) {
                            return Err("The note contains an unsafe link.".to_owned());
                        }
                        if attrs.get("target").is_some_and(|value| {
                            !["_blank", "_self"].contains(&value.as_str().unwrap_or(""))
                        }) {
                            return Err("The note link target is invalid.".to_owned());
                        }
                        if attrs.get("rel").is_some_and(|value| {
                            !value.is_null()
                                && value.as_str() != Some("noopener noreferrer nofollow")
                        }) {
                            return Err("The note link relation is invalid.".to_owned());
                        }
                        if attrs.get("class").is_some_and(|value| !value.is_null()) {
                            return Err("The note link style is invalid.".to_owned());
                        }
                        if attrs.get("title").is_some_and(|value| {
                            !value.is_null()
                                && value
                                    .as_str()
                                    .is_none_or(|title| title.encode_utf16().count() > 255)
                        }) {
                            return Err("The note link title is invalid.".to_owned());
                        }
                    } else if mark.get("attrs").is_some() {
                        return Err("The note formatting is invalid.".to_owned());
                    }
                }
            }
        }
        if let Some(attrs_value) = node.get("attrs") {
            let attrs = attrs_value
                .as_object()
                .ok_or("The note attributes are invalid.")?;
            let valid_attrs = match kind {
                "heading" => {
                    attrs.keys().all(|key| key == "level")
                        && attrs
                            .get("level")
                            .is_none_or(|value| matches!(value.as_i64(), Some(1..=3)))
                }
                "orderedList" => {
                    attrs.keys().all(|key| key == "start" || key == "type")
                        && attrs
                            .get("start")
                            .is_none_or(|value| matches!(value.as_i64(), Some(1..)))
                        && attrs.get("type").is_none_or(|value| {
                            value.is_null()
                                || ["1", "a", "A", "i", "I"].contains(&value.as_str().unwrap_or(""))
                        })
                }
                "codeBlock" => {
                    attrs.keys().all(|key| key == "language")
                        && attrs.get("language").is_none_or(|value| {
                            value.is_null()
                                || value
                                    .as_str()
                                    .is_some_and(|language| language.encode_utf16().count() <= 40)
                        })
                }
                _ => attrs.is_empty(),
            };
            if !valid_attrs {
                return Err("The note attributes are invalid.".to_owned());
            }
        }
        if let Some(children_value) = node.get("content") {
            let children = children_value
                .as_array()
                .ok_or("The note content structure is invalid.")?;
            if children.len() > 1_000 {
                return Err("The note content is too complex.".to_owned());
            }
            for child in children {
                stack.push((child, depth + 1, kind));
            }
        } else if ["listItem", "blockquote", "codeBlock"].contains(&kind) {
            return Err("The note content structure is incomplete.".to_owned());
        }
    }
    serde_json::to_string(content).map_err(|_| "The note content could not be stored.".to_owned())
}

fn current_timestamp(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("Could not create a local timestamp: {error}"))
}

fn ensure_workspace(connection: &Connection, workspace_id: &str) -> Result<(), String> {
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

fn ensure_ticket(
    connection: &Connection,
    workspace_id: &str,
    ticket_id: &str,
) -> Result<(), String> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tickets WHERE id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL)",
            params![ticket_id, workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not verify the local ticket: {error}"))?;
    if exists {
        Ok(())
    } else {
        Err("The selected ticket is not available in this workspace.".to_owned())
    }
}

pub(super) fn get_local_notes_impl(
    app: AppHandle,
    workspace_id: String,
    cursor: Option<NoteCursor>,
    ticket_id: Option<String>,
) -> Result<LocalNotePage, String> {
    validate_id(&workspace_id)?;
    let cursor = validate_cursor(cursor)?;
    if let Some(id) = &ticket_id {
        validate_id(id)?;
    }
    let connection = open_database(&app)?;
    ensure_workspace(&connection, &workspace_id)?;
    if let Some(id) = &ticket_id {
        ensure_ticket(&connection, &workspace_id, id)?;
    }
    read_page(
        &connection,
        &workspace_id,
        cursor.as_ref(),
        ticket_id.as_deref(),
        false,
    )
}

pub(super) fn create_local_note_impl(
    app: AppHandle,
    input: CreateNoteInput,
) -> Result<LocalNotePage, String> {
    validate_id(&input.id)?;
    validate_id(&input.workspace_id)?;
    validate_id(&input.ticket_id)?;
    let title = validate_title(input.title)?;
    let content = validate_rich_text(&input.content)?;
    let connection = open_database(&app)?;
    ensure_workspace(&connection, &input.workspace_id)?;
    ensure_ticket(&connection, &input.workspace_id, &input.ticket_id)?;
    let now = current_timestamp(&connection)?;
    connection
        .execute(
            "INSERT INTO notes (id, workspace_id, ticket_id, title, content, version, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, NULL, 'local', 'local', NULL)",
            params![input.id, input.workspace_id, input.ticket_id, title, content, now],
        )
        .map_err(|error| format!("Could not save the local note: {error}"))?;
    read_page(&connection, &input.workspace_id, None, None, false)
}

pub(super) fn update_local_note_impl(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    input: UpdateNoteInput,
    cursor: Option<NoteCursor>,
    ticket_filter: Option<String>,
) -> Result<LocalNotePage, String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    let cursor = validate_cursor(cursor)?;
    if input.expected_version < 1 {
        return Err("The note version is invalid.".to_owned());
    }
    let title = input.title.map(validate_title).transpose()?;
    let content = input.content.as_ref().map(validate_rich_text).transpose()?;
    if title.is_none() && content.is_none() && input.ticket_id.is_none() {
        return Err("No note changes were provided.".to_owned());
    }
    if let Some(id) = &input.ticket_id {
        validate_id(id)?;
    }
    let connection = open_database(&app)?;
    ensure_workspace(&connection, &workspace_id)?;
    if let Some(id) = &input.ticket_id {
        ensure_ticket(&connection, &workspace_id, id)?;
    }
    let now = current_timestamp(&connection)?;
    let content_json = input
        .content
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| "The note content could not be stored.".to_owned())?;
    let changed = connection
        .execute(
            "UPDATE notes SET ticket_id = COALESCE(?1, ticket_id), title = COALESCE(?2, title), content = COALESCE(?3, content),
                updated_at = ?4, updated_by_user_id = 'local', version = version + 1
             WHERE id = ?5 AND workspace_id = ?6 AND version = ?7 AND deleted_at IS NULL",
            params![input.ticket_id, title, content_json, now, note_id, workspace_id, input.expected_version],
        )
        .map_err(|error| format!("Could not update the local note: {error}"))?;
    if changed != 1 {
        return Err("The note changed elsewhere or is no longer available.".to_owned());
    }
    read_page(
        &connection,
        &workspace_id,
        cursor.as_ref(),
        ticket_filter.as_deref(),
        false,
    )
}

pub(super) fn delete_local_note_impl(
    app: AppHandle,
    workspace_id: String,
    note_id: String,
    expected_version: i64,
) -> Result<LocalNoteDeletion, String> {
    validate_id(&workspace_id)?;
    validate_id(&note_id)?;
    if expected_version < 1 {
        return Err("The note version is invalid.".to_owned());
    }
    let mut connection = open_database(&app)?;
    ensure_workspace(&connection, &workspace_id)?;
    let now = current_timestamp(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not prepare the local note deletion: {error}"))?;
    let changed = transaction.execute(
        "UPDATE notes SET deleted_at = ?1, deleted_by_user_id = 'local', updated_by_user_id = 'local', updated_at = ?1, version = version + 1
         WHERE id = ?2 AND workspace_id = ?3 AND version = ?4 AND deleted_at IS NULL",
        params![now, note_id, workspace_id, expected_version],
    ).map_err(|error| format!("Could not delete the local note: {error}"))?;
    if changed != 1 {
        return Err("The note changed elsewhere or is no longer available.".to_owned());
    }
    transaction.execute(
        "UPDATE note_attachments SET deleted_at = ?1, deleted_by_user_id = 'local', updated_by_user_id = 'local', updated_at = ?1, version = version + 1
         WHERE workspace_id = ?2 AND note_id = ?3 AND deleted_at IS NULL",
        params![now, workspace_id, note_id],
    ).map_err(|error| format!("Could not delete local note attachments: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not finish deleting the local note: {error}"))?;
    Ok(LocalNoteDeletion { deleted_at: now })
}

fn read_page(
    connection: &Connection,
    workspace_id: &str,
    cursor: Option<&NoteCursor>,
    ticket_id: Option<&str>,
    include_soft_deleted: bool,
) -> Result<LocalNotePage, String> {
    let mut statement = connection.prepare(
        "SELECT n.id, n.workspace_id, n.ticket_id, n.title, n.content, n.version, n.created_at, n.updated_at, n.deleted_at,
                n.created_by_user_id, n.updated_by_user_id, n.deleted_by_user_id,
                t.ot_number, t.title, t.status, t.client_id, c.name
         FROM notes n
         JOIN tickets t ON t.id = n.ticket_id AND t.workspace_id = n.workspace_id
         LEFT JOIN clients c ON c.id = t.client_id AND c.deleted_at IS NULL
         WHERE n.workspace_id = ?1
           AND (?2 = 1 OR (n.deleted_at IS NULL AND t.deleted_at IS NULL))
           AND (?3 IS NULL OR n.ticket_id = ?3)
           AND (?4 IS NULL OR n.created_at < ?4 OR (n.created_at = ?4 AND n.id < ?5))
         ORDER BY n.created_at DESC, n.id DESC LIMIT ?6",
    ).map_err(|error| format!("Could not read local notes: {error}"))?;
    let notes = statement
        .query_map(
            params![
                workspace_id,
                include_soft_deleted,
                ticket_id,
                cursor.map(|value| value.created_at.as_str()),
                cursor.map(|value| value.id.as_str()),
                PAGE_SIZE + 1,
            ],
            |row| {
                let content_json: String = row.get(4)?;
                let content = serde_json::from_str(&content_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        4,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
                Ok(LocalNote {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    ticket_id: row.get(2)?,
                    title: row.get(3)?,
                    content,
                    version: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    deleted_at: row.get(8)?,
                    created_by_user_id: row.get(9)?,
                    updated_by_user_id: row.get(10)?,
                    deleted_by_user_id: row.get(11)?,
                    ticket: LocalNoteTicket {
                        ot_number: row.get(12)?,
                        title: row.get(13)?,
                        status: row.get(14)?,
                        client_id: row.get(15)?,
                        client_name: row.get(16)?,
                    },
                })
            },
        )
        .map_err(|error| format!("Could not read local notes: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read local notes: {error}"))?;
    let has_more = notes.len() > PAGE_SIZE as usize;
    let mut notes = notes;
    notes.truncate(PAGE_SIZE as usize);
    let next_cursor = if has_more {
        notes.last().map(|note| NoteCursor {
            created_at: note.created_at.clone(),
            id: note.id.clone(),
        })
    } else {
        None
    };
    Ok(LocalNotePage { notes, next_cursor })
}

#[cfg(test)]
mod tests {
    use super::validate_rich_text;
    use serde_json::json;

    #[test]
    fn accepts_nested_lists_and_safe_formatted_links() {
        let content = json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "Decision", "marks": [{ "type": "bold" }] }] },
                {
                    "type": "orderedList",
                    "attrs": { "start": 1, "type": null },
                    "content": [{
                        "type": "listItem",
                        "content": [
                            { "type": "paragraph", "content": [{ "type": "text", "text": "First" }] },
                            { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Nested" }] }] }] }
                        ]
                    }]
                },
                {
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "text": "Reference",
                        "marks": [{
                            "type": "link",
                            "attrs": {
                                "href": "https://example.com/reference",
                                "target": "_blank",
                                "rel": "noopener noreferrer nofollow",
                                "class": null,
                                "title": null
                            }
                        }]
                    }]
                }
            ]
        });

        assert!(validate_rich_text(&content).is_ok());
    }

    #[test]
    fn rejects_unsafe_links_and_unknown_attributes() {
        let unsafe_link = json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{ "type": "text", "text": "Open", "marks": [{ "type": "link", "attrs": { "href": "javascript:alert(1)" } }] }]
            }]
        });
        let unknown_attribute = json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "attrs": { "onclick": "run()" } }]
        });

        assert!(validate_rich_text(&unsafe_link).is_err());
        assert!(validate_rich_text(&unknown_attribute).is_err());
    }
}

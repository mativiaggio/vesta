use super::open_database;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize, de::Deserializer};
use tauri::AppHandle;

const PAGE_SIZE: i64 = 25;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTicket {
    id: String,
    workspace_id: String,
    ot_number: i64,
    client_id: Option<String>,
    client_name: Option<String>,
    title: String,
    description: String,
    priority: String,
    status: String,
    estimated_hours: f64,
    worked_hours: f64,
    coding_finished_at: Option<String>,
    production_at: Option<String>,
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
pub(crate) struct TicketCursor {
    created_at: String,
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TicketPageQuery {
    cursor: Option<TicketCursor>,
    search: String,
    status: Option<String>,
    priority: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTicketPage {
    tickets: Vec<LocalTicket>,
    next_cursor: Option<TicketCursor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTicketDeletion {
    deleted_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateTicketInput {
    id: String,
    workspace_id: String,
    ot_number: i64,
    client_id: Option<String>,
    title: String,
    description: String,
    priority: String,
    status: String,
    estimated_hours: f64,
    worked_hours: f64,
}

#[derive(Debug, Default)]
enum NullableField<T> {
    #[default]
    Missing,
    Null,
    Value(T),
}

fn deserialize_nullable_field<'de, D>(deserializer: D) -> Result<NullableField<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(match Option::<String>::deserialize(deserializer)? {
        Some(value) => NullableField::Value(value),
        None => NullableField::Null,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateTicketInput {
    ot_number: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_nullable_field")]
    client_id: NullableField<String>,
    title: Option<String>,
    description: Option<String>,
    priority: Option<String>,
    status: Option<String>,
    estimated_hours: Option<f64>,
    worked_hours: Option<f64>,
    expected_version: i64,
}

pub(super) fn get_local_tickets_impl(
    app: AppHandle,
    workspace_id: String,
    cursor: Option<TicketCursor>,
    search: String,
    status: Option<String>,
    priority: Option<String>,
    include_soft_deleted: bool,
) -> Result<LocalTicketPage, String> {
    validate_id(&workspace_id)?;
    let cursor = validate_cursor(cursor)?;
    let search = validate_search(search)?;
    let status = status.map(validate_status).transpose()?;
    let priority = priority.map(validate_priority).transpose()?;
    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &workspace_id)?;
    read_state(
        &connection,
        &workspace_id,
        cursor.as_ref(),
        &search,
        status.as_deref(),
        priority.as_deref(),
        include_soft_deleted,
    )
}

pub(super) fn get_next_local_ticket_ot_number_impl(
    app: AppHandle,
    workspace_id: String,
) -> Result<i64, String> {
    validate_id(&workspace_id)?;
    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &workspace_id)?;
    let current: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(ot_number), 0) + 1 FROM tickets WHERE workspace_id = ?1",
            [&workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not suggest a local OT number: {error}"))?;
    if current > 2_147_483_647 {
        return Err("The OT number limit has been reached.".to_owned());
    }
    Ok(current)
}

pub(super) fn create_local_ticket_impl(
    app: AppHandle,
    input: CreateTicketInput,
) -> Result<LocalTicketPage, String> {
    validate_id(&input.id)?;
    validate_id(&input.workspace_id)?;
    let client_id = input
        .client_id
        .map(|value| validate_id(&value))
        .transpose()?;
    validate_ot_number(input.ot_number)?;
    let title = validate_text(input.title, 200, "title")?;
    let description = validate_description(input.description)?;
    let priority = validate_priority(input.priority)?;
    let status = validate_status(input.status)?;
    validate_hours(input.estimated_hours, "estimated hours")?;
    validate_hours(input.worked_hours, "worked hours")?;

    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &input.workspace_id)?;
    if let Some(client_id) = &client_id {
        ensure_client_available(&connection, &input.workspace_id, client_id)?;
    }
    let now = current_timestamp(&connection)?;
    let coding_finished_at = (status == "delivered").then_some(now.as_str());
    let production_at = (status == "production").then_some(now.as_str());
    connection
        .execute(
            "INSERT INTO tickets (
                id, workspace_id, ot_number, client_id, title, description, priority, status, estimated_hours,
                worked_hours, coding_finished_at, production_at, version, created_at, updated_at,
                deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?13, NULL, 'local', 'local', NULL)",
            params![
                input.id,
                input.workspace_id,
                input.ot_number,
                client_id,
                title,
                description,
                priority,
                status,
                input.estimated_hours,
                input.worked_hours,
                coding_finished_at,
                production_at,
                now
            ],
        )
        .map_err(|error| format!("Could not save the local ticket: {error}"))?;
    read_state(
        &connection,
        &input.workspace_id,
        None,
        "",
        None,
        None,
        false,
    )
}

pub(super) fn update_local_ticket_impl(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    input: UpdateTicketInput,
    page_query: TicketPageQuery,
) -> Result<LocalTicketPage, String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    if input.expected_version < 1 {
        return Err("The ticket version is invalid.".to_owned());
    }
    let client_id = match input.client_id {
        NullableField::Missing => None,
        NullableField::Null => Some(None),
        NullableField::Value(value) => Some(Some(validate_id(&value)?)),
    };
    let ot_number = input.ot_number.map(validate_ot_number).transpose()?;
    let title = input
        .title
        .map(|value| validate_text(value, 200, "title"))
        .transpose()?;
    let description = input.description.map(validate_description).transpose()?;
    let priority = input.priority.map(validate_priority).transpose()?;
    let status = input.status.map(validate_status).transpose()?;
    let estimated_hours = input
        .estimated_hours
        .map(|value| validate_hours(value, "estimated hours").map(|()| value))
        .transpose()?;
    let worked_hours = input
        .worked_hours
        .map(|value| validate_hours(value, "worked hours").map(|()| value))
        .transpose()?;
    if ot_number.is_none()
        && client_id.is_none()
        && title.is_none()
        && description.is_none()
        && priority.is_none()
        && status.is_none()
        && estimated_hours.is_none()
        && worked_hours.is_none()
    {
        return Err("No ticket changes were provided.".to_owned());
    }
    let cursor = validate_cursor(page_query.cursor)?;
    let search = validate_search(page_query.search)?;
    let status_filter = page_query.status.map(validate_status).transpose()?;
    let priority_filter = page_query.priority.map(validate_priority).transpose()?;

    let connection = open_database(&app)?;
    ensure_workspace_available(&connection, &workspace_id)?;
    if let Some(Some(client_id)) = &client_id {
        ensure_client_available(&connection, &workspace_id, client_id)?;
    }
    let now = current_timestamp(&connection)?;
    let sets_coding_date = status.as_deref() == Some("delivered");
    let sets_production_date = status.as_deref() == Some("production");
    let changed = connection
        .execute(
            "UPDATE tickets SET
                ot_number = COALESCE(?1, ot_number),
                client_id = CASE WHEN ?2 = 1 THEN ?3 ELSE client_id END,
                title = COALESCE(?4, title),
                description = COALESCE(?5, description),
                priority = COALESCE(?6, priority),
                status = COALESCE(?7, status),
                estimated_hours = COALESCE(?8, estimated_hours),
                worked_hours = COALESCE(?9, worked_hours),
                coding_finished_at = CASE WHEN ?10 = 1 THEN ?11 ELSE coding_finished_at END,
                production_at = CASE WHEN ?12 = 1 THEN ?11 ELSE production_at END,
                updated_at = ?11,
                updated_by_user_id = 'local',
                version = version + 1
             WHERE id = ?13 AND workspace_id = ?14 AND version = ?15 AND deleted_at IS NULL",
            params![
                ot_number,
                client_id.is_some(),
                client_id.flatten(),
                title,
                description,
                priority,
                status,
                estimated_hours,
                worked_hours,
                sets_coding_date,
                now,
                sets_production_date,
                ticket_id,
                workspace_id,
                input.expected_version,
            ],
        )
        .map_err(|error| format!("Could not update the local ticket: {error}"))?;
    if changed != 1 {
        return Err("The ticket changed elsewhere or is no longer available.".to_owned());
    }
    read_state(
        &connection,
        &workspace_id,
        cursor.as_ref(),
        &search,
        status_filter.as_deref(),
        priority_filter.as_deref(),
        false,
    )
}

pub(super) fn delete_local_ticket_impl(
    app: AppHandle,
    workspace_id: String,
    ticket_id: String,
    expected_version: i64,
) -> Result<LocalTicketDeletion, String> {
    validate_id(&workspace_id)?;
    validate_id(&ticket_id)?;
    if expected_version < 1 {
        return Err("The ticket version is invalid.".to_owned());
    }
    let mut connection = open_database(&app)?;
    ensure_workspace_available(&connection, &workspace_id)?;
    let now = current_timestamp(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not prepare the local ticket deletion: {error}"))?;
    let changed = transaction
        .execute(
            "UPDATE tickets SET
                deleted_at = ?1,
                deleted_by_user_id = 'local',
                updated_by_user_id = 'local',
                updated_at = ?1,
                version = version + 1
             WHERE id = ?2 AND workspace_id = ?3 AND version = ?4 AND deleted_at IS NULL",
            params![now, ticket_id, workspace_id, expected_version],
        )
        .map_err(|error| format!("Could not delete the local ticket: {error}"))?;
    if changed != 1 {
        return Err("The ticket changed elsewhere or is no longer available.".to_owned());
    }
    transaction
        .execute(
            "UPDATE ticket_attachments SET
                deleted_at = ?1, deleted_by_user_id = 'local', updated_by_user_id = 'local',
                updated_at = ?1, version = version + 1
             WHERE workspace_id = ?2 AND ticket_id = ?3 AND deleted_at IS NULL",
            params![now, workspace_id, ticket_id],
        )
        .map_err(|error| format!("Could not delete local ticket attachments: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not finish deleting the local ticket: {error}"))?;
    Ok(LocalTicketDeletion { deleted_at: now })
}

fn read_state(
    connection: &Connection,
    workspace_id: &str,
    cursor: Option<&TicketCursor>,
    search: &str,
    status: Option<&str>,
    priority: Option<&str>,
    include_soft_deleted: bool,
) -> Result<LocalTicketPage, String> {
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.workspace_id, t.client_id, c.name, t.title, t.description, t.priority,
                    t.ot_number,
                    t.status, t.estimated_hours, t.worked_hours, t.coding_finished_at, t.production_at,
                    t.version, t.created_at, t.updated_at, t.deleted_at, t.created_by_user_id,
                    t.updated_by_user_id, t.deleted_by_user_id
             FROM tickets t
             LEFT JOIN clients c ON c.id = t.client_id AND c.deleted_at IS NULL
             WHERE t.workspace_id = ?1
               AND (?2 = 1 OR t.deleted_at IS NULL)
               AND (?3 = '' OR instr(lower(t.title), lower(?3)) > 0 OR instr(lower(t.description), lower(?3)) > 0)
               AND (?4 IS NULL OR t.status = ?4)
               AND (?5 IS NULL OR t.priority = ?5)
               AND (?6 IS NULL OR t.created_at < ?6 OR (t.created_at = ?6 AND t.id < ?7))
             ORDER BY t.created_at DESC, t.id DESC
             LIMIT ?8",
        )
        .map_err(|error| format!("Could not read local tickets: {error}"))?;
    let tickets = statement
        .query_map(
            params![
                workspace_id,
                include_soft_deleted,
                search,
                status,
                priority,
                cursor.map(|value| value.created_at.as_str()),
                cursor.map(|value| value.id.as_str()),
                PAGE_SIZE + 1,
            ],
            |row| {
                Ok(LocalTicket {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    client_id: row.get(2)?,
                    client_name: row.get(3)?,
                    title: row.get(4)?,
                    description: row.get(5)?,
                    priority: row.get(6)?,
                    ot_number: row.get(7)?,
                    status: row.get(8)?,
                    estimated_hours: row.get(9)?,
                    worked_hours: row.get(10)?,
                    coding_finished_at: row.get(11)?,
                    production_at: row.get(12)?,
                    version: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                    deleted_at: row.get(16)?,
                    created_by_user_id: row.get(17)?,
                    updated_by_user_id: row.get(18)?,
                    deleted_by_user_id: row.get(19)?,
                })
            },
        )
        .map_err(|error| format!("Could not read local tickets: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read local tickets: {error}"))?;
    let has_more = tickets.len() > PAGE_SIZE as usize;
    let mut tickets = tickets;
    tickets.truncate(PAGE_SIZE as usize);
    let next_cursor = if has_more {
        tickets.last().map(|ticket| TicketCursor {
            created_at: ticket.created_at.clone(),
            id: ticket.id.clone(),
        })
    } else {
        None
    };
    Ok(LocalTicketPage {
        tickets,
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

fn ensure_client_available(
    connection: &Connection,
    workspace_id: &str,
    client_id: &str,
) -> Result<(), String> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM clients WHERE id = ?1 AND workspace_id = ?2 AND active = 1 AND deleted_at IS NULL)",
            params![client_id, workspace_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not verify the selected ticket client: {error}"))?;
    if exists {
        Ok(())
    } else {
        Err("The selected ticket client is not available in this workspace.".to_owned())
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
            "The ticket {label} must contain between 1 and {maximum} characters."
        ));
    }
    Ok(trimmed.to_owned())
}

fn validate_description(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.encode_utf16().count() > 20_000 {
        return Err("The ticket description is too long.".to_owned());
    }
    Ok(trimmed.to_owned())
}

fn validate_hours(value: f64, label: &str) -> Result<(), String> {
    let scaled = value * 100.0;
    if !value.is_finite()
        || !(0.0..=999_999.99).contains(&value)
        || (scaled - scaled.round()).abs() > 0.000_001
    {
        return Err(format!(
            "Ticket {label} must be between 0 and 999999.99 with up to two decimals."
        ));
    }
    Ok(())
}

fn validate_ot_number(value: i64) -> Result<i64, String> {
    if (1..=2_147_483_647).contains(&value) {
        Ok(value)
    } else {
        Err("The ticket OT number must be a positive 32-bit integer.".to_owned())
    }
}

fn validate_search(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.encode_utf16().count() > 120 {
        return Err("The ticket search is too long.".to_owned());
    }
    Ok(trimmed.to_owned())
}

fn validate_status(value: String) -> Result<String, String> {
    match value.as_str() {
        "requested" | "analysis" | "development" | "review" | "correction" | "delivered"
        | "production" => Ok(value),
        _ => Err("The ticket status is invalid.".to_owned()),
    }
}

fn validate_priority(value: String) -> Result<String, String> {
    match value.as_str() {
        "urgent" | "high" | "medium" | "low" => Ok(value),
        _ => Err("The ticket priority is invalid.".to_owned()),
    }
}

fn validate_cursor(cursor: Option<TicketCursor>) -> Result<Option<TicketCursor>, String> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    validate_id(&cursor.id)?;
    let bytes = cursor.created_at.as_bytes();
    let valid = bytes.len() == 24
        && [4, 7, 10, 13, 16, 19, 23]
            .iter()
            .enumerate()
            .all(|(separator, position)| bytes[*position] == b"--T::.Z"[separator])
        && bytes.iter().enumerate().all(|(index, byte)| {
            [4, 7, 10, 13, 16, 19, 23].contains(&index) || byte.is_ascii_digit()
        });
    if valid {
        Ok(Some(cursor))
    } else {
        Err("The ticket page cursor is invalid.".to_owned())
    }
}

fn validate_id(value: &str) -> Result<String, String> {
    let valid = value.len() == 36
        && value.as_bytes().iter().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    if valid {
        Ok(value.to_owned())
    } else {
        Err("The ticket identifier is invalid.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::{TicketCursor, current_timestamp, read_state};
    use crate::local_database::migrate;
    use rusqlite::Connection;

    const WORKSPACE_ID: &str = "ac01e94f-379f-4e03-9d3b-94231ac32fab";
    const TICKET_ID: &str = "c1a63af1-19ba-4473-aaf4-e75d9032e487";

    fn insert_workspace(connection: &Connection, now: &str) {
        connection
            .execute(
                "INSERT INTO workspaces (id, name, accent_color, icon, is_active, created_at, updated_at)
                 VALUES (?1, 'Local', 'olive', 'briefcase', 1, ?2, ?2)",
                rusqlite::params![WORKSPACE_ID, now],
            )
            .expect("workspace should be inserted");
    }

    #[test]
    fn soft_deleted_tickets_are_hidden_from_regular_pages_and_kept_for_sync() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite database");
        migrate(&mut connection).expect("migrations should apply");
        let now = current_timestamp(&connection).expect("timestamp");
        insert_workspace(&connection, &now);
        connection
            .execute(
                "INSERT INTO tickets (id, workspace_id, ot_number, title, description, priority, status, estimated_hours, worked_hours, version, created_at, updated_at, created_by_user_id, updated_by_user_id)
                 VALUES (?1, ?2, 1, 'Example ticket', '', 'high', 'analysis', 2.5, 0, 1, ?3, ?3, 'local', 'local')",
                rusqlite::params![TICKET_ID, WORKSPACE_ID, now],
            )
            .expect("ticket should be inserted");
        connection
            .execute(
                "UPDATE tickets SET deleted_at = ?1 WHERE id = ?2",
                rusqlite::params![now, TICKET_ID],
            )
            .expect("ticket should be soft deleted");

        assert!(
            read_state(&connection, WORKSPACE_ID, None, "", None, None, false)
                .expect("active page")
                .tickets
                .is_empty()
        );
        assert_eq!(
            read_state(&connection, WORKSPACE_ID, None, "", None, None, true)
                .expect("sync page")
                .tickets
                .len(),
            1
        );
    }

    #[test]
    fn local_ot_numbers_remain_unique_after_soft_delete() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite database");
        migrate(&mut connection).expect("migrations should apply");
        let now = current_timestamp(&connection).expect("timestamp");
        insert_workspace(&connection, &now);
        connection
            .execute(
                "INSERT INTO tickets (id, workspace_id, ot_number, title, created_at, updated_at, created_by_user_id, updated_by_user_id, deleted_at)
                 VALUES (?1, ?2, 9, 'Archived', ?3, ?3, 'local', 'local', ?3)",
                rusqlite::params![TICKET_ID, WORKSPACE_ID, now],
            )
            .expect("soft deleted ticket should be inserted");

        let next_number: i64 = connection
            .query_row(
                "SELECT COALESCE(MAX(ot_number), 0) + 1 FROM tickets WHERE workspace_id = ?1",
                [WORKSPACE_ID],
                |row| row.get(0),
            )
            .expect("next ticket OT number should be available");
        assert_eq!(next_number, 10);

        let duplicate = connection.execute(
            "INSERT INTO tickets (id, workspace_id, ot_number, title, created_at, updated_at, created_by_user_id, updated_by_user_id)
             VALUES (?1, ?2, 9, 'Duplicate', ?3, ?3, 'local', 'local')",
            rusqlite::params!["c1a63af1-19ba-4473-aaf4-e75d9032e488", WORKSPACE_ID, now],
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn page_filters_are_applied_before_limits_and_cursors_progress() {
        let mut connection = Connection::open_in_memory().expect("in-memory SQLite database");
        migrate(&mut connection).expect("migrations should apply");
        let now = current_timestamp(&connection).expect("timestamp");
        insert_workspace(&connection, &now);
        for number in 0..27 {
            let id = format!("c1a63af1-19ba-4473-aaf4-{number:012x}");
            let title = if number == 26 {
                "Target ticket"
            } else {
                "Other ticket"
            };
            let status = if number == 26 {
                "analysis"
            } else {
                "requested"
            };
            connection
                .execute(
                    "INSERT INTO tickets (id, workspace_id, ot_number, title, description, priority, status, estimated_hours, worked_hours, version, created_at, updated_at, created_by_user_id, updated_by_user_id)
                     VALUES (?1, ?2, ?3, ?4, '', 'medium', ?5, 0, 0, 1, ?6, ?6, 'local', 'local')",
                    rusqlite::params![id, WORKSPACE_ID, number + 1, title, status, format!("2026-10-21T12:00:{number:02}.000Z")],
                )
                .expect("ticket should be inserted");
        }

        let first =
            read_state(&connection, WORKSPACE_ID, None, "", None, None, false).expect("first page");
        assert_eq!(first.tickets.len(), 25);
        let cursor = first.next_cursor.expect("next page cursor");
        let last = read_state(
            &connection,
            WORKSPACE_ID,
            Some(&cursor),
            "",
            None,
            None,
            false,
        )
        .expect("last page");
        assert_eq!(last.tickets.len(), 2);
        assert!(last.next_cursor.is_none());
        let filtered = read_state(
            &connection,
            WORKSPACE_ID,
            None,
            "target",
            Some("analysis"),
            None,
            false,
        )
        .expect("filtered page");
        assert_eq!(filtered.tickets.len(), 1);
        assert_eq!(filtered.tickets[0].title, "Target ticket");
        assert_eq!(
            read_state(
                &connection,
                WORKSPACE_ID,
                None,
                "target",
                Some("requested"),
                None,
                false
            )
            .expect("filtered page")
            .tickets
            .len(),
            0
        );
    }

    #[test]
    fn ticket_cursor_keeps_the_last_row_key() {
        let cursor = TicketCursor {
            created_at: "2026-10-21T12:00:00.000Z".to_owned(),
            id: TICKET_ID.to_owned(),
        };
        assert_eq!(cursor.id, TICKET_ID);
    }
}

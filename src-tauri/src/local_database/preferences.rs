use super::open_database;
use rusqlite::{OptionalExtension, params};
use tauri::AppHandle;

pub(super) fn get_local_preference_impl(
    app: AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    validate_preference_key(&key)?;
    let connection = open_database(&app)?;
    connection
        .query_row(
            "SELECT value FROM app_preferences WHERE key = ?1 AND deleted_at IS NULL",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read the local preference: {error}"))
}

pub(super) fn set_local_preference_impl(
    app: AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    validate_preference(&key, &value)?;
    let connection = open_database(&app)?;
    connection
        .execute(
            "INSERT INTO app_preferences (key, value, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, deleted_at = NULL",
            params![key, value],
        )
        .map_err(|error| format!("Could not save the local preference: {error}"))?;
    Ok(())
}

fn validate_preference_key(key: &str) -> Result<(), String> {
    match key {
        "vesta.language"
        | "vesta.theme"
        | "vesta.date-format"
        | "vesta.tickets-view"
        | "vesta.ticket-detail-presentation" => Ok(()),
        _ => Err("This preference is not supported by local storage.".to_owned()),
    }
}

fn validate_preference(key: &str, value: &str) -> Result<(), String> {
    validate_preference_key(key)?;
    let valid = match key {
        "vesta.language" => matches!(value, "en" | "es"),
        "vesta.theme" => matches!(value, "light" | "dark"),
        "vesta.date-format" => matches!(
            value,
            "locale" | "day-month-year" | "month-day-year" | "year-month-day"
        ),
        "vesta.tickets-view" => matches!(value, "table" | "kanban"),
        "vesta.ticket-detail-presentation" => matches!(value, "modal" | "fullscreen"),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("This value is not valid for the selected preference.".to_owned())
    }
}

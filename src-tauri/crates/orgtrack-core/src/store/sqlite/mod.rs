use rusqlite::{params, Connection};

mod provenance;
mod record_store;
mod schema;
mod usage;

#[cfg(test)]
mod tests;

pub struct SqliteRecordStore<'conn> {
    conn: &'conn Connection,
}

impl<'conn> SqliteRecordStore<'conn> {
    pub fn new(conn: &'conn Connection) -> Self {
        Self { conn }
    }

    fn to_json<T: serde::Serialize>(value: &T) -> Result<String, String> {
        serde_json::to_string(value).map_err(|err| err.to_string())
    }

    fn from_json<T: serde::de::DeserializeOwned>(value: String) -> Result<T, String> {
        serde_json::from_str(&value).map_err(|err| err.to_string())
    }

    fn list_by_scope<T: serde::de::DeserializeOwned>(
        &self,
        table_name: &str,
        source: Option<&str>,
        session_id: Option<&str>,
        order_by: &str,
    ) -> Result<Vec<T>, String> {
        let mut records = Vec::new();
        let query = match (source, session_id) {
            (Some(_), Some(_)) => format!(
                "SELECT payload_json FROM {table_name} WHERE source = ?1 AND session_id = ?2 ORDER BY {order_by}"
            ),
            (Some(_), None) => format!(
                "SELECT payload_json FROM {table_name} WHERE source = ?1 ORDER BY {order_by}"
            ),
            (None, Some(_)) => format!(
                "SELECT payload_json FROM {table_name} WHERE session_id = ?1 ORDER BY {order_by}"
            ),
            (None, None) => format!("SELECT payload_json FROM {table_name} ORDER BY {order_by}"),
        };
        let mut stmt = self.conn.prepare(&query).map_err(|err| err.to_string())?;
        match (source, session_id) {
            (Some(source), Some(session_id)) => {
                let rows = stmt
                    .query_map(params![source, session_id], |row| row.get::<_, String>(0))
                    .map_err(|err| err.to_string())?;
                for row in rows {
                    records.push(Self::from_json(row.map_err(|err| err.to_string())?)?);
                }
            }
            (Some(source), None) => {
                let rows = stmt
                    .query_map(params![source], |row| row.get::<_, String>(0))
                    .map_err(|err| err.to_string())?;
                for row in rows {
                    records.push(Self::from_json(row.map_err(|err| err.to_string())?)?);
                }
            }
            (None, Some(session_id)) => {
                let rows = stmt
                    .query_map(params![session_id], |row| row.get::<_, String>(0))
                    .map_err(|err| err.to_string())?;
                for row in rows {
                    records.push(Self::from_json(row.map_err(|err| err.to_string())?)?);
                }
            }
            (None, None) => {
                let rows = stmt
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|err| err.to_string())?;
                for row in rows {
                    records.push(Self::from_json(row.map_err(|err| err.to_string())?)?);
                }
            }
        }
        Ok(records)
    }
}

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS exercises (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    muscle_group TEXT NOT NULL DEFAULT '',
    video_url    TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    goal       TEXT NOT NULL DEFAULT '',
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id),
    day_label   TEXT NOT NULL DEFAULT '第 1 天',
    sets        INTEGER NOT NULL DEFAULT 3,
    reps        INTEGER NOT NULL DEFAULT 10,
    weight_kg   REAL NOT NULL DEFAULT 0,
    rest_sec    INTEGER NOT NULL DEFAULT 60,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id);
"#;

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("fitness.db"))?;
    conn.execute_batch(SCHEMA)?;
    app.manage(Db(Mutex::new(conn)));
    Ok(())
}

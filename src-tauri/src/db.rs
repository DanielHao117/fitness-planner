use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    goal       TEXT NOT NULL DEFAULT '',
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id      INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    muscle_group TEXT NOT NULL DEFAULT '',
    video_url    TEXT,
    day_label    TEXT NOT NULL DEFAULT '第 1 天',
    sets         INTEGER NOT NULL DEFAULT 3,
    reps         INTEGER NOT NULL DEFAULT 10,
    weight_kg    REAL NOT NULL DEFAULT 0,
    rest_sec     INTEGER NOT NULL DEFAULT 60,
    sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id);
"#;

fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

/// 旧版本里 plan_items 通过 exercise_id 关联全局 exercises 表。
/// 新版把动作直接存进计划项；这里把旧数据迁移过来并删除 exercises 表。
fn migrate(conn: &Connection) -> Result<(), Box<dyn std::error::Error>> {
    if has_column(conn, "plan_items", "exercise_id") {
        conn.execute_batch(
            r#"
            DROP INDEX IF EXISTS idx_plan_items_plan;
            ALTER TABLE plan_items RENAME TO plan_items_legacy;
            CREATE TABLE plan_items (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id      INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
                name         TEXT NOT NULL,
                muscle_group TEXT NOT NULL DEFAULT '',
                video_url    TEXT,
                day_label    TEXT NOT NULL DEFAULT '第 1 天',
                sets         INTEGER NOT NULL DEFAULT 3,
                reps         INTEGER NOT NULL DEFAULT 10,
                weight_kg    REAL NOT NULL DEFAULT 0,
                rest_sec     INTEGER NOT NULL DEFAULT 60,
                sort_order   INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO plan_items
                (id, plan_id, name, muscle_group, video_url, day_label, sets, reps, weight_kg, rest_sec, sort_order)
            SELECT i.id, i.plan_id, COALESCE(e.name, ''), COALESCE(e.muscle_group, ''),
                   e.video_url, i.day_label, i.sets, i.reps, i.weight_kg, i.rest_sec, i.sort_order
            FROM plan_items_legacy i
            LEFT JOIN exercises e ON e.id = i.exercise_id;
            DROP TABLE plan_items_legacy;
            DROP TABLE IF EXISTS exercises;
            CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id);
            "#,
        )?;
    }
    Ok(())
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = Connection::open(dir.join("fitness.db"))?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    app.manage(Db(Mutex::new(conn)));
    Ok(())
}

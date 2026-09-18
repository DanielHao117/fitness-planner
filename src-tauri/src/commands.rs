use crate::db::Db;
use crate::models::*;
use rusqlite::params;
use tauri::State;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn list_plans(db: State<Db>) -> Result<Vec<PlanSummary>, String> {
    let conn = db.0.lock().map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.goal, p.created_at, COUNT(i.id)
             FROM plans p
             LEFT JOIN plan_items i ON i.plan_id = p.id
             GROUP BY p.id
             ORDER BY p.created_at DESC, p.id DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PlanSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                goal: r.get(2)?,
                created_at: r.get(3)?,
                item_count: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[tauri::command]
pub fn get_plan(db: State<Db>, id: i64) -> Result<Plan, String> {
    let conn = db.0.lock().map_err(err)?;
    let mut plan = conn
        .query_row(
            "SELECT id, name, goal, notes, created_at FROM plans WHERE id = ?1",
            params![id],
            |r| {
                Ok(Plan {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    goal: r.get(2)?,
                    notes: r.get(3)?,
                    created_at: r.get(4)?,
                    items: Vec::new(),
                })
            },
        )
        .map_err(err)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, muscle_group, video_url, day_label,
                    sets, reps, weight_kg, rest_sec, sort_order
             FROM plan_items
             WHERE plan_id = ?1
             ORDER BY sort_order, id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![id], |r| {
            Ok(PlanItem {
                id: r.get(0)?,
                name: r.get(1)?,
                muscle_group: r.get(2)?,
                video_url: r.get(3)?,
                day_label: r.get(4)?,
                sets: r.get(5)?,
                reps: r.get(6)?,
                weight_kg: r.get(7)?,
                rest_sec: r.get(8)?,
                sort_order: r.get(9)?,
            })
        })
        .map_err(err)?;
    plan.items = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
    Ok(plan)
}

fn insert_items(
    tx: &rusqlite::Transaction<'_>,
    plan_id: i64,
    items: &[PlanItemInput],
) -> Result<(), String> {
    for item in items {
        tx.execute(
            "INSERT INTO plan_items
                (plan_id, name, muscle_group, video_url, day_label, sets, reps, weight_kg, rest_sec, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                plan_id,
                item.name,
                item.muscle_group,
                item.video_url,
                item.day_label,
                item.sets,
                item.reps,
                item.weight_kg,
                item.rest_sec,
                item.sort_order
            ],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_plan(db: State<Db>, input: PlanInput) -> Result<i64, String> {
    let mut conn = db.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO plans (name, goal, notes) VALUES (?1, ?2, ?3)",
        params![input.name, input.goal, input.notes],
    )
    .map_err(err)?;
    let plan_id = tx.last_insert_rowid();
    insert_items(&tx, plan_id, &input.items)?;
    tx.commit().map_err(err)?;
    Ok(plan_id)
}

#[tauri::command]
pub fn update_plan(db: State<Db>, id: i64, input: PlanInput) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "UPDATE plans SET name = ?1, goal = ?2, notes = ?3 WHERE id = ?4",
        params![input.name, input.goal, input.notes, id],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM plan_items WHERE plan_id = ?1", params![id])
        .map_err(err)?;
    insert_items(&tx, id, &input.items)?;
    tx.commit().map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_plan(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(err)?;
    conn.execute("DELETE FROM plans WHERE id = ?1", params![id])
        .map_err(err)?;
    Ok(())
}

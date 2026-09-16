mod commands;
mod db;
mod models;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            db::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_exercises,
            commands::create_exercise,
            commands::delete_exercise,
            commands::list_plans,
            commands::get_plan,
            commands::create_plan,
            commands::update_plan,
            commands::delete_plan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

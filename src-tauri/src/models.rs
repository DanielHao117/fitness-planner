use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PlanSummary {
    pub id: i64,
    pub name: String,
    pub goal: String,
    pub created_at: String,
    pub item_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlanItem {
    pub id: i64,
    pub name: String,
    pub muscle_group: String,
    pub video_url: Option<String>,
    pub day_label: String,
    pub sets: i64,
    pub reps: i64,
    pub weight_kg: f64,
    pub rest_sec: i64,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Plan {
    pub id: i64,
    pub name: String,
    pub goal: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub items: Vec<PlanItem>,
}

#[derive(Debug, Deserialize)]
pub struct PlanItemInput {
    pub name: String,
    #[serde(default)]
    pub muscle_group: String,
    pub video_url: Option<String>,
    #[serde(default = "default_day")]
    pub day_label: String,
    pub sets: i64,
    pub reps: i64,
    #[serde(default)]
    pub weight_kg: f64,
    #[serde(default = "default_rest")]
    pub rest_sec: i64,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct PlanInput {
    pub name: String,
    #[serde(default)]
    pub goal: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub items: Vec<PlanItemInput>,
}

fn default_day() -> String {
    "第 1 天".to_string()
}

fn default_rest() -> i64 {
    60
}

//! Read-only migration of the old isolated profile. No rbw dependency or
//! process-wide environment mutation is needed to locate these files.
use std::path::PathBuf;

fn dirs() -> directories::ProjectDirs {
    directories::ProjectDirs::from("", "", "rbw-keyward").expect("user directories available")
}
pub(crate) fn db_file(server: &str, email: &str) -> PathBuf {
    dirs().cache_dir().join(format!("{server}:{email}.json"))
}
pub(crate) fn device_id_file() -> PathBuf { dirs().data_dir().join("device_id") }

#[derive(serde::Deserialize)]
pub(crate) struct Config {
    pub base_url: Option<String>,
    pub email: Option<String>,
    pub identity_url: Option<String>,
}
pub(crate) fn config() -> Option<Config> {
    serde_json::from_slice(&std::fs::read(dirs().config_dir().join("config.json")).ok()?).ok()
}

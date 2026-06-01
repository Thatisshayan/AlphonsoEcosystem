use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use hmac::{Hmac, Mac};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Listener, Manager, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_updater::UpdaterExt;
mod native_proof;
mod runway;
use native_proof::{run_native_rc0_proof, start_native_rc0_proof_if_requested};
use runway::{runway_generate_video, runway_list_pending_jobs, runway_resume_task};

const MEMORY_SCHEMA_VERSION: u32 = 2;
const MEMORY_SCHEMA_INIT_MIGRATION_ID: &str = "memory_schema_init_v1";
const MEMORY_SCHEMA_V2_MIGRATION_ID: &str = "memory_schema_migration_v2";

#[derive(Serialize)]
struct CommandProof {
  program: String,
  args: Vec<String>,
  cwd: Option<String>,
  started_at_ms: u64,
  finished_at_ms: u64,
  success: bool,
  exit_code: Option<i32>,
  stdout: String,
  stderr: String,
  trust: String,
}

#[derive(Serialize, Clone)]
struct PathProof {
  path: String,
  exists: bool,
  is_file: bool,
  is_dir: bool,
  modified_at_ms: Option<u64>,
  trust: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEnvValueProof {
  name: String,
  present: bool,
  value: Option<String>,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct ProcessMatch {
  name: String,
  pid: Option<u32>,
}

#[derive(Serialize)]
struct ProcessProof {
  query: String,
  running: bool,
  matches: Vec<ProcessMatch>,
  trust: String,
}

#[derive(Serialize)]
struct OllamaRuntimeProof {
  endpoint: String,
  reachable: bool,
  http_status: Option<u16>,
  models: Vec<String>,
  reason: Option<String>,
  checked_at_ms: u64,
  trust: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModelInfo {
  name: String,
  size: Option<i64>,
  modified_at: Option<String>,
  digest: Option<String>,
  details: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModelsProof {
  endpoint: String,
  http_status: Option<u16>,
  models: Vec<OllamaModelInfo>,
  trust: String,
  reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaGenerateProof {
  endpoint: String,
  http_status: Option<u16>,
  model: String,
  response: String,
  done: bool,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct RestorePointProof {
  snapshot_id: String,
  file_path: String,
  written: bool,
  written_at_ms: u64,
  trust: String,
}

#[derive(Serialize)]
struct HandoffExportProof {
  file_path: String,
  written: bool,
  written_at_ms: u64,
  bytes: usize,
  trust: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProofStageProof {
  stage: String,
  status: String,
  timestamp: String,
  process_id: u32,
  workspace_root: String,
  output_dir: String,
  proof_request_found: bool,
  window_label: Option<String>,
  note: Option<String>,
  error: Option<String>,
  duration_ms: Option<u64>,
}

#[derive(Serialize)]
struct WorkspaceWriteProof {
  file_path: String,
  relative_path: String,
  written: bool,
  written_at_ms: u64,
  bytes: usize,
  trust: String,
}

#[derive(Serialize)]
struct AuditWriteProof {
  path: String,
  written_at_ms: u64,
  bytes: usize,
  prev_hash: Option<String>,
  chain_hash: String,
  trust: String,
}

#[derive(Serialize)]
struct AuditChainVerificationProof {
  path: String,
  total_entries: usize,
  verified_entries: usize,
  broken_index: Option<usize>,
  reason: Option<String>,
  checked_at_ms: u64,
  trust: String,
}

#[derive(Deserialize)]
struct PluginManifestDisk {
  id: String,
  name: Option<String>,
  version: Option<String>,
  permissions: Option<Vec<String>>,
  enabled_by_default: Option<bool>,
  manifest_version: Option<String>,
  tools: Option<Vec<PluginToolDisk>>,
}

#[derive(Deserialize, Clone)]
struct PluginToolDisk {
  id: String,
  program: String,
  args: Option<Vec<String>>,
  cwd: Option<String>,
  permissions: Option<Vec<String>>,
}

#[derive(Serialize, Clone)]
struct PluginToolDescriptor {
  id: String,
  program: String,
  args: Vec<String>,
  cwd: Option<String>,
  permissions: Vec<String>,
}

#[derive(Serialize)]
struct PluginManifestProof {
  id: String,
  name: String,
  version: String,
  permissions: Vec<String>,
  enabled_by_default: bool,
  manifest_version: String,
  manifest_path: String,
  tools: Vec<PluginToolDescriptor>,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct SymbolHit {
  symbol: String,
  count: u64,
}

#[derive(Serialize)]
struct WorkspaceProof {
  root: String,
  exists: bool,
  file_count: u64,
  dir_count: u64,
  total_bytes: u64,
  sampled_files: Vec<String>,
  symbol_hits: Vec<SymbolHit>,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct OcrCapabilityProof {
  available: bool,
  engine: String,
  message: String,
  checked_at_ms: u64,
  trust: String,
}

#[derive(Serialize)]
struct PluginToolExecutionProof {
  plugin_id: String,
  tool_id: String,
  manifest_path: String,
  program: String,
  args: Vec<String>,
  cwd: Option<String>,
  started_at_ms: u64,
  finished_at_ms: u64,
  success: bool,
  exit_code: Option<i32>,
  stdout: String,
  stderr: String,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct OcrAdapterProof {
  adapter: String,
  engine_path: String,
  image_path: Option<String>,
  started_at_ms: u64,
  finished_at_ms: u64,
  success: bool,
  exit_code: Option<i32>,
  stdout: String,
  stderr: String,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct FileSymbolSummary {
  path: String,
  language: String,
  bytes: u64,
  symbol_hits: Vec<SymbolHit>,
  dependencies: Vec<String>,
  trust: String,
}

#[derive(Serialize)]
struct WorkspaceSymbolIndex {
  root: String,
  generated_at_ms: u64,
  max_files: u64,
  files_indexed: u64,
  totals: Vec<SymbolHit>,
  dependency_edges: usize,
  files: Vec<FileSymbolSummary>,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceReadinessFinding {
  id: String,
  path: String,
  line_number: u64,
  surface: String,
  kind: String,
  priority: String,
  severity: String,
  message: String,
  excerpt: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceReadinessScan {
  root: String,
  generated_at_ms: u64,
  files_scanned: u64,
  findings: Vec<WorkspaceReadinessFinding>,
  placeholder_count: u64,
  todo_count: u64,
  setup_required_count: u64,
  blocked_count: u64,
  failed_count: u64,
  partial_count: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseArtifactProof {
  bundle_dir: String,
  manifest_dir: String,
  installer_path: Option<String>,
  installer_found: bool,
  signature_path: Option<String>,
  signature_found: bool,
  latest_json_path: Option<String>,
  latest_json_found: bool,
  manifest_valid: bool,
  manifest_version: Option<String>,
  manifest_url: Option<String>,
  manifest_signature: Option<String>,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct PluginManifestValidationProof {
  manifest_path: String,
  valid: bool,
  errors: Vec<String>,
  warnings: Vec<String>,
  trust: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MemoryRecord {
  id: String,
  title: String,
  content: Value,
  category: String,
  source_agent: String,
  source: String,
  timestamp_ms: u64,
  confidence: String,
  verification_state: String,
  project_reference: Option<String>,
  expires_at: Option<u64>,
  expiry_rule: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryListFilters {
  category: Option<String>,
  source_agent: Option<String>,
  confidence: Option<String>,
  project_reference: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryStoreStatus {
  available: bool,
  storage: String,
  path: String,
  schema_version: u32,
  record_count: u64,
  expired_count: u64,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryWriteProof {
  requested: usize,
  written: usize,
  storage: String,
  path: String,
  written_at_ms: u64,
  trust: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeLedgerRecord {
  id: String,
  data: Value,
  status: String,
  confidence: String,
  verification_state: String,
  timestamp_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchSourceInput {
  url: String,
  source_type: Option<String>,
  official: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchSourceProof {
  url: String,
  source_type: String,
  official: bool,
  fetched_at_ms: u64,
  http_status: Option<u16>,
  ok: bool,
  title: Option<String>,
  snippet: Option<String>,
  date_checked: String,
  confidence: String,
  risk_level: String,
  verification_state: String,
  error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResearchSearchInput {
  query: String,
  source_type: Option<String>,
  limit: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResearchSearchResult {
  url: String,
  title: String,
  snippet: Option<String>,
  source_type: String,
  provider: String,
  date_checked: String,
  confidence: String,
  risk_level: String,
  verification_state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateCheckProof {
  configured: bool,
  available: bool,
  current_version: String,
  latest_version: Option<String>,
  notes: Option<String>,
  pub_date: Option<String>,
  download_url: Option<String>,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JoseAssignmentProof {
  agent: String,
  title: String,
  rationale: String,
  action_type: String,
  risk_level: String,
  requires_approval: bool,
  command_preview: String,
  decomposition: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorInboundMessage {
  update_id: i64,
  chat_id: String,
  from_id: Option<String>,
  text: String,
  date_unix: Option<i64>,
  received_at_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorPollProof {
  connector_id: String,
  ok: bool,
  count: usize,
  cursor: Option<i64>,
  messages: Vec<ConnectorInboundMessage>,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhatsAppWebhookVerifyProof {
  ok: bool,
  mode: Option<String>,
  verify_token_present: bool,
  challenge: Option<String>,
  response_challenge: Option<String>,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhatsAppWebhookSignatureProof {
  ok: bool,
  signature_header_present: bool,
  app_secret_present: bool,
  expected_signature: Option<String>,
  received_signature: Option<String>,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WhatsAppCloudInboundNormalizeProof {
  ok: bool,
  provider: String,
  count: usize,
  messages: Vec<ConnectorInboundMessage>,
  checked_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorSendProof {
  connector_id: String,
  ok: bool,
  target: String,
  external_id: Option<String>,
  sent_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookPostProof {
  ok: bool,
  platform: String,
  connection_name: Option<String>,
  webhook_host: Option<String>,
  http_status: Option<u16>,
  response_preview: Option<String>,
  sent_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YouTubeUploadProof {
  connector_id: String,
  ok: bool,
  video_id: Option<String>,
  url: Option<String>,
  privacy_status: String,
  file_path: String,
  uploaded_at_ms: u64,
  trust: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetaPublishProof {
  connector_id: String,
  ok: bool,
  platform: String,
  published: bool,
  post_ids: Vec<String>,
  url: Option<String>,
  setup_required: bool,
  published_at_ms: u64,
  trust: String,
  message: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaGenerationProof {
  connector_id: String,
  ok: bool,
  provider: String,
  job_id: Option<String>,
  output_paths: Vec<String>,
  preview_base64: Option<String>,
  queued_at_ms: u64,
  trust: String,
  message: String,
  error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalRuntimeHealthProof {
  connector_id: String,
  provider: String,
  ok: bool,
  endpoint: String,
  probe_path: String,
  http_status: Option<u16>,
  checked_at_ms: u64,
  trust: String,
  message: String,
  error: Option<String>,
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

fn to_hex(bytes: &[u8]) -> String {
  let mut out = String::with_capacity(bytes.len() * 2);
  for byte in bytes {
    out.push_str(&format!("{:02x}", byte));
  }
  out
}

fn allowed_program(program: &str) -> bool {
  matches!(
    program.to_ascii_lowercase().as_str(),
    "ollama" | "where" | "where.exe" | "tasklist" | "git" | "node" | "npm" | "npm.cmd"
  )
}

fn load_dotenv_file(path: &Path) -> usize {
  let file = match fs::File::open(path) {
    Ok(f) => f,
    Err(_) => return 0,
  };
  let mut loaded = 0usize;
  for line in BufReader::new(file).lines().map_while(Result::ok) {
    let trimmed = line.trim().to_string();
    if trimmed.is_empty() || trimmed.starts_with('#') {
      continue;
    }
    if let Some((key, val)) = trimmed.split_once('=') {
      let k = key.trim();
      let v = val.trim().trim_matches('"').trim_matches('\'');
      if !k.is_empty() && std::env::var_os(k).is_none() {
        unsafe { std::env::set_var(k, v) };
        loaded += 1;
      }
    }
  }
  loaded
}

fn load_dotenv() {
  let exe_dir = std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    .unwrap_or_default();

  let candidates = [
    std::env::current_dir().unwrap_or_default().join(".env"),
    exe_dir.join(".env"),
    dirs_home().join(".alphonso").join(".env"),
  ];
  for path in &candidates {
    let n = load_dotenv_file(path);
    if n > 0 {
      eprintln!("[alphonso] loaded {} var(s) from {}", n, path.display());
      return;
    }
  }
}

fn dirs_home() -> PathBuf {
  std::env::var("USERPROFILE")
    .or_else(|_| std::env::var("HOME"))
    .map(PathBuf::from)
    .unwrap_or_else(|_| PathBuf::from("."))
}

fn native_proof_output_dir() -> PathBuf {
  std::env::var("ALPHONSO_PROOF_OUTPUT_DIR")
    .map(PathBuf::from)
    .unwrap_or_else(|_| PathBuf::from("release/rc0"))
}

fn native_workspace_root() -> String {
  std::env::var("ALPHONSO_WORKSPACE_ROOT")
    .or_else(|_| std::env::current_dir().map(|path| path.display().to_string()))
    .unwrap_or_else(|_| String::new())
}

fn read_native_proof_request(output_dir: &Path) -> Option<Value> {
  let path = output_dir.join("proof-request.json");
  let content = fs::read_to_string(path).ok()?;
  serde_json::from_str::<Value>(&content).ok()
}

fn write_native_proof_stage(
  output_dir: &Path,
  file_name: &str,
  payload: &NativeProofStageProof,
) -> Result<(), String> {
  let proof_dir = output_dir.join("proof");
  fs::create_dir_all(&proof_dir).map_err(|error| error.to_string())?;
  let file_path = proof_dir.join(file_name);
  let content = serde_json::to_string_pretty(payload).map_err(|error| error.to_string())?;
  fs::write(&file_path, format!("{content}\n")).map_err(|error| error.to_string())?;
  Ok(())
}

fn write_native_startup_trace(stage: &str, workspace_root: &str, note: Option<&str>) {
  let trace_path = std::env::temp_dir().join("alphonso-startup-trace.json");
  let payload = serde_json::json!({
    "timestamp": now_ms(),
    "stage": stage,
    "processId": std::process::id(),
    "workspaceRoot": workspace_root,
    "note": note,
  });
  if let Ok(content) = serde_json::to_string_pretty(&payload) {
    let _ = fs::write(trace_path, format!("{content}\n"));
  }
}

fn write_native_proof_event(output_dir: &Path, payload: &Value) -> Result<(), String> {
  let proof_dir = output_dir.join("proof");
  fs::create_dir_all(&proof_dir).map_err(|error| error.to_string())?;

  let file_name = if let Some(file_name) = payload.get("fileName").and_then(Value::as_str) {
    file_name.to_string()
  } else if let Some(stage) = payload.get("stage").and_then(Value::as_str) {
    if stage.ends_with(".json") {
      stage.to_string()
    } else {
      format!("{stage}.json")
    }
  } else {
    "native-proof-event.json".to_string()
  };

  let file_path = proof_dir.join(file_name);
  let content = serde_json::to_string_pretty(payload).map_err(|error| error.to_string())?;
  fs::write(&file_path, format!("{content}\n")).map_err(|error| error.to_string())?;
  Ok(())
}

fn plugin_blocked_token_present(value: &str) -> Option<&'static str> {
  const BLOCKED: [&str; 8] = ["&&", "||", ";", "|", ">", "<", "$(", "`"];
  for token in BLOCKED {
    if value.contains(token) {
      return Some(token);
    }
  }
  None
}

fn validate_plugin_extra_args(extra_args: &[String]) -> Result<(), String> {
  const MAX_EXTRA_ARGS: usize = 8;
  const MAX_ARG_LEN: usize = 120;

  if extra_args.len() > MAX_EXTRA_ARGS {
    return Err(format!(
      "Plugin extra args exceed supervised limit ({MAX_EXTRA_ARGS})."
    ));
  }

  for arg in extra_args {
    if arg.len() > MAX_ARG_LEN {
      return Err(format!(
        "Plugin arg exceeds supervised length limit ({MAX_ARG_LEN})."
      ));
    }
    if let Some(token) = plugin_blocked_token_present(arg) {
      return Err(format!(
        "Plugin arg contains blocked token under supervised policy: {token}"
      ));
    }
  }

  Ok(())
}

fn append_plugin_audit_event(
  app: &tauri::AppHandle,
  event_type: &str,
  entry: Value,
) -> Result<(), String> {
  append_audit_log(app.clone(), event_type.to_string(), entry).map(|_| ())
}

fn app_data_subdir(app: &tauri::AppHandle, subdir: &str) -> Result<PathBuf, String> {
  let mut dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  dir.push(subdir);
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir)
}

fn connector_cursor_path(app: &tauri::AppHandle, connector_id: &str) -> Result<PathBuf, String> {
  let mut dir = app_data_subdir(app, "connectors")?;
  dir.push(format!("{connector_id}_cursor.json"));
  Ok(dir)
}

fn read_connector_cursor(app: &tauri::AppHandle, connector_id: &str) -> Option<i64> {
  let path = connector_cursor_path(app, connector_id).ok()?;
  let raw = fs::read_to_string(path).ok()?;
  let parsed: Value = serde_json::from_str(&raw).ok()?;
  parsed.get("cursor").and_then(|value| value.as_i64())
}

fn write_connector_cursor(app: &tauri::AppHandle, connector_id: &str, cursor: i64) -> Result<(), String> {
  let path = connector_cursor_path(app, connector_id)?;
  let payload = serde_json::json!({
    "connectorId": connector_id,
    "cursor": cursor,
    "updatedAtMs": now_ms()
  });
  fs::write(path, payload.to_string()).map_err(|error| error.to_string())
}

fn memory_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut dir = app_data_subdir(app, "memory")?;
  dir.push("alphonso_memory.sqlite3");
  Ok(dir)
}

fn read_memory_schema_version(conn: &Connection) -> u32 {
  conn
    .query_row(
      "SELECT CAST(value AS INTEGER) FROM memory_meta WHERE key = 'schema_version' LIMIT 1",
      [],
      |row| row.get::<_, i64>(0),
    )
    .map(|value| value.max(0) as u32)
    .unwrap_or(0)
}

fn initialize_memory_schema(conn: &Connection) -> Result<u32, String> {
  let schema_version = MEMORY_SCHEMA_VERSION;
  conn
    .execute_batch(
      "
      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content_json TEXT NOT NULL,
        category TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        confidence TEXT NOT NULL,
        verification_state TEXT NOT NULL,
        project_reference TEXT,
        expires_at INTEGER,
        expiry_rule TEXT,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_records(category);
      CREATE INDEX IF NOT EXISTS idx_memory_source_agent ON memory_records(source_agent);
      CREATE INDEX IF NOT EXISTS idx_memory_confidence ON memory_records(confidence);
      CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON memory_records(timestamp_ms);
      CREATE TABLE IF NOT EXISTS memory_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_schema_migrations (
        migration_id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at_ms INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        status TEXT NOT NULL,
        trust TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_schema_migrations_applied_at ON memory_schema_migrations(applied_at_ms DESC);
      CREATE TABLE IF NOT EXISTS runtime_ledger (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence TEXT NOT NULL,
        verification_state TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(scope, id)
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_ledger_scope_time ON runtime_ledger(scope, timestamp_ms DESC);
      ",
    )
    .map_err(|error| error.to_string())?;

  let init_migration = serde_json::json!({
    "migrationId": MEMORY_SCHEMA_INIT_MIGRATION_ID,
    "description": "Initialize local memory tables and runtime ledger.",
    "schemaVersion": 1,
    "status": "applied",
    "trust": "verified"
  });
  let v2_migration = serde_json::json!({
    "migrationId": MEMORY_SCHEMA_V2_MIGRATION_ID,
    "description": "Add explicit migration registry and bump local memory schema version.",
    "schemaVersion": schema_version,
    "status": "applied",
    "trust": "verified"
  });
  let applied_at_ms = now_ms() as i64;
  conn
    .execute(
      "
      INSERT OR IGNORE INTO memory_schema_migrations (
        migration_id, description, applied_at_ms, checksum, status, trust, details_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ",
      params![
        MEMORY_SCHEMA_INIT_MIGRATION_ID,
        "Initialize local memory tables and runtime ledger.",
        applied_at_ms,
        format!("memory-schema-init-{}", 1),
        "applied",
        "verified",
        init_migration.to_string()
      ],
    )
    .map_err(|error| error.to_string())?;
  conn
    .execute(
      "
      INSERT OR IGNORE INTO memory_schema_migrations (
        migration_id, description, applied_at_ms, checksum, status, trust, details_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ",
      params![
        MEMORY_SCHEMA_V2_MIGRATION_ID,
        "Add explicit migration registry and bump local memory schema version.",
        applied_at_ms,
        format!("memory-schema-v2-{}", schema_version),
        "applied",
        "verified",
        v2_migration.to_string()
      ],
    )
    .map_err(|error| error.to_string())?;
  conn
    .execute(
      "INSERT OR REPLACE INTO memory_meta(key, value) VALUES ('schema_version', ?1)",
      params![schema_version.to_string()],
    )
    .map_err(|error| error.to_string())?;

  Ok(read_memory_schema_version(conn))
}

fn open_memory_db(app: &tauri::AppHandle) -> Result<(Connection, PathBuf), String> {
  let path = memory_db_path(app)?;
  let conn = Connection::open(&path).map_err(|error| error.to_string())?;
  // WAL mode: allows concurrent reads during writes, prevents UI freeze on memory writes.
  // PRAGMA synchronous=NORMAL is safe with WAL and gives a solid durability/performance balance.
  conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
    .map_err(|error| format!("WAL pragma failed: {}", error))?;
  initialize_memory_schema(&conn)?;
  Ok((conn, path))
}

fn ensure_kv_table(conn: &Connection) -> Result<(), String> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS kv_store (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL,
       updated_at INTEGER NOT NULL DEFAULT 0
     );"
  ).map_err(|e| e.to_string())
}

#[tauri::command]
fn kv_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
  let (conn, _) = open_memory_db(&app)?;
  ensure_kv_table(&conn)?;
  let now = now_ms() as i64;
  conn.execute(
    "INSERT INTO kv_store (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params![key, value, now],
  ).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn kv_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
  let (conn, _) = open_memory_db(&app)?;
  ensure_kv_table(&conn)?;
  match conn.query_row("SELECT value FROM kv_store WHERE key = ?1 LIMIT 1", params![key], |row| row.get::<_, String>(0)) {
    Ok(v) => Ok(Some(v)),
    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings_json: String) -> Result<(), String> {
  let (conn, _) = open_memory_db(&app)?;
  ensure_kv_table(&conn)?;
  let now = now_ms() as i64;
  conn.execute(
    "INSERT INTO kv_store (key, value, updated_at) VALUES ('app_settings', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params![settings_json, now],
  ).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let (conn, _) = open_memory_db(&app)?;
  ensure_kv_table(&conn)?;
  let result = conn.query_row(
    "SELECT value FROM kv_store WHERE key = 'app_settings' LIMIT 1",
    [],
    |row| row.get::<_, String>(0),
  );
  match result {
    Ok(v) => Ok(Some(v)),
    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

fn unix_now_iso() -> String {
  let seconds = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs())
    .unwrap_or(0);
  format!("unix:{}", seconds)
}

fn clean_ws(input: &str) -> String {
  input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_title(html: &str) -> Option<String> {
  let lower = html.to_ascii_lowercase();
  let start = lower.find("<title")?;
  let start_close = lower[start..].find('>')? + start + 1;
  let end = lower[start_close..].find("</title>")? + start_close;
  let title = clean_ws(&html[start_close..end]);
  if title.is_empty() { None } else { Some(title.chars().take(180).collect()) }
}

fn strip_html_tags(input: &str) -> String {
  let mut output = String::new();
  let mut in_tag = false;
  for ch in input.chars() {
    match ch {
      '<' => {
        in_tag = true;
        output.push(' ');
      }
      '>' => {
        in_tag = false;
        output.push(' ');
      }
      _ if !in_tag => output.push(ch),
      _ => {}
    }
  }
  clean_ws(&output)
}

fn decode_html_entities(input: &str) -> String {
  input
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&#x2F;", "/")
    .replace("&nbsp;", " ")
}

fn extract_attr(tag_html: &str, attr_name: &str) -> Option<String> {
  let needle = format!("{attr_name}=");
  let start = tag_html.find(&needle)? + needle.len();
  let rest = &tag_html[start..];
  let quote = rest.chars().next()?;
  if quote != '"' && quote != '\'' {
    return None;
  }
  let value_start = start + quote.len_utf8();
  let value_rest = &tag_html[value_start..];
  let value_end = value_rest.find(quote)?;
  Some(tag_html[value_start..value_start + value_end].to_string())
}

fn decode_ddg_result_url(raw_href: &str) -> Option<String> {
  let clean = decode_html_entities(raw_href.trim());
  if let Ok(parsed) = reqwest::Url::parse(&clean) {
    if parsed.scheme() == "http" || parsed.scheme() == "https" {
      if let Some(uddg) = parsed
        .query_pairs()
        .find(|(key, _)| key == "uddg")
        .map(|(_, value)| value.to_string())
      {
        if let Ok(decoded) = reqwest::Url::parse(&uddg) {
          if decoded.scheme() == "http" || decoded.scheme() == "https" {
            return Some(decoded.to_string());
          }
        }
      }
      return Some(parsed.to_string());
    }
  }

  let prefixed = if clean.starts_with("//") {
    format!("https:{clean}")
  } else if clean.starts_with('/') {
    format!("https://duckduckgo.com{clean}")
  } else {
    clean
  };

  if let Ok(parsed) = reqwest::Url::parse(&prefixed) {
    if let Some(uddg) = parsed
      .query_pairs()
      .find(|(key, _)| key == "uddg")
      .map(|(_, value)| value.to_string())
    {
      if let Ok(decoded) = reqwest::Url::parse(&uddg) {
        if decoded.scheme() == "http" || decoded.scheme() == "https" {
          return Some(decoded.to_string());
        }
      }
    }
    if parsed.scheme() == "http" || parsed.scheme() == "https" {
      return Some(parsed.to_string());
    }
  }
  None
}

fn json_value_to_plain_string(value: &Value) -> String {
  if let Some(text) = value.as_str() {
    return text.to_string();
  }
  if let Some(number) = value.as_i64() {
    return number.to_string();
  }
  if let Some(number) = value.as_u64() {
    return number.to_string();
  }
  value.to_string()
}

fn mime_for_video_path(path: &PathBuf) -> String {
  let extension = path
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.to_ascii_lowercase())
    .unwrap_or_default();
  match extension.as_str() {
    "mp4" => "video/mp4",
    "mov" => "video/quicktime",
    "mkv" => "video/x-matroska",
    "avi" => "video/x-msvideo",
    "webm" => "video/webm",
    "mpeg" | "mpg" => "video/mpeg",
    _ => "application/octet-stream",
  }
  .to_string()
}

#[allow(dead_code)]
fn mime_for_image_path(path: &PathBuf) -> String {
  let extension = path
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.to_ascii_lowercase())
    .unwrap_or_default();
  match extension.as_str() {
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "webp" => "image/webp",
    "bmp" => "image/bmp",
    "tif" | "tiff" => "image/tiff",
    _ => "application/octet-stream",
  }
  .to_string()
}

#[allow(dead_code)]
fn looks_like_video_path(path: &PathBuf) -> bool {
  matches!(
    path.extension()
      .and_then(|value| value.to_str())
      .map(|value| value.to_ascii_lowercase())
      .as_deref(),
    Some("mp4" | "mov" | "mkv" | "avi" | "webm" | "mpeg" | "mpg" | "m4v")
  )
}

#[allow(dead_code)]
fn looks_like_image_path(path: &PathBuf) -> bool {
  matches!(
    path.extension()
      .and_then(|value| value.to_str())
      .map(|value| value.to_ascii_lowercase())
      .as_deref(),
    Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff")
  )
}

fn meta_graph_api_version() -> String {
  std::env::var("META_GRAPH_API_VERSION")
    .map(|value| {
      let clean = value.trim();
      if clean.is_empty() {
        "v20.0".to_string()
      } else {
        clean.trim_start_matches('/').to_string()
      }
    })
    .unwrap_or_else(|_| "v20.0".to_string())
}

fn meta_appsecret_proof(access_token: &str) -> Option<String> {
  let app_secret = std::env::var("META_APP_SECRET").unwrap_or_default();
  let secret = app_secret.trim();
  if secret.is_empty() {
    return None;
  }
  let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
  mac.update(access_token.as_bytes());
  let bytes = mac.finalize().into_bytes();
  let mut out = String::with_capacity(bytes.len() * 2);
  for byte in bytes {
    use std::fmt::Write as _;
    let _ = write!(&mut out, "{:02x}", byte);
  }
  Some(out)
}

fn graph_error_message(body: &Value, fallback: &str) -> String {
  body
    .get("error")
    .and_then(|value| value.get("message"))
    .and_then(|value| value.as_str())
    .unwrap_or(fallback)
    .to_string()
}

async fn youtube_access_token() -> Result<String, String> {
  let client_id = std::env::var("YOUTUBE_CLIENT_ID").unwrap_or_default();
  let client_secret = std::env::var("YOUTUBE_CLIENT_SECRET").unwrap_or_default();
  let refresh_token = std::env::var("YOUTUBE_REFRESH_TOKEN").unwrap_or_default();
  if client_id.trim().is_empty() || client_secret.trim().is_empty() || refresh_token.trim().is_empty() {
    return Err("YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, or YOUTUBE_REFRESH_TOKEN is missing.".to_string());
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("Alphonso-YouTube-Connector/0.1")
    .build()
    .map_err(|error| error.to_string())?;
  let response = client
    .post("https://oauth2.googleapis.com/token")
    .form(&[
      ("client_id", client_id.trim()),
      ("client_secret", client_secret.trim()),
      ("refresh_token", refresh_token.trim()),
      ("grant_type", "refresh_token"),
    ])
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let payload: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_text = payload
      .get("error_description")
      .and_then(|value| value.as_str())
      .or_else(|| payload.get("error").and_then(|value| value.as_str()))
      .unwrap_or("OAuth token refresh failed.");
    return Err(error_text.to_string());
  }
  let token = payload
    .get("access_token")
    .and_then(|value| value.as_str())
    .unwrap_or("")
    .trim()
    .to_string();
  if token.is_empty() {
    return Err("OAuth token refresh succeeded but access_token was missing.".to_string());
  }
  Ok(token)
}

fn parse_ddg_results(html: &str, source_type: &str, limit: usize) -> Vec<ResearchSearchResult> {
  let mut results: Vec<ResearchSearchResult> = vec![];
  let mut cursor = 0usize;
  let max_results = limit.max(1).min(12);
  let lower = html.to_ascii_lowercase();

  while cursor < lower.len() && results.len() < max_results {
    let Some(anchor_rel) = lower[cursor..].find("result__a") else {
      break;
    };
    let anchor_hint = cursor + anchor_rel;
    let Some(tag_start_rel) = lower[..anchor_hint].rfind("<a") else {
      cursor = anchor_hint + "result__a".len();
      continue;
    };
    let Some(tag_end_rel) = lower[anchor_hint..].find("</a>") else {
      break;
    };
    let tag_end = anchor_hint + tag_end_rel + "</a>".len();
    let anchor_html = &html[tag_start_rel..tag_end];

    let href_raw = match extract_attr(anchor_html, "href") {
      Some(href) => href,
      None => {
        cursor = tag_end;
        continue;
      }
    };
    let Some(url) = decode_ddg_result_url(&href_raw) else {
      cursor = tag_end;
      continue;
    };

    if results.iter().any(|item| item.url == url) {
      cursor = tag_end;
      continue;
    }

    let title_raw = strip_html_tags(anchor_html);
    let title = decode_html_entities(&title_raw);

    let search_window_end = (tag_end + 3000).min(html.len());
    let window_lower = &lower[tag_end..search_window_end];
    let snippet = window_lower
      .find("result__snippet")
      .and_then(|snippet_rel| {
        let snippet_hint = tag_end + snippet_rel;
        let snippet_start = lower[..snippet_hint].rfind('<')?;
        let snippet_tail = &lower[snippet_hint..search_window_end];
        let close_rel = snippet_tail.find("</a>").or_else(|| snippet_tail.find("</div>"))?;
        let snippet_end = snippet_hint + close_rel + 4;
        let snippet_html = &html[snippet_start..snippet_end];
        let plain = decode_html_entities(&strip_html_tags(snippet_html));
        if plain.is_empty() {
          None
        } else {
          Some(plain.chars().take(320).collect::<String>())
        }
      });

    results.push(ResearchSearchResult {
      url,
      title: if title.is_empty() { "Untitled result".to_string() } else { title.chars().take(180).collect() },
      snippet,
      source_type: source_type.to_string(),
      provider: "duckduckgo_html".to_string(),
      date_checked: unix_now_iso(),
      confidence: "inferred".to_string(),
      risk_level: "medium".to_string(),
      verification_state: "inferred".to_string(),
    });
    cursor = tag_end;
  }

  results
}

fn row_to_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRecord> {
  let content_json: String = row.get(2)?;
  let content = serde_json::from_str(&content_json).unwrap_or(Value::String(content_json));
  let timestamp_ms: i64 = row.get(6)?;
  let expires_at: Option<i64> = row.get(10)?;
  Ok(MemoryRecord {
    id: row.get(0)?,
    title: row.get(1)?,
    content,
    category: row.get(3)?,
    source_agent: row.get(4)?,
    source: row.get(5)?,
    timestamp_ms: timestamp_ms.max(0) as u64,
    confidence: row.get(7)?,
    verification_state: row.get(8)?,
    project_reference: row.get(9)?,
    expires_at: expires_at.map(|value| value.max(0) as u64),
    expiry_rule: row.get(11)?,
  })
}

fn row_to_runtime_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeLedgerRecord> {
  let data_json: String = row.get(1)?;
  let data = serde_json::from_str(&data_json).unwrap_or(Value::String(data_json));
  let timestamp_ms: i64 = row.get(5)?;
  Ok(RuntimeLedgerRecord {
    id: row.get(0)?,
    data,
    status: row.get(2)?,
    confidence: row.get(3)?,
    verification_state: row.get(4)?,
    timestamp_ms: timestamp_ms.max(0) as u64,
  })
}

fn symbol_counts_for_text(content: &str) -> [u64; 7] {
  let mut counts = [0_u64; 7];
  for line in content.lines() {
    let trimmed = line.trim_start();
    if trimmed.starts_with("fn ") {
      counts[0] += 1;
    }
    if trimmed.starts_with("function ") || trimmed.contains(" function ") {
      counts[1] += 1;
    }
    if trimmed.starts_with("class ") {
      counts[2] += 1;
    }
    if trimmed.starts_with("const ") || trimmed.starts_with("let ") {
      counts[3] += 1;
    }
    if trimmed.starts_with("async fn ") || trimmed.starts_with("async function ") {
      counts[4] += 1;
    }
    if trimmed.starts_with("import ") || trimmed.starts_with("use ") {
      counts[5] += 1;
    }
    if trimmed.starts_with("export ") || trimmed.starts_with("pub ") {
      counts[6] += 1;
    }
  }
  counts
}

fn language_for_extension(extension: &str) -> String {
  match extension {
    "rs" => "rust",
    "js" => "javascript",
    "jsx" => "react-jsx",
    "ts" => "typescript",
    "tsx" => "react-tsx",
    "py" => "python",
    _ => "unknown",
  }.to_string()
}

fn symbol_hits_from_counts(counts: [u64; 7]) -> Vec<SymbolHit> {
  vec![
    SymbolHit { symbol: "rust_fn".to_string(), count: counts[0] },
    SymbolHit { symbol: "js_function".to_string(), count: counts[1] },
    SymbolHit { symbol: "class".to_string(), count: counts[2] },
    SymbolHit { symbol: "const_or_let".to_string(), count: counts[3] },
    SymbolHit { symbol: "async_decl".to_string(), count: counts[4] },
    SymbolHit { symbol: "import_or_use".to_string(), count: counts[5] },
    SymbolHit { symbol: "export_or_pub".to_string(), count: counts[6] },
  ]
}

#[tauri::command]
fn check_env_vars_presence(names: Vec<String>) -> HashMap<String, bool> {
  let mut result = HashMap::new();
  for name in names.into_iter().take(80) {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
      continue;
    }
    let present = std::env::var_os(&trimmed)
      .map(|value| !value.is_empty())
      .unwrap_or(false);
    result.insert(trimmed, present);
  }
  result
}

fn is_allowed_webhook_url(webhook_url: &str) -> bool {
  let normalized = webhook_url.trim().to_ascii_lowercase();
  normalized.starts_with("https://")
    || normalized.starts_with("http://localhost")
    || normalized.starts_with("http://127.0.0.1")
    || normalized.starts_with("http://[::1]")
}

fn webhook_host_from_url(webhook_url: &str) -> Option<String> {
  let trimmed = webhook_url.trim();
  let after_scheme = trimmed.split_once("://")?.1;
  let host = after_scheme.split('/').next()?.trim();
  if host.is_empty() {
    None
  } else {
    Some(host.to_string())
  }
}

#[tauri::command]
async fn connector_poll_telegram(
  http_client: tauri::State<'_, reqwest::Client>,
  app: tauri::AppHandle,
  limit: Option<u8>,
) -> Result<ConnectorPollProof, String> {
  let checked_at_ms = now_ms();
  let token = std::env::var("TELEGRAM_BOT_TOKEN")
    .map(|value| value.trim().to_string())
    .unwrap_or_default();
  if token.is_empty() {
    return Ok(ConnectorPollProof {
      connector_id: "telegram".to_string(),
      ok: false,
      count: 0,
      cursor: read_connector_cursor(&app, "telegram"),
      messages: vec![],
      checked_at_ms,
      trust: "unverified".to_string(),
      error: Some("TELEGRAM_BOT_TOKEN is not configured.".to_string()),
    });
  }

  let current_cursor = read_connector_cursor(&app, "telegram");
  let max_limit = limit.unwrap_or(10).clamp(1, 50);
  let client = http_client.inner();
  let endpoint = format!("https://api.telegram.org/bot{}/getUpdates", token);

  let mut query: Vec<(String, String)> = vec![
    ("limit".to_string(), max_limit.to_string()),
    ("timeout".to_string(), "0".to_string()),
    ("allowed_updates".to_string(), "[\"message\"]".to_string()),
  ];
  if let Some(cursor) = current_cursor {
    query.push(("offset".to_string(), (cursor + 1).to_string()));
  }

  let response = client
    .get(endpoint)
    .query(&query)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let payload: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    return Ok(ConnectorPollProof {
      connector_id: "telegram".to_string(),
      ok: false,
      count: 0,
      cursor: current_cursor,
      messages: vec![],
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some(format!("Telegram getUpdates returned HTTP {}", status.as_u16())),
    });
  }
  if !payload.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
    let description = payload
      .get("description")
      .and_then(|value| value.as_str())
      .unwrap_or("Telegram API returned ok=false.");
    return Ok(ConnectorPollProof {
      connector_id: "telegram".to_string(),
      ok: false,
      count: 0,
      cursor: current_cursor,
      messages: vec![],
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some(description.to_string()),
    });
  }

  let mut next_cursor = current_cursor;
  let mut messages: Vec<ConnectorInboundMessage> = vec![];
  if let Some(rows) = payload.get("result").and_then(|value| value.as_array()) {
    for row in rows {
      let update_id = row.get("update_id").and_then(|value| value.as_i64()).unwrap_or(0);
      if update_id > 0 {
        next_cursor = Some(next_cursor.map(|cursor| cursor.max(update_id)).unwrap_or(update_id));
      }
      let message = row.get("message").or_else(|| row.get("edited_message"));
      let Some(message_value) = message else { continue };

      let chat_id = message_value
        .get("chat")
        .and_then(|chat| chat.get("id"))
        .map(json_value_to_plain_string)
        .unwrap_or_else(|| "unknown".to_string());
      let from_id = message_value
        .get("from")
        .and_then(|from| from.get("id"))
        .map(json_value_to_plain_string);
      let text = message_value
        .get("text")
        .and_then(|value| value.as_str())
        .or_else(|| message_value.get("caption").and_then(|value| value.as_str()))
        .unwrap_or("")
        .trim()
        .to_string();
      if text.is_empty() {
        continue;
      }
      let date_unix = message_value.get("date").and_then(|value| value.as_i64());
      messages.push(ConnectorInboundMessage {
        update_id,
        chat_id,
        from_id,
        text,
        date_unix,
        received_at_ms: checked_at_ms,
      });
    }
  }

  if let Some(cursor) = next_cursor {
    let _ = write_connector_cursor(&app, "telegram", cursor);
  }

  Ok(ConnectorPollProof {
    connector_id: "telegram".to_string(),
    ok: true,
    count: messages.len(),
    cursor: next_cursor,
    messages,
    checked_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn connector_send_telegram(
  http_client: tauri::State<'_, reqwest::Client>,
  chat_id: String,
  text: String,
) -> Result<ConnectorSendProof, String> {
  let sent_at_ms = now_ms();
  let token = std::env::var("TELEGRAM_BOT_TOKEN")
    .map(|value| value.trim().to_string())
    .unwrap_or_default();
  if token.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "telegram".to_string(),
      ok: false,
      target: chat_id,
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("TELEGRAM_BOT_TOKEN is not configured.".to_string()),
    });
  }

  let clean_target = chat_id.trim().to_string();
  let clean_text = text.trim().to_string();
  if clean_target.is_empty() || clean_text.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "telegram".to_string(),
      ok: false,
      target: clean_target,
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("chat_id and text are required.".to_string()),
    });
  }

  let client = http_client.inner();
  let endpoint = format!("https://api.telegram.org/bot{}/sendMessage", token);
  let payload = serde_json::json!({
    "chat_id": clean_target,
    "text": clean_text,
    "disable_web_page_preview": true
  });

  let response = client
    .post(endpoint)
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() || !body.get("ok").and_then(|value| value.as_bool()).unwrap_or(false) {
    let description = body
      .get("description")
      .and_then(|value| value.as_str())
      .unwrap_or("Telegram sendMessage failed.");
    return Ok(ConnectorSendProof {
      connector_id: "telegram".to_string(),
      ok: false,
      target: payload.get("chat_id").map(json_value_to_plain_string).unwrap_or_default(),
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some(description.to_string()),
    });
  }

  let external_id = body
    .get("result")
    .and_then(|result| result.get("message_id"))
    .map(json_value_to_plain_string);

  Ok(ConnectorSendProof {
    connector_id: "telegram".to_string(),
    ok: true,
    target: payload.get("chat_id").map(json_value_to_plain_string).unwrap_or_default(),
    external_id,
    sent_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn connector_send_whatsapp(to: String, text: String) -> Result<ConnectorSendProof, String> {
  let sent_at_ms = now_ms();
  let provider = std::env::var("WHATSAPP_PROVIDER")
    .map(|value| value.trim().to_ascii_lowercase())
    .unwrap_or_else(|_| "cloud_api".to_string());
  let clean_to = to.trim().to_string();
  let clean_text = text.trim().to_string();
  if clean_to.is_empty() || clean_text.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "whatsapp".to_string(),
      ok: false,
      target: clean_to,
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("target and text are required.".to_string()),
    });
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("Alphonso-WhatsApp-Bridge/0.1")
    .build()
    .map_err(|error| error.to_string())?;

  if provider == "twilio" {
    let account_sid = std::env::var("WHATSAPP_TWILIO_ACCOUNT_SID").unwrap_or_default();
    let auth_token = std::env::var("WHATSAPP_TWILIO_AUTH_TOKEN").unwrap_or_default();
    let from_number = std::env::var("WHATSAPP_TWILIO_FROM").unwrap_or_default();
    if account_sid.trim().is_empty() || auth_token.trim().is_empty() || from_number.trim().is_empty() {
      return Ok(ConnectorSendProof {
        connector_id: "whatsapp".to_string(),
        ok: false,
        target: clean_to,
        external_id: None,
        sent_at_ms,
        trust: "unverified".to_string(),
        error: Some("Twilio provider is selected, but WHATSAPP_TWILIO_ACCOUNT_SID, WHATSAPP_TWILIO_AUTH_TOKEN, or WHATSAPP_TWILIO_FROM is missing.".to_string()),
      });
    }

    let endpoint = format!("https://api.twilio.com/2010-04-01/Accounts/{}/Messages.json", account_sid.trim());
    let formatted_to = if clean_to.starts_with("whatsapp:") { clean_to.clone() } else { format!("whatsapp:{clean_to}") };
    let formatted_from = if from_number.trim().starts_with("whatsapp:") {
      from_number.trim().to_string()
    } else {
      format!("whatsapp:{}", from_number.trim())
    };
    let form = [
      ("To", formatted_to.clone()),
      ("From", formatted_from),
      ("Body", clean_text.clone()),
    ];

    let response = client
      .post(endpoint)
      .basic_auth(account_sid.trim(), Some(auth_token.trim()))
      .form(&form)
      .send()
      .await
      .map_err(|error| error.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
      let error_message = body
        .get("message")
        .and_then(|value| value.as_str())
        .unwrap_or("Twilio WhatsApp send failed.");
      return Ok(ConnectorSendProof {
        connector_id: "whatsapp".to_string(),
        ok: false,
        target: formatted_to,
        external_id: None,
        sent_at_ms,
        trust: "failed".to_string(),
        error: Some(error_message.to_string()),
      });
    }
    let external_id = body.get("sid").and_then(|value| value.as_str()).map(|value| value.to_string());
    return Ok(ConnectorSendProof {
      connector_id: "whatsapp".to_string(),
      ok: true,
      target: formatted_to,
      external_id,
      sent_at_ms,
      trust: "verified".to_string(),
      error: None,
    });
  }

  let access_token = std::env::var("WHATSAPP_ACCESS_TOKEN").unwrap_or_default();
  let phone_number_id = std::env::var("WHATSAPP_PHONE_NUMBER_ID").unwrap_or_default();
  if access_token.trim().is_empty() || phone_number_id.trim().is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "whatsapp".to_string(),
      ok: false,
      target: clean_to,
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("Cloud API provider is selected, but WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing.".to_string()),
    });
  }

  let endpoint = format!(
    "https://graph.facebook.com/v20.0/{}/messages",
    phone_number_id.trim()
  );
  let payload = serde_json::json!({
    "messaging_product": "whatsapp",
    "to": clean_to,
    "type": "text",
    "text": { "body": clean_text, "preview_url": false }
  });

  let response = client
    .post(endpoint)
    .bearer_auth(access_token.trim())
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_message = body
      .get("error")
      .and_then(|value| value.get("message"))
      .and_then(|value| value.as_str())
      .unwrap_or("WhatsApp Cloud API send failed.");
    return Ok(ConnectorSendProof {
      connector_id: "whatsapp".to_string(),
      ok: false,
      target: payload.get("to").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some(error_message.to_string()),
    });
  }
  let external_id = body
    .get("messages")
    .and_then(|value| value.as_array())
    .and_then(|rows| rows.first())
    .and_then(|first| first.get("id"))
    .and_then(|value| value.as_str())
    .map(|value| value.to_string());
  Ok(ConnectorSendProof {
    connector_id: "whatsapp".to_string(),
    ok: true,
    target: payload.get("to").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
    external_id,
    sent_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn connector_send_notion(title: String, content: String, parent_page_id: Option<String>) -> Result<ConnectorSendProof, String> {
  let sent_at_ms = now_ms();
  let token = std::env::var("NOTION_API_KEY").unwrap_or_default();
  if token.trim().is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "notion".to_string(),
      ok: false,
      target: "notion".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("NOTION_API_KEY is not configured.".to_string()),
    });
  }

  let clean_title = title.trim().to_string();
  let clean_content = content.trim().to_string();
  if clean_title.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "notion".to_string(),
      ok: false,
      target: "notion".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("title is required.".to_string()),
    });
  }

  let env_parent = std::env::var("NOTION_PARENT_PAGE_ID").unwrap_or_default();
  let target_parent = parent_page_id
    .unwrap_or_default()
    .trim()
    .to_string();
  let parent = if !target_parent.is_empty() {
    target_parent
  } else {
    env_parent.trim().to_string()
  };
  if parent.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "notion".to_string(),
      ok: false,
      target: "notion".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("NOTION_PARENT_PAGE_ID is missing and no parent_page_id override was provided.".to_string()),
    });
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("Alphonso-Notion-Bridge/0.1")
    .build()
    .map_err(|error| error.to_string())?;

  let payload = serde_json::json!({
    "parent": { "page_id": parent },
    "properties": {
      "title": {
        "title": [
          {
            "type": "text",
            "text": { "content": clean_title }
          }
        ]
      }
    },
    "children": [
      {
        "object": "block",
        "type": "paragraph",
        "paragraph": {
          "rich_text": [
            {
              "type": "text",
              "text": { "content": if clean_content.is_empty() { "Created by Alphonso connector." } else { &clean_content } }
            }
          ]
        }
      }
    ]
  });

  let response = client
    .post("https://api.notion.com/v1/pages")
    .bearer_auth(token.trim())
    .header("Notion-Version", "2022-06-28")
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_message = body
      .get("message")
      .and_then(|value| value.as_str())
      .or_else(|| body.get("error").and_then(|value| value.as_str()))
      .unwrap_or("Notion create page failed.");
    return Ok(ConnectorSendProof {
      connector_id: "notion".to_string(),
      ok: false,
      target: "notion".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some(error_message.to_string()),
    });
  }

  let external_id = body.get("id").and_then(|value| value.as_str()).map(|value| value.to_string());
  Ok(ConnectorSendProof {
    connector_id: "notion".to_string(),
    ok: true,
    target: "notion".to_string(),
    external_id,
    sent_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn connector_send_clickup(title: String, content: String, list_id: Option<String>) -> Result<ConnectorSendProof, String> {
  let sent_at_ms = now_ms();
  let token = std::env::var("CLICKUP_API_KEY").unwrap_or_default();
  if token.trim().is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "clickup".to_string(),
      ok: false,
      target: "clickup".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("CLICKUP_API_KEY is not configured.".to_string()),
    });
  }

  let clean_title = title.trim().to_string();
  let clean_content = content.trim().to_string();
  if clean_title.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "clickup".to_string(),
      ok: false,
      target: "clickup".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("title is required.".to_string()),
    });
  }

  let env_list = std::env::var("CLICKUP_LIST_ID").unwrap_or_default();
  let target_list = list_id.unwrap_or_default().trim().to_string();
  let effective_list = if !target_list.is_empty() { target_list } else { env_list.trim().to_string() };
  if effective_list.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "clickup".to_string(),
      ok: false,
      target: "clickup".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("CLICKUP_LIST_ID is missing and no list_id override was provided.".to_string()),
    });
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("Alphonso-ClickUp-Bridge/0.1")
    .build()
    .map_err(|error| error.to_string())?;

  let endpoint = format!("https://api.clickup.com/api/v2/list/{}/task", effective_list);
  let payload = serde_json::json!({
    "name": clean_title,
    "description": if clean_content.is_empty() { "Created by Alphonso connector." } else { clean_content.as_str() },
    "status": "to do"
  });

  let response = client
    .post(endpoint)
    .header("Authorization", token.trim())
    .header("Content-Type", "application/json")
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_message = body
      .get("err")
      .and_then(|value| value.as_str())
      .or_else(|| body.get("error").and_then(|value| value.as_str()))
      .unwrap_or("ClickUp create task failed.");
    return Ok(ConnectorSendProof {
      connector_id: "clickup".to_string(),
      ok: false,
      target: effective_list,
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some(error_message.to_string()),
    });
  }

  let external_id = body.get("id").and_then(|value| value.as_str()).map(|value| value.to_string());
  Ok(ConnectorSendProof {
    connector_id: "clickup".to_string(),
    ok: true,
    target: effective_list,
    external_id,
    sent_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn tool_connection_post_webhook(
  webhook_url: String,
  payload: Value,
  platform: Option<String>,
  connection_name: Option<String>,
) -> Result<WebhookPostProof, String> {
  let sent_at_ms = now_ms();
  let clean_url = webhook_url.trim().to_string();
  if clean_url.is_empty() {
    return Ok(WebhookPostProof {
      ok: false,
      platform: platform.unwrap_or_else(|| "custom".to_string()),
      connection_name,
      webhook_host: None,
      http_status: None,
      response_preview: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("webhook_url is required.".to_string()),
    });
  }

  if !is_allowed_webhook_url(&clean_url) {
    return Ok(WebhookPostProof {
      ok: false,
      platform: platform.unwrap_or_else(|| "custom".to_string()),
      connection_name,
      webhook_host: webhook_host_from_url(&clean_url),
      http_status: None,
      response_preview: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("Webhook URLs must use https or localhost/http loopback for local testing.".to_string()),
    });
  }

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("Alphonso-Webhook-Bridge/0.1")
    .build()
    .map_err(|error| error.to_string())?;

  let response = client
    .post(&clean_url)
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body = response.text().await.map_err(|error| error.to_string())?;
  let preview = {
    let trimmed = body.trim();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed.chars().take(240).collect::<String>())
    }
  };

  if !status.is_success() {
    return Ok(WebhookPostProof {
      ok: false,
      platform: platform.unwrap_or_else(|| "custom".to_string()),
      connection_name,
      webhook_host: webhook_host_from_url(&clean_url),
      http_status: Some(status.as_u16()),
      response_preview: preview,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some(format!("Webhook POST returned HTTP {}", status.as_u16())),
    });
  }

  Ok(WebhookPostProof {
    ok: true,
    platform: platform.unwrap_or_else(|| "custom".to_string()),
    connection_name,
    webhook_host: webhook_host_from_url(&clean_url),
    http_status: Some(status.as_u16()),
    response_preview: preview,
    sent_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn connector_poll_whatsapp(limit: Option<u16>) -> Result<ConnectorPollProof, String> {
  let checked_at_ms = now_ms();
  let provider = std::env::var("WHATSAPP_PROVIDER")
    .map(|value| value.trim().to_ascii_lowercase())
    .unwrap_or_else(|_| "cloud_api".to_string());
  if provider != "twilio" {
    return Ok(ConnectorPollProof {
      connector_id: "whatsapp".to_string(),
      ok: false,
      count: 0,
      cursor: None,
      messages: vec![],
      checked_at_ms,
      trust: "placeholder".to_string(),
      error: Some("Inbound polling is only supported for WHATSAPP_PROVIDER=twilio. Cloud API inbound requires webhook wiring.".to_string()),
    });
  }

  let account_sid = std::env::var("WHATSAPP_TWILIO_ACCOUNT_SID").unwrap_or_default();
  let auth_token = std::env::var("WHATSAPP_TWILIO_AUTH_TOKEN").unwrap_or_default();
  let from_number = std::env::var("WHATSAPP_TWILIO_FROM").unwrap_or_default();
  if account_sid.trim().is_empty() || auth_token.trim().is_empty() || from_number.trim().is_empty() {
    return Ok(ConnectorPollProof {
      connector_id: "whatsapp".to_string(),
      ok: false,
      count: 0,
      cursor: None,
      messages: vec![],
      checked_at_ms,
      trust: "unverified".to_string(),
      error: Some("Twilio inbound polling requires WHATSAPP_TWILIO_ACCOUNT_SID, WHATSAPP_TWILIO_AUTH_TOKEN, and WHATSAPP_TWILIO_FROM.".to_string()),
    });
  }

  let max = limit.unwrap_or(15).clamp(1, 50);
  let formatted_from = if from_number.trim().starts_with("whatsapp:") {
    from_number.trim().to_string()
  } else {
    format!("whatsapp:{}", from_number.trim())
  };

  let endpoint = format!(
    "https://api.twilio.com/2010-04-01/Accounts/{}/Messages.json",
    account_sid.trim()
  );
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("Alphonso-WhatsApp-Bridge/0.1")
    .build()
    .map_err(|error| error.to_string())?;

  let response = client
    .get(endpoint)
    .basic_auth(account_sid.trim(), Some(auth_token.trim()))
    .query(&[
      ("PageSize", max.to_string()),
      ("To", formatted_from.clone()),
    ])
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_message = body
      .get("message")
      .and_then(|value| value.as_str())
      .unwrap_or("Twilio message poll failed.");
    return Ok(ConnectorPollProof {
      connector_id: "whatsapp".to_string(),
      ok: false,
      count: 0,
      cursor: None,
      messages: vec![],
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some(error_message.to_string()),
    });
  }

  let mut messages: Vec<ConnectorInboundMessage> = vec![];
  if let Some(rows) = body.get("messages").and_then(|value| value.as_array()) {
    for row in rows {
      let direction = row.get("direction").and_then(|value| value.as_str()).unwrap_or("");
      if direction != "inbound" {
        continue;
      }
      let from = row.get("from").and_then(|value| value.as_str()).unwrap_or("").to_string();
      let to = row.get("to").and_then(|value| value.as_str()).unwrap_or("").to_string();
      if to != formatted_from {
        continue;
      }
      let text = row.get("body").and_then(|value| value.as_str()).unwrap_or("").trim().to_string();
      if text.is_empty() {
        continue;
      }
      let sid = row.get("sid").and_then(|value| value.as_str()).unwrap_or("0");
      messages.push(ConnectorInboundMessage {
        update_id: 0,
        chat_id: from.clone(),
        from_id: Some(from),
        text,
        date_unix: None,
        received_at_ms: checked_at_ms,
      });
      if messages.len() >= usize::from(max) {
        break;
      }
      if sid.is_empty() {
        continue;
      }
    }
  }

  Ok(ConnectorPollProof {
    connector_id: "whatsapp".to_string(),
    ok: true,
    count: messages.len(),
    cursor: None,
    messages,
    checked_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
fn verify_whatsapp_cloud_webhook_challenge(
  mode: Option<String>,
  verify_token: Option<String>,
  challenge: Option<String>,
) -> WhatsAppWebhookVerifyProof {
  let checked_at_ms = now_ms();
  let expected = std::env::var("WHATSAPP_VERIFY_TOKEN").unwrap_or_default();
  let incoming_mode = mode.unwrap_or_default().trim().to_string();
  let incoming_token = verify_token.unwrap_or_default().trim().to_string();
  let incoming_challenge = challenge.unwrap_or_default().trim().to_string();

  if expected.trim().is_empty() {
    return WhatsAppWebhookVerifyProof {
      ok: false,
      mode: Some(incoming_mode),
      verify_token_present: false,
      challenge: Some(incoming_challenge),
      response_challenge: None,
      checked_at_ms,
      trust: "setup_required".to_string(),
      error: Some("WHATSAPP_VERIFY_TOKEN is not configured.".to_string()),
    };
  }

  if incoming_mode != "subscribe" {
    return WhatsAppWebhookVerifyProof {
      ok: false,
      mode: Some(incoming_mode),
      verify_token_present: true,
      challenge: Some(incoming_challenge),
      response_challenge: None,
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some("Webhook mode must be subscribe.".to_string()),
    };
  }

  if incoming_token != expected.trim() {
    return WhatsAppWebhookVerifyProof {
      ok: false,
      mode: Some(incoming_mode),
      verify_token_present: true,
      challenge: Some(incoming_challenge),
      response_challenge: None,
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some("Verify token mismatch.".to_string()),
    };
  }

  WhatsAppWebhookVerifyProof {
    ok: true,
    mode: Some("subscribe".to_string()),
    verify_token_present: true,
    challenge: Some(incoming_challenge.clone()),
    response_challenge: Some(incoming_challenge),
    checked_at_ms,
    trust: "verified".to_string(),
    error: None,
  }
}

#[tauri::command]
fn verify_whatsapp_cloud_webhook_signature(
  raw_body: String,
  signature_header: Option<String>,
) -> WhatsAppWebhookSignatureProof {
  let checked_at_ms = now_ms();
  let app_secret = std::env::var("WHATSAPP_APP_SECRET").unwrap_or_default();
  let received_header = signature_header.unwrap_or_default().trim().to_string();
  if app_secret.trim().is_empty() {
    return WhatsAppWebhookSignatureProof {
      ok: false,
      signature_header_present: !received_header.is_empty(),
      app_secret_present: false,
      expected_signature: None,
      received_signature: if received_header.is_empty() { None } else { Some(received_header) },
      checked_at_ms,
      trust: "setup_required".to_string(),
      error: Some("WHATSAPP_APP_SECRET is not configured.".to_string()),
    };
  }
  if received_header.is_empty() {
    return WhatsAppWebhookSignatureProof {
      ok: false,
      signature_header_present: false,
      app_secret_present: true,
      expected_signature: None,
      received_signature: None,
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some("X-Hub-Signature-256 header is missing.".to_string()),
    };
  }

  type HmacSha256 = Hmac<Sha256>;
  let mut mac = match HmacSha256::new_from_slice(app_secret.trim().as_bytes()) {
    Ok(value) => value,
    Err(error) => {
      return WhatsAppWebhookSignatureProof {
        ok: false,
        signature_header_present: true,
        app_secret_present: true,
        expected_signature: None,
        received_signature: Some(received_header),
        checked_at_ms,
        trust: "failed".to_string(),
        error: Some(format!("Failed to initialize HMAC: {error}")),
      };
    }
  };
  mac.update(raw_body.as_bytes());
  let digest = mac.finalize().into_bytes();
  let expected = format!("sha256={}", to_hex(&digest));
  let valid = expected.eq_ignore_ascii_case(received_header.as_str());

  WhatsAppWebhookSignatureProof {
    ok: valid,
    signature_header_present: true,
    app_secret_present: true,
    expected_signature: Some(expected),
    received_signature: Some(received_header),
    checked_at_ms,
    trust: if valid { "verified" } else { "failed" }.to_string(),
    error: if valid { None } else { Some("Webhook signature mismatch.".to_string()) },
  }
}

#[tauri::command]
fn normalize_whatsapp_cloud_inbound(raw_body: String) -> WhatsAppCloudInboundNormalizeProof {
  let checked_at_ms = now_ms();
  let parsed: Value = match serde_json::from_str(raw_body.as_str()) {
    Ok(value) => value,
    Err(error) => {
      return WhatsAppCloudInboundNormalizeProof {
        ok: false,
        provider: "whatsapp_cloud_api".to_string(),
        count: 0,
        messages: vec![],
        checked_at_ms,
        trust: "failed".to_string(),
        error: Some(format!("Invalid JSON payload: {error}")),
      };
    }
  };

  let mut messages: Vec<ConnectorInboundMessage> = vec![];
  let entries = parsed
    .get("entry")
    .and_then(|value| value.as_array())
    .cloned()
    .unwrap_or_default();

  for entry in entries {
    let changes = entry
      .get("changes")
      .and_then(|value| value.as_array())
      .cloned()
      .unwrap_or_default();
    for change in changes {
      let value = change.get("value").cloned().unwrap_or(Value::Null);
      let incoming = value
        .get("messages")
        .and_then(|item| item.as_array())
        .cloned()
        .unwrap_or_default();
      for msg in incoming {
        let text = msg
          .get("text")
          .and_then(|node| node.get("body"))
          .and_then(|node| node.as_str())
          .unwrap_or("")
          .trim()
          .to_string();
        if text.is_empty() {
          continue;
        }
        let from = msg
          .get("from")
          .and_then(|node| node.as_str())
          .unwrap_or("")
          .to_string();
        let id = msg
          .get("id")
          .and_then(|node| node.as_str())
          .unwrap_or("")
          .to_string();
        let timestamp = msg
          .get("timestamp")
          .and_then(|node| node.as_str())
          .and_then(|node| node.parse::<i64>().ok());

        messages.push(ConnectorInboundMessage {
          update_id: 0,
          chat_id: from.clone(),
          from_id: Some(from),
          text,
          date_unix: timestamp,
          received_at_ms: checked_at_ms,
        });

        if id.is_empty() {
          continue;
        }
      }
    }
  }

  WhatsAppCloudInboundNormalizeProof {
    ok: true,
    provider: "whatsapp_cloud_api".to_string(),
    count: messages.len(),
    messages,
    checked_at_ms,
    trust: "verified".to_string(),
    error: None,
  }
}

#[tauri::command]
async fn connector_send_chatgpt(
  http_client: tauri::State<'_, reqwest::Client>,
  text: String,
) -> Result<ConnectorSendProof, String> {
  let sent_at_ms = now_ms();
  let key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
  if key.trim().is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "chatgpt".to_string(),
      ok: false,
      target: "chatgpt".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("OPENAI_API_KEY is not configured.".to_string()),
    });
  }

  let clean_text = text.trim().to_string();
  if clean_text.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "chatgpt".to_string(),
      ok: false,
      target: "chatgpt".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("text is required.".to_string()),
    });
  }

  let model = std::env::var("OPENAI_CONNECTOR_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
  let client = http_client.inner();
  let payload = serde_json::json!({
    "model": model,
    "input": clean_text
  });
  let response = client
    .post("https://api.openai.com/v1/responses")
    .bearer_auth(key.trim())
    .header("Content-Type", "application/json")
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let message = body
      .get("error")
      .and_then(|value| value.get("message"))
      .and_then(|value| value.as_str())
      .unwrap_or("OpenAI responses API call failed.");
    return Ok(ConnectorSendProof {
      connector_id: "chatgpt".to_string(),
      ok: false,
      target: model,
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some(message.to_string()),
    });
  }
  let external_id = body.get("id").and_then(|value| value.as_str()).map(|value| value.to_string());
  Ok(ConnectorSendProof {
    connector_id: "chatgpt".to_string(),
    ok: true,
    target: model,
    external_id,
    sent_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn connector_send_claude(
  http_client: tauri::State<'_, reqwest::Client>,
  text: String,
) -> Result<ConnectorSendProof, String> {
  let sent_at_ms = now_ms();
  let key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
  if key.trim().is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "claude".to_string(),
      ok: false,
      target: "claude".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "unverified".to_string(),
      error: Some("ANTHROPIC_API_KEY is not configured.".to_string()),
    });
  }

  let clean_text = text.trim().to_string();
  if clean_text.is_empty() {
    return Ok(ConnectorSendProof {
      connector_id: "claude".to_string(),
      ok: false,
      target: "claude".to_string(),
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some("text is required.".to_string()),
    });
  }

  let model = std::env::var("CLAUDE_CONNECTOR_MODEL").unwrap_or_else(|_| "claude-3-5-sonnet-latest".to_string());
  let client = http_client.inner();
  let payload = serde_json::json!({
    "model": model,
    "max_tokens": 512,
    "messages": [
      { "role": "user", "content": clean_text }
    ]
  });
  let response = client
    .post("https://api.anthropic.com/v1/messages")
    .header("x-api-key", key.trim())
    .header("anthropic-version", "2023-06-01")
    .header("content-type", "application/json")
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let message = body
      .get("error")
      .and_then(|value| value.get("message"))
      .and_then(|value| value.as_str())
      .unwrap_or("Anthropic messages API call failed.");
    return Ok(ConnectorSendProof {
      connector_id: "claude".to_string(),
      ok: false,
      target: model,
      external_id: None,
      sent_at_ms,
      trust: "failed".to_string(),
      error: Some(message.to_string()),
    });
  }
  let external_id = body.get("id").and_then(|value| value.as_str()).map(|value| value.to_string());
  Ok(ConnectorSendProof {
    connector_id: "claude".to_string(),
    ok: true,
    target: model,
    external_id,
    sent_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
async fn connector_upload_youtube(
  file_path: String,
  title: String,
  description: Option<String>,
  tags: Option<Vec<String>>,
  privacy_status: Option<String>,
) -> Result<YouTubeUploadProof, String> {
  let uploaded_at_ms = now_ms();
  let path = PathBuf::from(file_path.trim());
  let clean_title = title.trim().to_string();
  let clean_description = description.unwrap_or_default().trim().to_string();
  let clean_privacy = privacy_status
    .unwrap_or_else(|| "private".to_string())
    .trim()
    .to_ascii_lowercase();
  let privacy = match clean_privacy.as_str() {
    "private" | "unlisted" | "public" => clean_privacy,
    _ => "private".to_string(),
  };

  if clean_title.is_empty() {
    return Ok(YouTubeUploadProof {
      connector_id: "youtube".to_string(),
      ok: false,
      video_id: None,
      url: None,
      privacy_status: privacy,
      file_path: file_path.trim().to_string(),
      uploaded_at_ms,
      trust: "failed".to_string(),
      error: Some("title is required.".to_string()),
    });
  }
  if !path.exists() || !path.is_file() {
    return Ok(YouTubeUploadProof {
      connector_id: "youtube".to_string(),
      ok: false,
      video_id: None,
      url: None,
      privacy_status: privacy,
      file_path: file_path.trim().to_string(),
      uploaded_at_ms,
      trust: "failed".to_string(),
      error: Some("video file path does not exist.".to_string()),
    });
  }

  let access_token = match youtube_access_token().await {
    Ok(token) => token,
    Err(error) => {
      return Ok(YouTubeUploadProof {
        connector_id: "youtube".to_string(),
        ok: false,
        video_id: None,
        url: None,
        privacy_status: privacy,
        file_path: path.to_string_lossy().to_string(),
        uploaded_at_ms,
        trust: "unverified".to_string(),
        error: Some(error),
      });
    }
  };

  let file_bytes = fs::read(&path).map_err(|error| error.to_string())?;
  let tags = tags
    .unwrap_or_default()
    .into_iter()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .take(25)
    .collect::<Vec<_>>();
  let metadata = serde_json::json!({
    "snippet": {
      "title": clean_title,
      "description": clean_description,
      "tags": tags
    },
    "status": {
      "privacyStatus": privacy
    }
  });
  let metadata_bytes = serde_json::to_vec(&metadata).map_err(|error| error.to_string())?;
  let boundary = format!("alphonso-youtube-{}", uploaded_at_ms);
  let mime = mime_for_video_path(&path);

  let mut body: Vec<u8> = Vec::with_capacity(metadata_bytes.len() + file_bytes.len() + 1024);
  body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
  body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
  body.extend_from_slice(&metadata_bytes);
  body.extend_from_slice(b"\r\n");
  body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
  body.extend_from_slice(format!("Content-Type: {}\r\n", mime).as_bytes());
  body.extend_from_slice(b"Content-Transfer-Encoding: binary\r\n\r\n");
  body.extend_from_slice(&file_bytes);
  body.extend_from_slice(b"\r\n");
  body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(300))
    .user_agent("Alphonso-YouTube-Connector/0.1")
    .build()
    .map_err(|error| error.to_string())?;
  let response = client
    .post("https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart")
    .bearer_auth(access_token)
    .header("Content-Type", format!("multipart/related; boundary={}", boundary))
    .body(body)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let payload: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_message = payload
      .get("error")
      .and_then(|value| value.get("message"))
      .and_then(|value| value.as_str())
      .unwrap_or("YouTube upload failed.");
    return Ok(YouTubeUploadProof {
      connector_id: "youtube".to_string(),
      ok: false,
      video_id: None,
      url: None,
      privacy_status: privacy,
      file_path: path.to_string_lossy().to_string(),
      uploaded_at_ms,
      trust: "failed".to_string(),
      error: Some(error_message.to_string()),
    });
  }

  let video_id = payload
    .get("id")
    .and_then(|value| value.as_str())
    .map(|value| value.to_string());
  let url = video_id
    .as_ref()
    .map(|value| format!("https://www.youtube.com/watch?v={}", value));
  Ok(YouTubeUploadProof {
    connector_id: "youtube".to_string(),
    ok: true,
    video_id,
    url,
    privacy_status: privacy,
    file_path: path.to_string_lossy().to_string(),
    uploaded_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetaPublishRequest {
  approved: bool,
  platform: String,
  caption: Option<String>,
  message: Option<String>,
  title: Option<String>,
  link: Option<String>,
  image_url: Option<String>,
  video_url: Option<String>,
  local_file_path: Option<String>,
  media_type: Option<String>,
  request_id: Option<String>,
}

#[tauri::command]
async fn meta_publish_content(request: MetaPublishRequest) -> Result<MetaPublishProof, String> {
  let published_at_ms = now_ms();
  let platform = request.platform.trim().to_ascii_lowercase();
  let _request_id = request.request_id.as_deref().unwrap_or("").trim().to_string();
  if platform.is_empty() || !matches!(platform.as_str(), "instagram" | "facebook") {
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: false,
      platform: platform.clone(),
      published: false,
      post_ids: Vec::new(),
      url: None,
      setup_required: false,
      published_at_ms,
      trust: "failed".to_string(),
      message: "Only instagram and facebook publishing are supported.".to_string(),
      error: Some("unsupported platform".to_string()),
    });
  }

  if !request.approved {
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: false,
      platform,
      published: false,
      post_ids: Vec::new(),
      url: None,
      setup_required: false,
      published_at_ms,
      trust: "failed".to_string(),
      message: "Publish denied pending approval.".to_string(),
      error: Some("approval required".to_string()),
    });
  }

  let access_token = std::env::var("META_ACCESS_TOKEN").unwrap_or_default();
  if access_token.trim().is_empty() {
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: false,
      platform,
      published: false,
      post_ids: Vec::new(),
      url: None,
      setup_required: true,
      published_at_ms,
      trust: "unverified".to_string(),
      message: "META_ACCESS_TOKEN is missing.".to_string(),
      error: Some("META_ACCESS_TOKEN is not configured.".to_string()),
    });
  }

  let proof = meta_appsecret_proof(access_token.trim());
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(90))
    .user_agent("Alphonso-Meta-Publish/0.1")
    .build()
    .map_err(|error| error.to_string())?;
  let caption = request.caption.as_deref().unwrap_or(request.message.as_deref().unwrap_or(request.title.as_deref().unwrap_or(""))).trim().to_string();
  let title = request.title.as_deref().unwrap_or("").trim().to_string();
  let link = request.link.as_deref().unwrap_or("").trim().to_string();

  let mut auth_query: Vec<(String, String)> = vec![("access_token".to_string(), access_token.trim().to_string())];
  if let Some(proof_value) = proof.clone() {
    auth_query.push(("appsecret_proof".to_string(), proof_value));
  }

  if platform == "instagram" {
    let ig_user_id = std::env::var("INSTAGRAM_BUSINESS_ACCOUNT_ID").unwrap_or_default();
    if ig_user_id.trim().is_empty() {
      return Ok(MetaPublishProof {
        connector_id: "meta".to_string(),
        ok: false,
        platform,
        published: false,
        post_ids: Vec::new(),
        url: None,
        setup_required: true,
        published_at_ms,
        trust: "unverified".to_string(),
        message: "INSTAGRAM_BUSINESS_ACCOUNT_ID is missing.".to_string(),
        error: Some("INSTAGRAM_BUSINESS_ACCOUNT_ID is not configured.".to_string()),
      });
    }

    let image_url = request.image_url.as_deref().unwrap_or("").trim().to_string();
    let video_url = request.video_url.as_deref().unwrap_or("").trim().to_string();
    let media_type = request.media_type.as_deref().unwrap_or("").trim().to_ascii_uppercase();
    if image_url.is_empty() && video_url.is_empty() {
      return Ok(MetaPublishProof {
        connector_id: "meta".to_string(),
        ok: false,
        platform,
        published: false,
        post_ids: Vec::new(),
        url: None,
        setup_required: true,
        published_at_ms,
        trust: "setup_required".to_string(),
        message: "Instagram publishing requires a public image_url or video_url.".to_string(),
        error: Some("public media url required".to_string()),
      });
    }

    let media_endpoint = format!(
      "https://graph.facebook.com/{}/{}/media",
      meta_graph_api_version(),
      ig_user_id.trim()
    );
    let mut media_form = vec![
      ("caption".to_string(), caption.clone()),
    ];
    if !media_type.is_empty() {
      media_form.push(("media_type".to_string(), media_type.clone()));
    } else if !video_url.is_empty() {
      media_form.push(("media_type".to_string(), "REELS".to_string()));
    }
    if !video_url.is_empty() {
      media_form.push(("video_url".to_string(), video_url.clone()));
    } else {
      media_form.push(("image_url".to_string(), image_url.clone()));
    }
    let create_response = client
      .post(&media_endpoint)
      .query(&auth_query)
      .form(&media_form)
      .send()
      .await
      .map_err(|error| error.to_string())?;
    let create_status = create_response.status();
    let create_body: Value = create_response.json().await.map_err(|error| error.to_string())?;
    if !create_status.is_success() {
      return Ok(MetaPublishProof {
        connector_id: "meta".to_string(),
        ok: false,
        platform,
        published: false,
        post_ids: Vec::new(),
        url: None,
        setup_required: false,
        published_at_ms,
        trust: "failed".to_string(),
        message: "Instagram media container creation failed.".to_string(),
        error: Some(graph_error_message(&create_body, "Instagram media container creation failed.")),
      });
    }
    let creation_id = create_body.get("id").and_then(|value| value.as_str()).unwrap_or("").trim().to_string();
    if creation_id.is_empty() {
      return Ok(MetaPublishProof {
        connector_id: "meta".to_string(),
        ok: false,
        platform,
        published: false,
        post_ids: Vec::new(),
        url: None,
        setup_required: false,
        published_at_ms,
        trust: "failed".to_string(),
        message: "Instagram media container id was not returned.".to_string(),
        error: Some("missing creation id".to_string()),
      });
    }

    let publish_endpoint = format!(
      "https://graph.facebook.com/{}/{}/media_publish",
      meta_graph_api_version(),
      ig_user_id.trim()
    );
    let publish_form = vec![("creation_id".to_string(), creation_id.clone())];
    let publish_response = client
      .post(&publish_endpoint)
      .query(&auth_query)
      .form(&publish_form)
      .send()
      .await
      .map_err(|error| error.to_string())?;
    let publish_status = publish_response.status();
    let publish_body: Value = publish_response.json().await.map_err(|error| error.to_string())?;
    if !publish_status.is_success() {
      return Ok(MetaPublishProof {
        connector_id: "meta".to_string(),
        ok: false,
        platform,
        published: false,
        post_ids: vec![creation_id],
        url: None,
        setup_required: false,
        published_at_ms,
        trust: "failed".to_string(),
        message: "Instagram media publish failed.".to_string(),
        error: Some(graph_error_message(&publish_body, "Instagram media publish failed.")),
      });
    }

    let published_id = publish_body.get("id").and_then(|value| value.as_str()).unwrap_or("").trim().to_string();
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: true,
      platform,
      published: true,
      post_ids: if published_id.is_empty() {
        vec![creation_id]
      } else {
        vec![published_id]
      },
      url: None,
      setup_required: false,
      published_at_ms,
      trust: "verified".to_string(),
      message: "Instagram content published.".to_string(),
      error: None,
    });
  }

  let page_id = std::env::var("META_PAGE_ID").unwrap_or_default();
  if page_id.trim().is_empty() {
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: false,
      platform,
      published: false,
      post_ids: Vec::new(),
      url: None,
      setup_required: true,
      published_at_ms,
      trust: "unverified".to_string(),
      message: "META_PAGE_ID is missing.".to_string(),
      error: Some("META_PAGE_ID is not configured.".to_string()),
    });
  }

  let local_file_path = request.local_file_path.as_deref().unwrap_or("").trim().to_string();
  let image_url = request.image_url.as_deref().unwrap_or("").trim().to_string();
  let video_url = request.video_url.as_deref().unwrap_or("").trim().to_string();
  let page_endpoint_base = format!("https://graph.facebook.com/{}/{}", meta_graph_api_version(), page_id.trim());

  if !local_file_path.is_empty() {
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: false,
      platform,
      published: false,
      post_ids: Vec::new(),
      url: None,
      setup_required: true,
      published_at_ms,
      trust: "setup_required".to_string(),
      message: "Local Meta file uploads are not wired in this build. Use a public image_url or video_url for Instagram, or a remote media URL for Facebook.".to_string(),
      error: Some("local file uploads require a separate storage step".to_string()),
    });
  }

  if !video_url.is_empty() {
    let response = client
      .post(format!("{}/videos", page_endpoint_base))
      .query(&auth_query)
      .form(&[
        ("file_url", video_url.clone()),
        ("description", if caption.is_empty() { title.clone() } else { caption.clone() }),
      ])
      .send()
      .await
      .map_err(|error| error.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
      return Ok(MetaPublishProof {
        connector_id: "meta".to_string(),
        ok: false,
        platform,
        published: false,
        post_ids: Vec::new(),
        url: None,
        setup_required: false,
        published_at_ms,
        trust: "failed".to_string(),
        message: "Facebook video publish failed.".to_string(),
        error: Some(graph_error_message(&body, "Facebook video publish failed.")),
      });
    }
    let post_id = body
      .get("post_id")
      .or_else(|| body.get("id"))
      .and_then(|value| value.as_str())
      .unwrap_or("")
      .trim()
      .to_string();
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: true,
      platform,
      published: true,
      post_ids: vec![post_id.clone()].into_iter().filter(|value| !value.is_empty()).collect(),
      url: if post_id.is_empty() { None } else { Some(format!("https://www.facebook.com/{}", post_id)) },
      setup_required: false,
      published_at_ms,
      trust: "verified".to_string(),
      message: "Facebook video published.".to_string(),
      error: None,
    });
  }

  if !image_url.is_empty() {
    let response = client
      .post(format!("{}/photos", page_endpoint_base))
      .query(&auth_query)
      .form(&[
        ("url", image_url.clone()),
        ("caption", if caption.is_empty() { title.clone() } else { caption.clone() }),
      ])
      .send()
      .await
      .map_err(|error| error.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
      return Ok(MetaPublishProof {
        connector_id: "meta".to_string(),
        ok: false,
        platform,
        published: false,
        post_ids: Vec::new(),
        url: None,
        setup_required: false,
        published_at_ms,
        trust: "failed".to_string(),
        message: "Facebook photo publish failed.".to_string(),
        error: Some(graph_error_message(&body, "Facebook photo publish failed.")),
      });
    }
    let post_id = body
      .get("post_id")
      .or_else(|| body.get("id"))
      .and_then(|value| value.as_str())
      .unwrap_or("")
      .trim()
      .to_string();
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: true,
      platform,
      published: true,
      post_ids: vec![post_id.clone()].into_iter().filter(|value| !value.is_empty()).collect(),
      url: if post_id.is_empty() { None } else { Some(format!("https://www.facebook.com/{}", post_id)) },
      setup_required: false,
      published_at_ms,
      trust: "verified".to_string(),
      message: "Facebook photo published.".to_string(),
      error: None,
    });
  }

  let message = if !caption.is_empty() {
    caption.clone()
  } else if !link.is_empty() {
    link.clone()
  } else {
    title.clone()
  };
  if message.is_empty() {
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: false,
      platform,
      published: false,
      post_ids: Vec::new(),
      url: None,
      setup_required: true,
      published_at_ms,
      trust: "setup_required".to_string(),
      message: "Facebook publish requires text or media input.".to_string(),
      error: Some("content missing".to_string()),
    });
  }

  let mut feed_form = vec![("message".to_string(), message)];
  if !link.is_empty() {
    feed_form.push(("link".to_string(), link));
  }
  let response = client
    .post(format!("{}/feed", page_endpoint_base))
    .query(&auth_query)
    .form(&feed_form)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    return Ok(MetaPublishProof {
      connector_id: "meta".to_string(),
      ok: false,
      platform,
      published: false,
      post_ids: Vec::new(),
      url: None,
      setup_required: false,
      published_at_ms,
      trust: "failed".to_string(),
      message: "Facebook feed publish failed.".to_string(),
      error: Some(graph_error_message(&body, "Facebook feed publish failed.")),
    });
  }
  let post_id = body
    .get("post_id")
    .or_else(|| body.get("id"))
    .and_then(|value| value.as_str())
    .unwrap_or("")
    .trim()
    .to_string();
  Ok(MetaPublishProof {
    connector_id: "meta".to_string(),
    ok: true,
    platform,
    published: true,
    post_ids: vec![post_id.clone()].into_iter().filter(|value| !value.is_empty()).collect(),
    url: if post_id.is_empty() { None } else { Some(format!("https://www.facebook.com/{}", post_id)) },
    setup_required: false,
    published_at_ms,
    trust: "verified".to_string(),
    message: "Facebook post published.".to_string(),
    error: None,
  })
}

fn inject_prompt_into_comfy_workflow(workflow: &mut Value, prompt: &str) -> usize {
  let mut replaced = 0_usize;
  let Some(map) = workflow.as_object_mut() else {
    return replaced;
  };

  for node in map.values_mut() {
    let Some(node_obj) = node.as_object_mut() else {
      continue;
    };
    let class_type = node_obj
      .get("class_type")
      .and_then(|value| value.as_str())
      .unwrap_or("")
      .to_string();
    let Some(inputs) = node_obj.get_mut("inputs").and_then(|value| value.as_object_mut()) else {
      continue;
    };

    if class_type.to_ascii_lowercase().contains("cliptextencode") {
      if let Some(text_value) = inputs.get_mut("text") {
        if text_value.is_string() {
          *text_value = Value::String(prompt.to_string());
          replaced += 1;
        }
      }
    }
  }

  replaced
}

#[tauri::command]
async fn connector_generate_sdwebui_image(
  prompt: String,
  negative_prompt: Option<String>,
  width: Option<u32>,
  height: Option<u32>,
  steps: Option<u16>,
  cfg_scale: Option<f32>,
) -> Result<MediaGenerationProof, String> {
  let queued_at_ms = now_ms();
  let clean_prompt = prompt.trim().to_string();
  if clean_prompt.is_empty() {
    return Ok(MediaGenerationProof {
      connector_id: "sd_webui".to_string(),
      ok: false,
      provider: "automatic1111".to_string(),
      job_id: None,
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "failed".to_string(),
      message: "Prompt is required.".to_string(),
      error: Some("Prompt is required.".to_string()),
    });
  }

  let endpoint = std::env::var("LOCAL_SDWEBUI_ENDPOINT")
    .unwrap_or_else(|_| "http://127.0.0.1:7860".to_string())
    .trim_end_matches('/')
    .to_string();
  let width = width.unwrap_or(768).clamp(256, 1536);
  let height = height.unwrap_or(768).clamp(256, 1536);
  let steps = steps.unwrap_or(24).clamp(6, 60);
  let cfg_scale = cfg_scale.unwrap_or(7.0).clamp(1.0, 20.0);
  let clean_negative = negative_prompt.unwrap_or_default().trim().to_string();
  let auth = std::env::var("LOCAL_SDWEBUI_BASIC_AUTH").unwrap_or_default();
  let mut auth_parts = auth.splitn(2, ':');
  let auth_user = auth_parts.next().unwrap_or("").trim().to_string();
  let auth_pass = auth_parts.next().unwrap_or("").trim().to_string();
  let use_basic_auth = !auth_user.is_empty() && !auth_pass.is_empty();

  let payload = serde_json::json!({
    "prompt": clean_prompt,
    "negative_prompt": clean_negative,
    "width": width,
    "height": height,
    "steps": steps,
    "cfg_scale": cfg_scale,
    "sampler_name": "DPM++ 2M Karras",
    "batch_size": 1,
    "n_iter": 1,
    "send_images": true,
    "save_images": false
  });

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(180))
    .user_agent("Alphonso-Miya-SDWebUI/0.1")
    .build()
    .map_err(|error| error.to_string())?;
  let mut request = client
    .post(format!("{endpoint}/sdapi/v1/txt2img"))
    .json(&payload);
  if use_basic_auth {
    request = request.basic_auth(auth_user, Some(auth_pass));
  }

  let response = request.send().await.map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_message = body
      .get("error")
      .and_then(|value| value.as_str())
      .or_else(|| body.get("detail").and_then(|value| value.as_str()))
      .unwrap_or("Stable Diffusion txt2img request failed.");
    return Ok(MediaGenerationProof {
      connector_id: "sd_webui".to_string(),
      ok: false,
      provider: "automatic1111".to_string(),
      job_id: None,
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "failed".to_string(),
      message: "Image generation request failed.".to_string(),
      error: Some(error_message.to_string()),
    });
  }

  let images = body
    .get("images")
    .and_then(|value| value.as_array())
    .cloned()
    .unwrap_or_default();
  let preview_base64 = images
    .first()
    .and_then(|value| value.as_str())
    .map(|value| value.to_string());
  let image_count = images.len();
  if image_count == 0 {
    return Ok(MediaGenerationProof {
      connector_id: "sd_webui".to_string(),
      ok: false,
      provider: "automatic1111".to_string(),
      job_id: None,
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "failed".to_string(),
      message: "No image payload returned by local SD WebUI.".to_string(),
      error: Some("Local SD WebUI returned no images.".to_string()),
    });
  }

  Ok(MediaGenerationProof {
    connector_id: "sd_webui".to_string(),
    ok: true,
    provider: "automatic1111".to_string(),
    job_id: None,
    output_paths: vec![],
    preview_base64,
    queued_at_ms,
    trust: "verified".to_string(),
    message: format!("Generated {image_count} image(s) using local SD WebUI."),
    error: None,
  })
}

async fn probe_local_runtime_health(
  connector_id: &str,
  provider: &str,
  endpoint: &str,
  probe_path: &str,
) -> Result<LocalRuntimeHealthProof, String> {
  let checked_at_ms = now_ms();
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(10))
    .user_agent("Alphonso-LocalRuntimeHealth/0.1")
    .build()
    .map_err(|error| error.to_string())?;
  let response = client
    .get(format!("{endpoint}{probe_path}"))
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let http_status = Some(response.status().as_u16());
  if !response.status().is_success() {
    return Ok(LocalRuntimeHealthProof {
      connector_id: connector_id.to_string(),
      provider: provider.to_string(),
      ok: false,
      endpoint: endpoint.to_string(),
      probe_path: probe_path.to_string(),
      http_status,
      checked_at_ms,
      trust: "failed".to_string(),
      message: format!("{provider} runtime responded but not successfully."),
      error: Some(format!("HTTP {}", response.status().as_u16())),
    });
  }

  Ok(LocalRuntimeHealthProof {
    connector_id: connector_id.to_string(),
    provider: provider.to_string(),
    ok: true,
    endpoint: endpoint.to_string(),
    probe_path: probe_path.to_string(),
    http_status,
    checked_at_ms,
    trust: "verified".to_string(),
    message: format!("{provider} runtime is reachable."),
    error: None,
  })
}

#[tauri::command]
async fn connector_check_local_runtime_health(connector_id: String) -> Result<LocalRuntimeHealthProof, String> {
  let clean_id = connector_id.trim();
  match clean_id {
    "sd_webui" => {
      let endpoint = std::env::var("LOCAL_SDWEBUI_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:7860".to_string())
        .trim_end_matches('/')
        .to_string();
      probe_local_runtime_health("sd_webui", "automatic1111", &endpoint, "/sdapi/v1/samplers").await
    }
    "comfyui_video" => {
      let endpoint = std::env::var("COMFYUI_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:8188".to_string())
        .trim_end_matches('/')
        .to_string();
      probe_local_runtime_health("comfyui_video", "comfyui", &endpoint, "/system_stats").await
    }
    _ => Err(format!("Unsupported local runtime connector: {clean_id}")),
  }
}

#[tauri::command]
async fn connector_queue_comfyui_video(
  prompt: String,
  workflow_json: String,
) -> Result<MediaGenerationProof, String> {
  let queued_at_ms = now_ms();
  let clean_prompt = prompt.trim().to_string();
  if clean_prompt.is_empty() {
    return Ok(MediaGenerationProof {
      connector_id: "comfyui_video".to_string(),
      ok: false,
      provider: "comfyui".to_string(),
      job_id: None,
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "failed".to_string(),
      message: "Prompt is required.".to_string(),
      error: Some("Prompt is required.".to_string()),
    });
  }

  let mut workflow: Value = match serde_json::from_str(&workflow_json) {
    Ok(value) => value,
    Err(error) => {
      return Ok(MediaGenerationProof {
        connector_id: "comfyui_video".to_string(),
        ok: false,
        provider: "comfyui".to_string(),
        job_id: None,
        output_paths: vec![],
        preview_base64: None,
        queued_at_ms,
        trust: "failed".to_string(),
        message: "Workflow JSON is invalid.".to_string(),
        error: Some(error.to_string()),
      });
    }
  };

  let replaced = inject_prompt_into_comfy_workflow(&mut workflow, &clean_prompt);
  if replaced == 0 {
    return Ok(MediaGenerationProof {
      connector_id: "comfyui_video".to_string(),
      ok: false,
      provider: "comfyui".to_string(),
      job_id: None,
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "unverified".to_string(),
      message: "Workflow has no CLIPTextEncode text inputs to inject prompt.".to_string(),
      error: Some("Provide a workflow with CLIPTextEncode text input nodes.".to_string()),
    });
  }

  let endpoint = std::env::var("COMFYUI_ENDPOINT")
    .unwrap_or_else(|_| "http://127.0.0.1:8188".to_string())
    .trim_end_matches('/')
    .to_string();
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(120))
    .user_agent("Alphonso-Miya-ComfyUI/0.1")
    .build()
    .map_err(|error| error.to_string())?;
  let payload = serde_json::json!({
    "prompt": workflow
  });

  let response = client
    .post(format!("{endpoint}/prompt"))
    .json(&payload)
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    let error_message = body
      .get("error")
      .and_then(|value| value.as_str())
      .or_else(|| body.get("detail").and_then(|value| value.as_str()))
      .unwrap_or("ComfyUI prompt queue request failed.");
    return Ok(MediaGenerationProof {
      connector_id: "comfyui_video".to_string(),
      ok: false,
      provider: "comfyui".to_string(),
      job_id: None,
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "failed".to_string(),
      message: "ComfyUI queue request failed.".to_string(),
      error: Some(error_message.to_string()),
    });
  }

  let job_id = body
    .get("prompt_id")
    .and_then(|value| value.as_str())
    .map(|value| value.to_string());

  Ok(MediaGenerationProof {
    connector_id: "comfyui_video".to_string(),
    ok: true,
    provider: "comfyui".to_string(),
    job_id: job_id.clone(),
    output_paths: vec![],
    preview_base64: None,
    queued_at_ms,
    trust: "verified".to_string(),
    message: if let Some(job_id) = job_id {
      format!("ComfyUI video workflow queued. prompt_id={job_id}")
    } else {
      "ComfyUI workflow queued, but prompt_id was not returned.".to_string()
    },
    error: None,
  })
}

#[tauri::command]
async fn connector_get_comfyui_history(prompt_id: String) -> Result<MediaGenerationProof, String> {
  let queued_at_ms = now_ms();
  let clean_id = prompt_id.trim().to_string();
  if clean_id.is_empty() {
    return Ok(MediaGenerationProof {
      connector_id: "comfyui_video".to_string(),
      ok: false,
      provider: "comfyui".to_string(),
      job_id: None,
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "failed".to_string(),
      message: "prompt_id is required.".to_string(),
      error: Some("prompt_id is required.".to_string()),
    });
  }

  let endpoint = std::env::var("COMFYUI_ENDPOINT")
    .unwrap_or_else(|_| "http://127.0.0.1:8188".to_string())
    .trim_end_matches('/')
    .to_string();
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(30))
    .user_agent("Alphonso-Miya-ComfyUI/0.1")
    .build()
    .map_err(|error| error.to_string())?;
  let response = client
    .get(format!("{endpoint}/history/{clean_id}"))
    .send()
    .await
    .map_err(|error| error.to_string())?;
  let status = response.status();
  let body: Value = response.json().await.map_err(|error| error.to_string())?;

  if !status.is_success() {
    return Ok(MediaGenerationProof {
      connector_id: "comfyui_video".to_string(),
      ok: false,
      provider: "comfyui".to_string(),
      job_id: Some(clean_id),
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "failed".to_string(),
      message: "ComfyUI history request failed.".to_string(),
      error: Some(format!("HTTP {}", status.as_u16())),
    });
  }

  let history_entry = body.get(&clean_id).cloned().unwrap_or(Value::Null);
  if history_entry.is_null() {
    return Ok(MediaGenerationProof {
      connector_id: "comfyui_video".to_string(),
      ok: true,
      provider: "comfyui".to_string(),
      job_id: Some(clean_id),
      output_paths: vec![],
      preview_base64: None,
      queued_at_ms,
      trust: "pending".to_string(),
      message: "Workflow is still running or history not available yet.".to_string(),
      error: None,
    });
  }

  let mut output_paths: Vec<String> = vec![];
  if let Some(outputs) = history_entry.get("outputs").and_then(|value| value.as_object()) {
    for node_output in outputs.values() {
      if let Some(images) = node_output.get("images").and_then(|value| value.as_array()) {
        for image in images {
          let filename = image.get("filename").and_then(|value| value.as_str()).unwrap_or("");
          let subfolder = image.get("subfolder").and_then(|value| value.as_str()).unwrap_or("");
          let file_type = image.get("type").and_then(|value| value.as_str()).unwrap_or("output");
          if filename.is_empty() {
            continue;
          }
          output_paths.push(format!("{subfolder}/{filename} ({file_type})"));
        }
      }
    }
  }
  output_paths = dedup_strings(output_paths);

  Ok(MediaGenerationProof {
    connector_id: "comfyui_video".to_string(),
    ok: true,
    provider: "comfyui".to_string(),
    job_id: Some(clean_id),
    output_paths: output_paths.clone(),
    preview_base64: None,
    queued_at_ms,
    trust: "verified".to_string(),
    message: if output_paths.is_empty() {
      "ComfyUI history loaded. No output files listed yet.".to_string()
    } else {
      format!("ComfyUI history loaded. {} output file(s) detected.", output_paths.len())
    },
    error: None,
  })
}

fn dedup_strings(mut values: Vec<String>) -> Vec<String> {
  values.sort();
  values.dedup();
  values
}

#[tauri::command]
async fn check_app_update(
  app: tauri::AppHandle,
  endpoint: Option<String>,
  pubkey: Option<String>,
  target: Option<String>,
) -> AppUpdateCheckProof {
  let checked_at_ms = now_ms();
  let endpoint = endpoint.unwrap_or_default().trim().to_string();
  let pubkey = pubkey.unwrap_or_default().trim().to_string();

  if endpoint.is_empty() || pubkey.is_empty() {
    return AppUpdateCheckProof {
      configured: false,
      available: false,
      current_version: app.package_info().version.to_string(),
      latest_version: None,
      notes: None,
      pub_date: None,
      download_url: None,
      checked_at_ms,
      trust: "unverified".to_string(),
      error: Some("Updater is not configured. Provide both endpoint and public key.".to_string()),
    };
  }

  let builder = app.updater_builder();
  let endpoint_url = match reqwest::Url::parse(&endpoint) {
    Ok(url) => url,
    Err(error) => {
      return AppUpdateCheckProof {
        configured: true,
        available: false,
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        notes: None,
        pub_date: None,
        download_url: None,
        checked_at_ms,
        trust: "failed".to_string(),
        error: Some(format!("Invalid updater endpoint URL: {error}")),
      };
    }
  };

  let builder = match builder.endpoints(vec![endpoint_url]) {
    Ok(next) => next,
    Err(error) => {
      return AppUpdateCheckProof {
        configured: true,
        available: false,
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        notes: None,
        pub_date: None,
        download_url: None,
        checked_at_ms,
        trust: "failed".to_string(),
        error: Some(error.to_string()),
      };
    }
  };

  let mut builder = builder.pubkey(pubkey);

  if let Some(custom_target) = target {
    let clean = custom_target.trim();
    if !clean.is_empty() {
      builder = builder.target(clean.to_string());
    }
  }

  let updater = match builder.build() {
    Ok(updater) => updater,
    Err(error) => {
      return AppUpdateCheckProof {
        configured: true,
        available: false,
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        notes: None,
        pub_date: None,
        download_url: None,
        checked_at_ms,
        trust: "failed".to_string(),
        error: Some(error.to_string()),
      };
    }
  };

  match updater.check().await {
    Ok(Some(update)) => AppUpdateCheckProof {
      configured: true,
      available: true,
      current_version: update.current_version,
      latest_version: Some(update.version),
      notes: update.body,
      pub_date: update.date.map(|date| date.to_string()),
      download_url: Some(update.download_url.to_string()),
      checked_at_ms,
      trust: "verified".to_string(),
      error: None,
    },
    Ok(None) => AppUpdateCheckProof {
      configured: true,
      available: false,
      current_version: app.package_info().version.to_string(),
      latest_version: None,
      notes: None,
      pub_date: None,
      download_url: None,
      checked_at_ms,
      trust: "verified".to_string(),
      error: None,
    },
    Err(error) => AppUpdateCheckProof {
      configured: true,
      available: false,
      current_version: app.package_info().version.to_string(),
      latest_version: None,
      notes: None,
      pub_date: None,
      download_url: None,
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some(error.to_string()),
    },
  }
}

fn between_quotes(line: &str) -> Option<String> {
  let mut quote_char = '\0';
  let mut start_index: Option<usize> = None;
  for (idx, ch) in line.char_indices() {
    if start_index.is_none() {
      if ch == '"' || ch == '\'' {
        quote_char = ch;
        start_index = Some(idx + ch.len_utf8());
      }
      continue;
    }

    if ch == quote_char {
      let start = start_index.unwrap_or(0);
      if idx > start {
        return Some(line[start..idx].to_string());
      }
      break;
    }
  }
  None
}

fn extract_dependencies(content: &str, language: &str) -> Vec<String> {
  let mut deps: Vec<String> = vec![];

  for line in content.lines() {
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }

    match language {
      "javascript" | "react-jsx" | "typescript" | "react-tsx" => {
        if trimmed.starts_with("import ") || trimmed.contains(" from ") || trimmed.contains("require(") {
          if let Some(dep) = between_quotes(trimmed) {
            deps.push(dep);
          }
        }
      }
      "rust" => {
        if trimmed.starts_with("use ") {
          let raw = trimmed.trim_start_matches("use ").trim_end_matches(';').trim();
          if !raw.is_empty() {
            deps.push(raw.to_string());
          }
        }
      }
      "python" => {
        if trimmed.starts_with("import ") {
          let raw = trimmed.trim_start_matches("import ").trim();
          if !raw.is_empty() {
            deps.push(raw.split_whitespace().next().unwrap_or("").to_string());
          }
        } else if trimmed.starts_with("from ") && trimmed.contains(" import ") {
          let raw = trimmed.trim_start_matches("from ").split(" import ").next().unwrap_or("").trim();
          if !raw.is_empty() {
            deps.push(raw.to_string());
          }
        }
      }
      _ => {}
    }
  }

  dedup_strings(deps.into_iter().filter(|dep| !dep.is_empty()).collect())
}

fn parse_tasklist(tasklist_output: &str, query: &str) -> Vec<ProcessMatch> {
  let lower_query = query.to_ascii_lowercase();
  #[cfg(target_os = "windows")]
  {
    return tasklist_output
      .lines()
      .filter_map(|line| {
        let trimmed = line.trim();
        if !trimmed.contains(",") {
          return None;
        }

        let clean = trimmed.trim_matches('"');
        let parts: Vec<&str> = clean.split("\",\"").collect();
        if parts.len() < 2 {
          return None;
        }

        let process_name = parts[0].to_string();
        if !process_name.to_ascii_lowercase().contains(&lower_query) {
          return None;
        }

        let pid = parts[1].parse::<u32>().ok();
        Some(ProcessMatch {
          name: process_name,
          pid,
        })
      })
      .collect();
  }

  #[cfg(not(target_os = "windows"))]
  {
    tasklist_output
      .lines()
      .skip(1)
      .filter_map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
          return None;
        }

        let mut parts = trimmed.split_whitespace();
        let pid = parts.next().and_then(|value| value.parse::<u32>().ok());
        let name = parts.collect::<Vec<&str>>().join(" ");
        if name.is_empty() || !name.to_ascii_lowercase().contains(&lower_query) {
          return None;
        }
        Some(ProcessMatch { name, pid })
      })
      .collect()
  }
}

fn text_has_any(text: &str, terms: &[&str]) -> bool {
  terms.iter().any(|term| text.contains(term))
}

fn split_command_fragments(input: &str) -> Vec<String> {
  input
    .split(|ch| ch == ',' || ch == '.')
    .flat_map(|part| part.split(" then "))
    .flat_map(|part| part.split(" and "))
    .map(|part| part.trim().to_string())
    .filter(|part| !part.is_empty())
    .take(10)
    .collect()
}

#[tauri::command]
fn decompose_jose_command_backend(command_text: String) -> Vec<JoseAssignmentProof> {
  let clean = command_text.trim().to_string();
  if clean.is_empty() {
    return vec![];
  }
  let lower = clean.to_ascii_lowercase();
  let fragments = split_command_fragments(&lower);
  let mut assignments: Vec<JoseAssignmentProof> = vec![];

  let research = text_has_any(&lower, &["research", "lookup", "docs", "source", "citation", "latest", "pricing", "market"]);
  let creative = text_has_any(&lower, &["video", "script", "brand", "campaign", "thumbnail", "storyboard", "prompt", "creative"]);
  let local_execution = text_has_any(&lower, &["build", "runtime", "ollama", "verify", "diagnostic", "fix", "test", "package", "file"]);
  let publishing = text_has_any(&lower, &["upload", "publish", "post", "youtube", "tiktok", "instagram"]);
  let risky_local = text_has_any(&lower, &["delete", "remove", "deploy", "write", "modify", "execute"]);

  if research {
    assignments.push(JoseAssignmentProof {
      agent: "hector".to_string(),
      title: format!("Hector research task: {}", clean.chars().take(64).collect::<String>()),
      rationale: "Research language detected. Hector should gather and verify sources.".to_string(),
      action_type: "research".to_string(),
      risk_level: "low".to_string(),
      requires_approval: true,
      command_preview: "Research and citation proof only. No uploads or account actions.".to_string(),
      decomposition: fragments.clone(),
    });
  }

  if publishing {
    assignments.push(JoseAssignmentProof {
      agent: "hector".to_string(),
      title: format!("Hector publish safety check: {}", clean.chars().take(64).collect::<String>()),
      rationale: "Publishing language detected. Jose approval required before any external action.".to_string(),
      action_type: "external_publish_handoff".to_string(),
      risk_level: "high".to_string(),
      requires_approval: true,
      command_preview: "No automatic posting. Requires explicit approval and connector auth.".to_string(),
      decomposition: fragments.clone(),
    });
  }

  if creative {
    assignments.push(JoseAssignmentProof {
      agent: "miya".to_string(),
      title: format!("Miya creative task: {}", clean.chars().take(64).collect::<String>()),
      rationale: "Creative language detected. Miya produces script/storyboard/prompt packages.".to_string(),
      action_type: "creative_package".to_string(),
      risk_level: "low".to_string(),
      requires_approval: true,
      command_preview: "Creative package generation only.".to_string(),
      decomposition: fragments.clone(),
    });
  }

  if local_execution {
    assignments.push(JoseAssignmentProof {
      agent: "alphonso".to_string(),
      title: format!("Alphonso operator task: {}", clean.chars().take(64).collect::<String>()),
      rationale: "Runtime/build/verification language detected.".to_string(),
      action_type: "local_operation".to_string(),
      risk_level: if risky_local { "high".to_string() } else { "medium".to_string() },
      requires_approval: true,
      command_preview: if risky_local {
        "Potential local/system action. Explicit approval required.".to_string()
      } else {
        "Local diagnostics/verification only.".to_string()
      },
      decomposition: fragments.clone(),
    });
  }

  if assignments.is_empty() {
    assignments.push(JoseAssignmentProof {
      agent: "jose".to_string(),
      title: format!("Jose planning task: {}", clean.chars().take(64).collect::<String>()),
      rationale: "No specialist match detected.".to_string(),
      action_type: "orchestration_review".to_string(),
      risk_level: "low".to_string(),
      requires_approval: false,
      command_preview: "Planning only.".to_string(),
      decomposition: fragments,
    });
  }

  assignments
}

#[tauri::command]
fn execute_command_verified(program: String, args: Vec<String>, cwd: Option<String>) -> Result<CommandProof, String> {
  let started = now_ms();

  if !allowed_program(&program) {
    return Err("Program is not allowed by Alphonso supervised command policy.".to_string());
  }

  let mut command = Command::new(&program);
  command.args(&args);

  if let Some(path) = &cwd {
    command.current_dir(path);
  }

  let output = command.output().map_err(|error| error.to_string())?;
  let finished = now_ms();
  let success = output.status.success();

  Ok(CommandProof {
    program,
    args,
    cwd,
    started_at_ms: started,
    finished_at_ms: finished,
    success,
    exit_code: output.status.code(),
    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    trust: if success { "verified".to_string() } else { "failed".to_string() },
  })
}

#[tauri::command]
fn verify_paths(paths: Vec<String>) -> Vec<PathProof> {
  paths
    .into_iter()
    .map(|path| {
      let path_buf = PathBuf::from(&path);
      let metadata = fs::metadata(&path_buf).ok();
      let modified_at_ms = metadata
        .as_ref()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

      PathProof {
        path,
        exists: metadata.is_some(),
        is_file: metadata.as_ref().map(|meta| meta.is_file()).unwrap_or(false),
        is_dir: metadata.as_ref().map(|meta| meta.is_dir()).unwrap_or(false),
        modified_at_ms,
        trust: if metadata.is_some() { "verified".to_string() } else { "failed".to_string() },
      }
    })
    .collect()
}

#[tauri::command]
fn read_runtime_env_value(name: String) -> Result<RuntimeEnvValueProof, String> {
  let allowed = matches!(
    name.as_str(),
    "ALPHONSO_SELFDEV_AUTORUN"
      | "ALPHONSO_SELFDEV_EXIT_ON_COMPLETE"
      | "ALPHONSO_WORKSPACE_ROOT"
      | "ALPHONSO_PROOF_OUTPUT_DIR"
  );
  if !allowed {
    return Err("Environment variable is not exposed through this command.".to_string());
  }

  let checked_at_ms = now_ms();
  match std::env::var(&name) {
    Ok(value) => {
      let trimmed = value.trim().to_string();
      Ok(RuntimeEnvValueProof {
        name,
        present: !trimmed.is_empty(),
        value: if trimmed.is_empty() { None } else { Some(trimmed) },
        checked_at_ms,
        trust: "verified".to_string(),
        error: None,
      })
    }
    Err(error) => {
      let reason = match error {
        std::env::VarError::NotPresent => "missing".to_string(),
        std::env::VarError::NotUnicode(_) => "not unicode".to_string(),
      };
      Ok(RuntimeEnvValueProof {
        name,
        present: false,
        value: None,
        checked_at_ms,
        trust: "failed".to_string(),
        error: Some(reason),
      })
    }
  }
}

fn normalize_bridge_path_prefix(raw: &str) -> String {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    "/api/alphonso-bridge".to_string()
  } else if trimmed.starts_with('/') {
    trimmed.to_string()
  } else {
    format!("/{}", trimmed)
  }
}

fn trim_trailing_slashes(raw: &str) -> String {
  raw.trim().trim_end_matches('/').to_string()
}

#[tauri::command]
fn alphonso_bridge_status() -> Value {
  let base_url = std::env::var("ALPHONSO_BRIDGE_URL").unwrap_or_default();
  let token = std::env::var("ALPHONSO_BRIDGE_TOKEN").unwrap_or_default();
  let path_prefix = std::env::var("ALPHONSO_BRIDGE_PATH_PREFIX")
    .ok()
    .map(|value| normalize_bridge_path_prefix(&value))
    .unwrap_or_else(|| "/api/alphonso-bridge".to_string());
  let timeout_ms = std::env::var("ALPHONSO_BRIDGE_TIMEOUT_MS")
    .ok()
    .and_then(|value| value.trim().parse::<u64>().ok())
    .unwrap_or(15000);
  let configured = !base_url.trim().is_empty() && !token.trim().is_empty();

  serde_json::json!({
    "success": true,
    "configured": configured,
    "enabled": configured,
    "status": if configured { "configured" } else { "setup_required" },
    "baseUrlConfigured": !base_url.trim().is_empty(),
    "tokenConfigured": !token.trim().is_empty(),
    "pathPrefix": path_prefix,
    "timeoutMs": timeout_ms
  })
}

#[tauri::command]
async fn alphonso_bridge_send_packet(packet: Value) -> Result<Value, String> {
  let base_url = std::env::var("ALPHONSO_BRIDGE_URL")
    .map_err(|_| "ALPHONSO_BRIDGE_URL is not configured.".to_string())?;
  let token = std::env::var("ALPHONSO_BRIDGE_TOKEN")
    .map_err(|_| "ALPHONSO_BRIDGE_TOKEN is not configured.".to_string())?;
  let path_prefix = std::env::var("ALPHONSO_BRIDGE_PATH_PREFIX")
    .ok()
    .map(|value| normalize_bridge_path_prefix(&value))
    .unwrap_or_else(|| "/api/alphonso-bridge".to_string());
  let timeout_ms = std::env::var("ALPHONSO_BRIDGE_TIMEOUT_MS")
    .ok()
    .and_then(|value| value.trim().parse::<u64>().ok())
    .unwrap_or(15000);
  let url = format!("{}{}", trim_trailing_slashes(&base_url), path_prefix);
  let client = reqwest::Client::builder()
    .timeout(Duration::from_millis(timeout_ms))
    .build()
    .map_err(|error| error.to_string())?;

  let response = client
    .post(&url)
    .bearer_auth(token.trim())
    .json(&packet)
    .send()
    .await
    .map_err(|error| error.to_string())?;

  let http_status = response.status().as_u16();
  let response_text = response.text().await.map_err(|error| error.to_string())?;
  let parsed_response = serde_json::from_str(&response_text).unwrap_or_else(|_| serde_json::Value::String(response_text));
  let status_proof = alphonso_bridge_status();
  let ok = http_status < 400;

  Ok(serde_json::json!({
    "success": ok,
    "ok": ok,
    "httpStatus": http_status,
    "response": parsed_response,
    "bridge": status_proof,
    "status": if ok { "synced" } else { "failed" }
  }))
}

#[tauri::command]
fn check_processes(names: Vec<String>) -> Result<Vec<ProcessProof>, String> {
  #[cfg(target_os = "windows")]
  let tasklist_output = {
    let output = Command::new("tasklist")
      .args(["/FO", "CSV", "/NH"])
      .output()
      .map_err(|error| error.to_string())?;

    String::from_utf8_lossy(&output.stdout).to_string()
  };

  #[cfg(not(target_os = "windows"))]
  let tasklist_output = {
    let output = Command::new("ps")
      .args(["-axo", "pid,comm"])
      .output()
      .map_err(|error| error.to_string())?;

    String::from_utf8_lossy(&output.stdout).to_string()
  };

  let proofs = names
    .into_iter()
    .map(|name| {
      let matches = parse_tasklist(&tasklist_output, &name);
      let running = !matches.is_empty();
      ProcessProof {
        query: name,
        running,
        matches,
        trust: if running { "verified".to_string() } else { "failed".to_string() },
      }
    })
    .collect();

  Ok(proofs)
}

#[tauri::command]
async fn check_ollama_runtime(endpoint: Option<String>) -> Result<OllamaRuntimeProof, String> {
  let base = endpoint.unwrap_or_else(|| "http://localhost:11434".to_string()).trim_end_matches('/').to_string();
  let url = format!("{base}/api/tags");

  let client = reqwest::Client::new();
  let response = client
    .get(&url)
    .timeout(Duration::from_secs(8))
    .send()
    .await;

  let checked_at_ms = now_ms();

  match response {
    Ok(response) => {
      let status = response.status();
      let code = status.as_u16();

      if !status.is_success() {
        return Ok(OllamaRuntimeProof {
          endpoint: base,
          reachable: false,
          http_status: Some(code),
          models: vec![],
          reason: Some(format!("HTTP {code} from /api/tags")),
          checked_at_ms,
          trust: "failed".to_string(),
        });
      }

      let body: Value = response
        .json()
        .await
        .unwrap_or(Value::Object(serde_json::Map::new()));

      let models = body
        .get("models")
        .and_then(Value::as_array)
        .map(|list| {
          list
            .iter()
            .filter_map(|item| item.get("name").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<String>>()
        })
        .unwrap_or_default();

      Ok(OllamaRuntimeProof {
        endpoint: base,
        reachable: true,
        http_status: Some(code),
        models,
        reason: None,
        checked_at_ms,
        trust: "verified".to_string(),
      })
    }
    Err(error) => {
      let reason = if error.is_timeout() {
        "Request timeout".to_string()
      } else {
        error.to_string()
      };

      Ok(OllamaRuntimeProof {
        endpoint: base,
        reachable: false,
        http_status: None,
        models: vec![],
        reason: Some(reason),
        checked_at_ms,
        trust: "failed".to_string(),
      })
    }
  }
}

#[tauri::command]
async fn ollama_list_models(endpoint: Option<String>) -> Result<OllamaModelsProof, String> {
  let base = endpoint.unwrap_or_else(|| "http://localhost:11434".to_string()).trim_end_matches('/').to_string();
  let url = format!("{base}/api/tags");
  let client = reqwest::Client::new();
  let response = client
    .get(&url)
    .timeout(Duration::from_secs(10))
    .send()
    .await;

  match response {
    Ok(response) => {
      let code = response.status().as_u16();
      let status = response.status();
      if !status.is_success() {
        return Ok(OllamaModelsProof {
          endpoint: base,
          http_status: Some(code),
          models: vec![],
          trust: "failed".to_string(),
          reason: Some(format!("HTTP {code} from /api/tags")),
        });
      }

      let body: Value = response
        .json()
        .await
        .unwrap_or(Value::Object(serde_json::Map::new()));

      let models = body
        .get("models")
        .and_then(Value::as_array)
        .map(|list| {
          list
            .iter()
            .filter_map(|item| {
              let name = item.get("name").and_then(Value::as_str)?.to_string();
              let size = item.get("size").and_then(Value::as_i64);
              let modified_at = item.get("modified_at").and_then(Value::as_str).map(str::to_string);
              let digest = item.get("digest").and_then(Value::as_str).map(str::to_string);
              let details = item.get("details").cloned();
              Some(OllamaModelInfo {
                name,
                size,
                modified_at,
                digest,
                details,
              })
            })
            .collect::<Vec<OllamaModelInfo>>()
        })
        .unwrap_or_default();

      Ok(OllamaModelsProof {
        endpoint: base,
        http_status: Some(code),
        models,
        trust: "verified".to_string(),
        reason: None,
      })
    }
    Err(error) => Ok(OllamaModelsProof {
      endpoint: base,
      http_status: None,
      models: vec![],
      trust: "failed".to_string(),
      reason: Some(if error.is_timeout() { "Request timeout".to_string() } else { error.to_string() }),
    })
  }
}

#[tauri::command]
async fn ollama_generate(endpoint: Option<String>, model: String, prompt: String) -> Result<OllamaGenerateProof, String> {
  let base = endpoint.unwrap_or_else(|| "http://localhost:11434".to_string()).trim_end_matches('/').to_string();
  let url = format!("{base}/api/generate");

  let client = reqwest::Client::new();
  let body = serde_json::json!({
    "model": model,
    "prompt": prompt,
    "stream": false
  });

  let response = client
    .post(&url)
    .json(&body)
    .timeout(Duration::from_secs(35))
    .send()
    .await;

  match response {
    Ok(response) => {
      let code = response.status().as_u16();
      let status = response.status();
      let data: Value = response
        .json()
        .await
        .unwrap_or(Value::Object(serde_json::Map::new()));
      let response_text = data.get("response").and_then(Value::as_str).unwrap_or("").to_string();
      let done = data.get("done").and_then(Value::as_bool).unwrap_or(!response_text.is_empty());
      let error_text = data.get("error").and_then(Value::as_str).map(str::to_string);
      let success = status.is_success() && error_text.is_none();

      Ok(OllamaGenerateProof {
        endpoint: base,
        http_status: Some(code),
        model,
        response: response_text,
        done,
        trust: if success { "verified".to_string() } else { "failed".to_string() },
        error: if success { None } else { error_text.or_else(|| Some(format!("HTTP {code} from /api/generate"))) },
      })
    }
    Err(error) => Ok(OllamaGenerateProof {
      endpoint: base,
      http_status: None,
      model,
      response: String::new(),
      done: false,
      trust: "failed".to_string(),
      error: Some(if error.is_timeout() { "Request timeout".to_string() } else { error.to_string() }),
    }),
  }
}

#[tauri::command]
fn record_restore_point(app: tauri::AppHandle, snapshot_id: String, payload: String) -> Result<RestorePointProof, String> {
  let dir = app_data_subdir(&app, "recovery")?;

  let mut file_path = dir.clone();
  file_path.push(format!("{snapshot_id}.json"));
  fs::write(&file_path, payload).map_err(|error| error.to_string())?;

  Ok(RestorePointProof {
    snapshot_id,
    file_path: file_path.to_string_lossy().to_string(),
    written: true,
    written_at_ms: now_ms(),
    trust: "verified".to_string(),
  })
}

#[tauri::command]
fn write_handoff_export_file(workspace_root: String, file_name: String, content: String) -> Result<HandoffExportProof, String> {
  let safe_name = Path::new(file_name.trim())
    .file_name()
    .and_then(|value| value.to_str())
    .filter(|value| !value.trim().is_empty())
    .unwrap_or("alphonso-self-development.md")
    .replace(['/', '\\'], "_");
  let proof = write_workspace_text_file(
    workspace_root,
    format!("docs/handoff/{safe_name}"),
    content,
  )?;
  Ok(HandoffExportProof {
    file_path: proof.file_path,
    written: proof.written,
    written_at_ms: proof.written_at_ms,
    bytes: proof.bytes,
    trust: proof.trust,
  })
}

#[tauri::command]
fn write_workspace_text_file(workspace_root: String, relative_path: String, content: String) -> Result<WorkspaceWriteProof, String> {
  let root = PathBuf::from(workspace_root.trim());
  if root.as_os_str().is_empty() {
    return Err("Workspace root is required for workspace file writes.".to_string());
  }

  let root_abs = fs::canonicalize(&root).map_err(|error| error.to_string())?;
  let rel = Path::new(relative_path.trim());
  if rel.as_os_str().is_empty() {
    return Err("Relative path is required.".to_string());
  }
  if rel.is_absolute() || rel.components().any(|component| matches!(component, Component::ParentDir | Component::Prefix(_) | Component::RootDir)) {
    return Err("Unsafe relative path rejected.".to_string());
  }

  let file_path = root_abs.join(rel);
  if let Some(parent) = file_path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }

  let payload = content.into_bytes();
  let bytes = payload.len();
  fs::write(&file_path, payload).map_err(|error| error.to_string())?;

  Ok(WorkspaceWriteProof {
    file_path: file_path.to_string_lossy().to_string(),
    relative_path: rel.to_string_lossy().to_string(),
    written: true,
    written_at_ms: now_ms(),
    bytes,
    trust: "verified".to_string(),
  })
}

#[tauri::command]
fn append_audit_log(app: tauri::AppHandle, event_type: String, entry: Value) -> Result<AuditWriteProof, String> {
  let dir = app_data_subdir(&app, "audit")?;
  let mut file_path = dir.clone();
  file_path.push("verification.log.jsonl");

  let prev_hash = if file_path.exists() {
    let file = fs::File::open(&file_path).map_err(|error| error.to_string())?;
    let reader = BufReader::new(file);
    let mut last_hash: Option<String> = None;
    for line in reader.lines() {
      let line = line.map_err(|error| error.to_string())?;
      if line.trim().is_empty() {
        continue;
      }
      if let Ok(parsed) = serde_json::from_str::<Value>(&line) {
        last_hash = parsed
          .get("chain_hash")
          .and_then(Value::as_str)
          .map(str::to_string);
      }
    }
    last_hash
  } else {
    None
  };

  let written_at_ms = now_ms();
  let entry_json = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
  let chain_input = format!(
    "{}|{}|{}|{}",
    event_type,
    written_at_ms,
    entry_json,
    prev_hash.clone().unwrap_or_else(|| "GENESIS".to_string())
  );
  let chain_hash = sha256_hex(&chain_input);

  let mut payload = Map::new();
  payload.insert("id".to_string(), Value::String(format!("audit-{}-{}", now_ms(), rand_suffix())));
  payload.insert("timestamp_ms".to_string(), Value::Number(written_at_ms.into()));
  payload.insert("event_type".to_string(), Value::String(event_type));
  payload.insert("entry".to_string(), entry);
  payload.insert("prev_hash".to_string(), prev_hash.clone().map(Value::String).unwrap_or(Value::Null));
  payload.insert("chain_hash".to_string(), Value::String(chain_hash.clone()));

  let encoded = serde_json::to_string(&Value::Object(payload)).map_err(|error| error.to_string())?;
  let mut file = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(&file_path)
    .map_err(|error| error.to_string())?;
  file.write_all(encoded.as_bytes()).map_err(|error| error.to_string())?;
  file.write_all(b"\n").map_err(|error| error.to_string())?;

  Ok(AuditWriteProof {
    path: file_path.to_string_lossy().to_string(),
    written_at_ms,
    bytes: encoded.len(),
    prev_hash,
    chain_hash,
    trust: "verified".to_string(),
  })
}

#[tauri::command]
fn read_audit_log(app: tauri::AppHandle, limit: Option<usize>) -> Result<Vec<Value>, String> {
  let dir = app_data_subdir(&app, "audit")?;
  let mut file_path = dir.clone();
  file_path.push("verification.log.jsonl");
  if !file_path.exists() {
    return Ok(vec![]);
  }

  let file = fs::File::open(&file_path).map_err(|error| error.to_string())?;
  let reader = BufReader::new(file);
  let mut entries: Vec<Value> = vec![];
  for line in reader.lines() {
    let line = line.map_err(|error| error.to_string())?;
    if line.trim().is_empty() {
      continue;
    }
    if let Ok(value) = serde_json::from_str::<Value>(&line) {
      entries.push(value);
    }
  }

  let take = limit.unwrap_or(200);
  if entries.len() > take {
    Ok(entries.split_off(entries.len() - take))
  } else {
    Ok(entries)
  }
}

#[tauri::command]
fn verify_audit_chain(app: tauri::AppHandle) -> Result<AuditChainVerificationProof, String> {
  let dir = app_data_subdir(&app, "audit")?;
  let mut file_path = dir.clone();
  file_path.push("verification.log.jsonl");
  let checked_at_ms = now_ms();

  if !file_path.exists() {
    return Ok(AuditChainVerificationProof {
      path: file_path.to_string_lossy().to_string(),
      total_entries: 0,
      verified_entries: 0,
      broken_index: None,
      reason: Some("Audit log file does not exist yet.".to_string()),
      checked_at_ms,
      trust: "unverified".to_string(),
    });
  }

  let file = fs::File::open(&file_path).map_err(|error| error.to_string())?;
  let reader = BufReader::new(file);
  let mut previous_hash: Option<String> = None;
  let mut total_entries = 0_usize;
  let mut verified_entries = 0_usize;

  for (index, line) in reader.lines().enumerate() {
    let line = line.map_err(|error| error.to_string())?;
    if line.trim().is_empty() {
      continue;
    }
    total_entries += 1;

    let parsed = match serde_json::from_str::<Value>(&line) {
      Ok(value) => value,
      Err(error) => {
        return Ok(AuditChainVerificationProof {
          path: file_path.to_string_lossy().to_string(),
          total_entries,
          verified_entries,
          broken_index: Some(index),
          reason: Some(format!("Invalid JSON line: {error}")),
          checked_at_ms,
          trust: "failed".to_string(),
        });
      }
    };

    let event_type = parsed.get("event_type").and_then(Value::as_str).unwrap_or("");
    let timestamp_ms = parsed.get("timestamp_ms").and_then(Value::as_u64).unwrap_or(0);
    let entry_value = parsed.get("entry").cloned().unwrap_or(Value::Null);
    let stored_prev = parsed.get("prev_hash").and_then(Value::as_str).map(str::to_string);
    let stored_hash = parsed.get("chain_hash").and_then(Value::as_str).map(str::to_string);

    if stored_hash.is_none() {
      return Ok(AuditChainVerificationProof {
        path: file_path.to_string_lossy().to_string(),
        total_entries,
        verified_entries,
        broken_index: Some(index),
        reason: Some("Missing chain_hash field.".to_string()),
        checked_at_ms,
        trust: "failed".to_string(),
      });
    }

    let expected_prev = previous_hash.clone();
    if stored_prev != expected_prev {
      return Ok(AuditChainVerificationProof {
        path: file_path.to_string_lossy().to_string(),
        total_entries,
        verified_entries,
        broken_index: Some(index),
        reason: Some("prev_hash does not match previous entry hash.".to_string()),
        checked_at_ms,
        trust: "failed".to_string(),
      });
    }

    let entry_json = serde_json::to_string(&entry_value).map_err(|error| error.to_string())?;
    let expected_hash = sha256_hex(&format!(
      "{}|{}|{}|{}",
      event_type,
      timestamp_ms,
      entry_json,
      expected_prev.unwrap_or_else(|| "GENESIS".to_string())
    ));

    if stored_hash.clone().unwrap_or_default() != expected_hash {
      return Ok(AuditChainVerificationProof {
        path: file_path.to_string_lossy().to_string(),
        total_entries,
        verified_entries,
        broken_index: Some(index),
        reason: Some("Computed chain hash mismatch.".to_string()),
        checked_at_ms,
        trust: "failed".to_string(),
      });
    }

    verified_entries += 1;
    previous_hash = stored_hash;
  }

  Ok(AuditChainVerificationProof {
    path: file_path.to_string_lossy().to_string(),
    total_entries,
    verified_entries,
    broken_index: None,
    reason: None,
    checked_at_ms,
    trust: "verified".to_string(),
  })
}

fn rand_suffix() -> String {
  format!("{:x}", now_ms() % 0x00ff_ffff)
}

fn sha256_hex(input: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(input.as_bytes());
  let digest = hasher.finalize();
  digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
}

#[tauri::command]
fn discover_plugins_from_disk(app: tauri::AppHandle, workspace_root: Option<String>) -> Result<Vec<PluginManifestProof>, String> {
  let mut search_roots: Vec<PathBuf> = vec![];

  if let Some(root) = workspace_root {
    let root = PathBuf::from(root);
    search_roots.push(root.join("plugins"));
    search_roots.push(root.join("alphonso-plugins"));
    search_roots.push(root);
  }

  let app_plugins_dir = app_data_subdir(&app, "plugins")?;
  search_roots.push(app_plugins_dir);

  let mut manifest_paths: Vec<PathBuf> = vec![];
  for root in search_roots {
    if !root.exists() || !root.is_dir() {
      continue;
    }

    if let Ok(entries) = fs::read_dir(&root) {
      for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|name| name.to_str()) == Some("plugin.json") {
          manifest_paths.push(path.clone());
        }
        if path.is_dir() {
          let direct_manifest = path.join("plugin.json");
          if direct_manifest.exists() {
            manifest_paths.push(direct_manifest);
          }
          let codex_manifest = path.join(".codex-plugin").join("plugin.json");
          if codex_manifest.exists() {
            manifest_paths.push(codex_manifest);
          }
        }
      }
    }
  }

  manifest_paths.sort();
  manifest_paths.dedup();

  let mut discovered: Vec<PluginManifestProof> = vec![];
  for manifest_path in manifest_paths {
    let encoded = fs::read_to_string(&manifest_path).map_err(|error| error.to_string())?;
    match serde_json::from_str::<PluginManifestDisk>(&encoded) {
      Ok(parsed) => {
        let tools = parsed
          .tools
          .unwrap_or_default()
          .into_iter()
          .map(|tool| PluginToolDescriptor {
            id: tool.id,
            program: tool.program,
            args: tool.args.unwrap_or_default(),
            cwd: tool.cwd,
            permissions: tool.permissions.unwrap_or_default(),
          })
          .collect::<Vec<PluginToolDescriptor>>();

        discovered.push(PluginManifestProof {
          id: parsed.id.clone(),
          name: parsed.name.unwrap_or_else(|| parsed.id.clone()),
          version: parsed.version.unwrap_or_else(|| "0.0.0".to_string()),
          permissions: parsed.permissions.unwrap_or_default(),
          enabled_by_default: parsed.enabled_by_default.unwrap_or(false),
          manifest_version: parsed.manifest_version.unwrap_or_else(|| "1.0.0".to_string()),
          manifest_path: manifest_path.to_string_lossy().to_string(),
          tools,
          trust: "verified".to_string(),
          error: None,
        });
      }
      Err(error) => {
        discovered.push(PluginManifestProof {
          id: "invalid-manifest".to_string(),
          name: "Invalid Plugin Manifest".to_string(),
          version: "0.0.0".to_string(),
          permissions: vec![],
          enabled_by_default: false,
          manifest_version: "unknown".to_string(),
          manifest_path: manifest_path.to_string_lossy().to_string(),
          tools: vec![],
          trust: "failed".to_string(),
          error: Some(error.to_string()),
        });
      }
    }
  }

  Ok(discovered)
}

#[tauri::command]
fn validate_plugin_manifest_disk(app: tauri::AppHandle, manifest_path: String) -> Result<PluginManifestValidationProof, String> {
  let path = PathBuf::from(&manifest_path);
  if !path.exists() || !path.is_file() {
    let proof = PluginManifestValidationProof {
      manifest_path,
      valid: false,
      errors: vec!["Manifest path does not exist.".to_string()],
      warnings: vec![],
      trust: "failed".to_string(),
    };
    let _ = append_plugin_audit_event(
      &app,
      "plugin_manifest_validation",
      serde_json::json!({
        "manifestPath": &proof.manifest_path,
        "valid": proof.valid,
        "errors": &proof.errors,
        "warnings": &proof.warnings,
        "trust": &proof.trust
      }),
    );
    return Ok(proof);
  }

  let encoded = fs::read_to_string(&path).map_err(|error| error.to_string())?;
  let mut errors: Vec<String> = vec![];
  let mut warnings: Vec<String> = vec![];

  match serde_json::from_str::<PluginManifestDisk>(&encoded) {
    Ok(parsed) => {
      if parsed.id.trim().is_empty() {
        errors.push("Plugin id is empty.".to_string());
      }
      if parsed.manifest_version.as_deref() != Some("1.0.0") {
        warnings.push("Plugin manifest_version is not 1.0.0. Compatibility is not guaranteed.".to_string());
      }
      if parsed.permissions.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        warnings.push("Plugin permissions are missing or empty.".to_string());
      }
      if parsed.tools.as_ref().map(|tools| tools.is_empty()).unwrap_or(true) {
        warnings.push("Plugin has no declared tools.".to_string());
      }
      if let Some(tools) = parsed.tools {
        for tool in tools {
          if tool.id.trim().is_empty() {
            errors.push("Plugin tool id is empty.".to_string());
          }
          if tool.program.trim().is_empty() {
            errors.push(format!("Plugin tool {} has empty program.", tool.id));
          }
          if !allowed_program(&tool.program) {
            warnings.push(format!("Plugin tool {} program '{}' is outside supervised allowlist.", tool.id, tool.program));
          }
        }
      }
    }
    Err(error) => {
      errors.push(format!("Invalid JSON manifest: {error}"));
    }
  }

  let valid = errors.is_empty();
  let proof = PluginManifestValidationProof {
    manifest_path,
    valid,
    errors,
    warnings,
    trust: if valid { "verified".to_string() } else { "failed".to_string() },
  };
  let _ = append_plugin_audit_event(
    &app,
    "plugin_manifest_validation",
    serde_json::json!({
      "manifestPath": &proof.manifest_path,
      "valid": proof.valid,
      "errors": &proof.errors,
      "warnings": &proof.warnings,
      "trust": &proof.trust
    }),
  );
  Ok(proof)
}

fn resolve_plugin_cwd(manifest_path: &PathBuf, tool_cwd: &Option<String>, workspace_root: &Option<String>) -> Result<Option<PathBuf>, String> {
  let Some(tool_cwd) = tool_cwd else {
    return Ok(None);
  };

  let base_dir = manifest_path.parent().ok_or_else(|| "Plugin manifest path has no parent directory.".to_string())?;
  let candidate = PathBuf::from(tool_cwd);
  let resolved = if candidate.is_absolute() {
    candidate
  } else {
    base_dir.join(candidate)
  };

  if let Some(root) = workspace_root {
    let root_path = PathBuf::from(root);
    if root_path.exists() {
      let resolved_abs = fs::canonicalize(&resolved).map_err(|error| error.to_string())?;
      let root_abs = fs::canonicalize(&root_path).map_err(|error| error.to_string())?;
      if !resolved_abs.starts_with(&root_abs) {
        return Err("Resolved plugin cwd is outside workspace root.".to_string());
      }
      return Ok(Some(resolved_abs));
    }
  }

  Ok(Some(resolved))
}

#[tauri::command]
fn execute_plugin_tool(
  app: tauri::AppHandle,
  manifest_path: String,
  plugin_id: String,
  tool_id: String,
  extra_args: Option<Vec<String>>,
  workspace_root: Option<String>,
) -> Result<PluginToolExecutionProof, String> {
  let started = now_ms();
  let extra = extra_args.unwrap_or_default();
  if let Err(error) = validate_plugin_extra_args(&extra) {
    let _ = append_plugin_audit_event(
      &app,
      "plugin_tool_execution_blocked",
      serde_json::json!({
        "pluginId": plugin_id,
        "toolId": tool_id,
        "manifestPath": manifest_path,
        "reason": error,
        "trust": "failed"
      }),
    );
    return Err(error);
  }

  let manifest_path_buf = PathBuf::from(&manifest_path);
  if !manifest_path_buf.exists() || !manifest_path_buf.is_file() {
    let reason = "Plugin manifest path does not exist.".to_string();
    let _ = append_plugin_audit_event(
      &app,
      "plugin_tool_execution_blocked",
      serde_json::json!({
        "pluginId": plugin_id,
        "toolId": tool_id,
        "manifestPath": manifest_path,
        "reason": reason,
        "trust": "failed"
      }),
    );
    return Err(reason);
  }

  let encoded = fs::read_to_string(&manifest_path_buf).map_err(|error| error.to_string())?;
  let parsed: PluginManifestDisk = serde_json::from_str(&encoded).map_err(|error| error.to_string())?;

  if parsed.id != plugin_id {
    let reason = "Plugin id does not match manifest id.".to_string();
    let _ = append_plugin_audit_event(
      &app,
      "plugin_tool_execution_blocked",
      serde_json::json!({
        "pluginId": plugin_id,
        "toolId": tool_id,
        "manifestPath": manifest_path,
        "reason": reason,
        "trust": "failed"
      }),
    );
    return Err(reason);
  }

  let plugin_permissions = parsed.permissions.unwrap_or_default();
  if !plugin_permissions.iter().any(|permission| permission == "tools.execute") {
    let reason = "Plugin manifest missing tools.execute permission.".to_string();
    let _ = append_plugin_audit_event(
      &app,
      "plugin_tool_execution_blocked",
      serde_json::json!({
        "pluginId": plugin_id,
        "toolId": tool_id,
        "manifestPath": manifest_path,
        "reason": reason,
        "trust": "failed"
      }),
    );
    return Err(reason);
  }

  let tools = parsed.tools.unwrap_or_default();
  let tool = tools.into_iter().find(|item| item.id == tool_id).ok_or_else(|| "Tool id not found in manifest.".to_string())?;
  let tool_permissions = tool.permissions.unwrap_or_default();
  if !tool_permissions.iter().any(|permission| permission == "command.execute") {
    let reason = "Plugin tool missing command.execute permission.".to_string();
    let _ = append_plugin_audit_event(
      &app,
      "plugin_tool_execution_blocked",
      serde_json::json!({
        "pluginId": plugin_id,
        "toolId": tool_id,
        "manifestPath": manifest_path,
        "reason": reason,
        "trust": "failed"
      }),
    );
    return Err(reason);
  }

  if !allowed_program(&tool.program) {
    let reason = "Plugin tool program is blocked by supervised command policy.".to_string();
    let _ = append_plugin_audit_event(
      &app,
      "plugin_tool_execution_blocked",
      serde_json::json!({
        "pluginId": plugin_id,
        "toolId": tool_id,
        "manifestPath": manifest_path,
        "program": tool.program,
        "reason": reason,
        "trust": "failed"
      }),
    );
    return Err(reason);
  }

  let mut args = tool.args.unwrap_or_default();
  args.extend(extra);
  let cwd = resolve_plugin_cwd(&manifest_path_buf, &tool.cwd, &workspace_root)?;

  let mut command = Command::new(&tool.program);
  command.args(&args);
  if let Some(dir) = &cwd {
    command.current_dir(dir);
  }

  let output = command.output().map_err(|error| error.to_string())?;
  let finished = now_ms();
  let success = output.status.success();

  let proof = PluginToolExecutionProof {
    plugin_id,
    tool_id,
    manifest_path,
    program: tool.program,
    args,
    cwd: cwd.map(|value| value.to_string_lossy().to_string()),
    started_at_ms: started,
    finished_at_ms: finished,
    success,
    exit_code: output.status.code(),
    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    trust: if success { "verified".to_string() } else { "failed".to_string() },
    error: None,
  };

  let _ = append_plugin_audit_event(
    &app,
    "plugin_tool_execution",
    serde_json::json!({
      "pluginId": &proof.plugin_id,
      "toolId": &proof.tool_id,
      "manifestPath": &proof.manifest_path,
      "program": &proof.program,
      "args": &proof.args,
      "cwd": &proof.cwd,
      "success": proof.success,
      "exitCode": proof.exit_code,
      "startedAtMs": proof.started_at_ms,
      "finishedAtMs": proof.finished_at_ms,
      "trust": &proof.trust
    }),
  );

  Ok(proof)
}

#[tauri::command]
fn run_ocr_adapter(
  adapter: Option<String>,
  engine_path: String,
  image_path: Option<String>,
  extra_args: Option<Vec<String>>,
) -> Result<OcrAdapterProof, String> {
  let started = now_ms();
  let adapter = adapter.unwrap_or_else(|| "version_check".to_string());
  let engine = PathBuf::from(&engine_path);
  if !engine.exists() || !engine.is_file() {
    return Ok(OcrAdapterProof {
      adapter,
      engine_path,
      image_path,
      started_at_ms: started,
      finished_at_ms: now_ms(),
      success: false,
      exit_code: None,
      stdout: String::new(),
      stderr: String::new(),
      trust: "failed".to_string(),
      error: Some("OCR engine binary path is invalid.".to_string()),
    });
  }

  let mut args = vec![];
  match adapter.as_str() {
    "version_check" => {
      args.push("--version".to_string());
    }
    "tesseract_cli" => {
      let image = image_path.clone().ok_or_else(|| "Image path is required for tesseract_cli adapter.".to_string())?;
      let image_file = PathBuf::from(&image);
      if !image_file.exists() || !image_file.is_file() {
        return Err("Image path does not exist.".to_string());
      }
      args.push(image);
      args.push("stdout".to_string());
      args.push("--dpi".to_string());
      args.push("70".to_string());
    }
    _ => {
      return Err("Unsupported OCR adapter. Supported adapters: version_check, tesseract_cli.".to_string());
    }
  }

  if let Some(extra) = extra_args {
    args.extend(extra);
  }

  let output = Command::new(&engine_path).args(&args).output().map_err(|error| error.to_string())?;
  let finished = now_ms();
  let success = output.status.success();

  Ok(OcrAdapterProof {
    adapter,
    engine_path,
    image_path,
    started_at_ms: started,
    finished_at_ms: finished,
    success,
    exit_code: output.status.code(),
    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    trust: if success { "verified".to_string() } else { "failed".to_string() },
    error: None,
  })
}

#[tauri::command]
fn collect_workspace_proof(root: String, max_files: Option<u64>) -> Result<WorkspaceProof, String> {
  let root_path = PathBuf::from(&root);
  let checked_at_ms = now_ms();

  if !root_path.exists() || !root_path.is_dir() {
    return Ok(WorkspaceProof {
      root,
      exists: false,
      file_count: 0,
      dir_count: 0,
      total_bytes: 0,
      sampled_files: vec![],
      symbol_hits: vec![],
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some("Workspace root does not exist or is not a directory.".to_string()),
    });
  }

  let limit = max_files.unwrap_or(1200) as usize;
  let mut stack = vec![root_path.clone()];
  let mut file_count = 0_u64;
  let mut dir_count = 0_u64;
  let mut total_bytes = 0_u64;
  let mut sampled_files: Vec<String> = vec![];
  let mut symbol_counts = [0_u64; 7];

  while let Some(dir) = stack.pop() {
    dir_count += 1;
    let entries = match fs::read_dir(&dir) {
      Ok(entries) => entries,
      Err(_) => continue,
    };

    for entry in entries.flatten() {
      let path = entry.path();
      let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        continue;
      };

      if path.is_dir() {
        if matches!(file_name, ".git" | "node_modules" | "target" | "dist") {
          continue;
        }
        stack.push(path);
        continue;
      }

      if !path.is_file() {
        continue;
      }

      file_count += 1;
      if let Ok(meta) = fs::metadata(&path) {
        total_bytes += meta.len();
      }

      if sampled_files.len() < 12 {
        sampled_files.push(path.to_string_lossy().to_string());
      }

      if (file_count as usize) > limit {
        break;
      }

      let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");
      if !matches!(extension, "js" | "jsx" | "ts" | "tsx" | "rs" | "py") {
        continue;
      }

      if let Ok(content) = fs::read_to_string(&path) {
        let next = symbol_counts_for_text(&content);
        for (index, value) in next.iter().enumerate() {
          symbol_counts[index] += value;
        }
      }
    }

    if (file_count as usize) > limit {
      break;
    }
  }

  let symbol_hits = symbol_hits_from_counts(symbol_counts);

  Ok(WorkspaceProof {
    root,
    exists: true,
    file_count,
    dir_count,
    total_bytes,
    sampled_files,
    symbol_hits,
    checked_at_ms,
    trust: "verified".to_string(),
    error: None,
  })
}

#[tauri::command]
fn check_ocr_capability(engine_path: Option<String>) -> OcrCapabilityProof {
  let checked_at_ms = now_ms();
  if let Some(path) = engine_path {
    let path_buf = PathBuf::from(&path);
    if path_buf.exists() && path_buf.is_file() {
      return OcrCapabilityProof {
        available: true,
        engine: "custom".to_string(),
        message: format!("OCR engine binary detected at {path}"),
        checked_at_ms,
        trust: "verified".to_string(),
      };
    }

    return OcrCapabilityProof {
      available: false,
      engine: "custom".to_string(),
      message: format!("OCR engine path does not exist: {path}"),
      checked_at_ms,
      trust: "failed".to_string(),
    };
  }

  OcrCapabilityProof {
    available: false,
    engine: "unconfigured".to_string(),
    message: "OCR engine is not configured yet. Set an engine path explicitly.".to_string(),
    checked_at_ms,
    trust: "unverified".to_string(),
  }
}

#[tauri::command]
fn get_memory_store_status(app: tauri::AppHandle) -> MemoryStoreStatus {
  let checked_at_ms = now_ms();
  match open_memory_db(&app) {
    Ok((conn, path)) => {
      let record_count = conn
        .query_row("SELECT COUNT(*) FROM memory_records", [], |row| row.get::<_, i64>(0))
        .unwrap_or(0)
        .max(0) as u64;
      let expired_count = conn
        .query_row(
          "SELECT COUNT(*) FROM memory_records WHERE expires_at IS NOT NULL AND expires_at < ?1",
          params![checked_at_ms as i64],
          |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as u64;
      MemoryStoreStatus {
        available: true,
        storage: "sqlite".to_string(),
        path: path.to_string_lossy().to_string(),
        schema_version: read_memory_schema_version(&conn),
        record_count,
        expired_count,
        checked_at_ms,
        trust: "verified".to_string(),
        error: None,
      }
    }
    Err(error) => MemoryStoreStatus {
      available: false,
      storage: "sqlite".to_string(),
      path: String::new(),
      schema_version: 0,
      record_count: 0,
      expired_count: 0,
      checked_at_ms,
      trust: "failed".to_string(),
      error: Some(error),
    },
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn initializes_memory_schema_with_migration_registry() {
    let conn = Connection::open_in_memory().expect("in-memory db");
    let version = initialize_memory_schema(&conn).expect("initialize schema");
    assert_eq!(version, MEMORY_SCHEMA_VERSION);

    let migration_count: i64 = conn
      .query_row("SELECT COUNT(*) FROM memory_schema_migrations", [], |row| row.get(0))
      .expect("migration count");
    assert_eq!(migration_count, 2);

    let meta_version = read_memory_schema_version(&conn);
    assert_eq!(meta_version, MEMORY_SCHEMA_VERSION);
  }

  // ── allowed_program ────────────────────────────────────────────────────────

  #[test]
  fn allowed_program_accepts_known_safe_programs() {
    assert!(allowed_program("ollama"), "ollama should be allowed");
    assert!(allowed_program("git"), "git should be allowed");
    assert!(allowed_program("node"), "node should be allowed");
    assert!(allowed_program("npm"), "npm should be allowed");
    assert!(allowed_program("npm.cmd"), "npm.cmd should be allowed");
    assert!(allowed_program("tasklist"), "tasklist should be allowed");
  }

  #[test]
  fn allowed_program_rejects_dangerous_programs() {
    assert!(!allowed_program("cmd"), "cmd should not be allowed");
    assert!(!allowed_program("cmd.exe"), "cmd.exe should not be allowed");
    assert!(!allowed_program("powershell"), "powershell should not be allowed");
    assert!(!allowed_program("bash"), "bash should not be allowed");
    assert!(!allowed_program("sh"), "sh should not be allowed");
    assert!(!allowed_program("rm"), "rm should not be allowed");
  }

  #[test]
  fn allowed_program_is_case_insensitive() {
    assert!(allowed_program("OLLAMA"), "OLLAMA (uppercase) should be allowed");
    assert!(allowed_program("Git"), "Git (mixed case) should be allowed");
    assert!(!allowed_program("CMD"), "CMD (uppercase) should not be allowed");
  }

  // ── plugin_blocked_token_present ──────────────────────────────────────────

  #[test]
  fn plugin_blocked_token_detects_shell_injection_tokens() {
    assert_eq!(plugin_blocked_token_present("foo && bar"), Some("&&"));
    assert_eq!(plugin_blocked_token_present("foo || bar"), Some("||"));
    assert_eq!(plugin_blocked_token_present("foo; bar"), Some(";"));
    assert_eq!(plugin_blocked_token_present("foo | bar"), Some("|"));
    assert_eq!(plugin_blocked_token_present("foo > out.txt"), Some(">"));
    assert_eq!(plugin_blocked_token_present("cat < file"), Some("<"));
    assert_eq!(plugin_blocked_token_present("$(whoami)"), Some("$("));
    assert_eq!(plugin_blocked_token_present("`id`"), Some("`"));
  }

  #[test]
  fn plugin_blocked_token_allows_clean_args() {
    assert_eq!(plugin_blocked_token_present("--output"), None);
    assert_eq!(plugin_blocked_token_present("/path/to/file"), None);
    assert_eq!(plugin_blocked_token_present("hello world"), None);
    assert_eq!(plugin_blocked_token_present(""), None);
  }

  // ── validate_plugin_extra_args ────────────────────────────────────────────

  #[test]
  fn validate_plugin_extra_args_rejects_too_many_args() {
    let args: Vec<String> = (0..9).map(|i| format!("arg{}", i)).collect();
    let result = validate_plugin_extra_args(&args);
    assert!(result.is_err(), "9 args should exceed the limit of 8");
    assert!(result.unwrap_err().contains("exceed supervised limit"));
  }

  #[test]
  fn validate_plugin_extra_args_rejects_oversized_arg() {
    let long_arg = "x".repeat(121);
    let result = validate_plugin_extra_args(&[long_arg]);
    assert!(result.is_err(), "arg of 121 chars should exceed the 120-char limit");
    assert!(result.unwrap_err().contains("exceeds supervised length limit"));
  }

  #[test]
  fn validate_plugin_extra_args_rejects_injection_token() {
    let result = validate_plugin_extra_args(&["--flag".to_string(), "foo && bar".to_string()]);
    assert!(result.is_err(), "arg with && should be rejected");
    assert!(result.unwrap_err().contains("blocked token"));
  }

  #[test]
  fn validate_plugin_extra_args_accepts_clean_args() {
    let args = vec!["--output".to_string(), "/tmp/out.txt".to_string(), "--verbose".to_string()];
    assert!(validate_plugin_extra_args(&args).is_ok(), "clean args should pass validation");
  }

  // ── trim_trailing_slashes ─────────────────────────────────────────────────

  #[test]
  fn trim_trailing_slashes_removes_trailing_slashes() {
    assert_eq!(trim_trailing_slashes("http://localhost:11434/"), "http://localhost:11434");
    assert_eq!(trim_trailing_slashes("http://localhost:11434///"), "http://localhost:11434");
    assert_eq!(trim_trailing_slashes("  http://localhost:11434/  "), "http://localhost:11434");
  }

  #[test]
  fn trim_trailing_slashes_leaves_clean_urls_unchanged() {
    assert_eq!(trim_trailing_slashes("http://localhost:11434"), "http://localhost:11434");
    assert_eq!(trim_trailing_slashes(""), "");
  }

  // ── WAL mode pragma round-trip ────────────────────────────────────────────

  #[test]
  fn wal_pragma_applies_on_in_memory_db() {
    let conn = Connection::open_in_memory().expect("in-memory db");
    // WAL mode is silently ignored on in-memory DBs (they use memory journal),
    // but the execute_batch must not return an error — this confirms the SQL is valid.
    let result = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    assert!(result.is_ok(), "WAL pragma should not error on in-memory db: {:?}", result);
  }

  // ── to_hex ────────────────────────────────────────────────────────────────

  #[test]
  fn to_hex_produces_correct_lowercase_hex() {
    assert_eq!(to_hex(&[0x00, 0xff, 0xab, 0x12]), "00ffab12");
    assert_eq!(to_hex(&[]), "");
    assert_eq!(to_hex(&[0x0a]), "0a");
  }
}

#[tauri::command]
fn upsert_memory_records(app: tauri::AppHandle, records: Vec<MemoryRecord>) -> Result<MemoryWriteProof, String> {
  let written_at_ms = now_ms();
  let (mut conn, path) = open_memory_db(&app)?;
  let tx = conn.transaction().map_err(|error| error.to_string())?;
  let mut written = 0_usize;

  for record in records.iter() {
    let content_json = serde_json::to_string(&record.content).map_err(|error| error.to_string())?;
    tx.execute(
      "
      INSERT OR REPLACE INTO memory_records (
        id, title, content_json, category, source_agent, source, timestamp_ms,
        confidence, verification_state, project_reference, expires_at, expiry_rule, updated_at_ms
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      ",
      params![
        &record.id,
        &record.title,
        content_json,
        &record.category,
        &record.source_agent,
        &record.source,
        record.timestamp_ms as i64,
        &record.confidence,
        &record.verification_state,
        record.project_reference.as_deref(),
        record.expires_at.map(|value| value as i64),
        record.expiry_rule.as_deref(),
        written_at_ms as i64,
      ],
    )
    .map_err(|error| error.to_string())?;
    written += 1;
  }

  tx.commit().map_err(|error| error.to_string())?;
  Ok(MemoryWriteProof {
    requested: records.len(),
    written,
    storage: "sqlite".to_string(),
    path: path.to_string_lossy().to_string(),
    written_at_ms,
    trust: "verified".to_string(),
  })
}

#[tauri::command]
fn list_memory_records(app: tauri::AppHandle, filters: Option<MemoryListFilters>) -> Result<Vec<MemoryRecord>, String> {
  let (conn, _) = open_memory_db(&app)?;
  let mut stmt = conn
    .prepare(
      "
      SELECT id, title, content_json, category, source_agent, source, timestamp_ms,
             confidence, verification_state, project_reference, expires_at, expiry_rule
      FROM memory_records
      ORDER BY timestamp_ms DESC
      LIMIT 1000
      ",
    )
    .map_err(|error| error.to_string())?;

  let rows = stmt.query_map([], row_to_memory).map_err(|error| error.to_string())?;
  let filters = filters.unwrap_or(MemoryListFilters {
    category: None,
    source_agent: None,
    confidence: None,
    project_reference: None,
  });
  let mut records = Vec::new();

  for row in rows {
    let record = row.map_err(|error| error.to_string())?;
    if let Some(category) = &filters.category {
      if category != "all" && &record.category != category {
        continue;
      }
    }
    if let Some(source_agent) = &filters.source_agent {
      if source_agent != "all" && &record.source_agent != source_agent {
        continue;
      }
    }
    if let Some(confidence) = &filters.confidence {
      if confidence != "all" && &record.confidence != confidence && &record.verification_state != confidence {
        continue;
      }
    }
    if let Some(project_reference) = &filters.project_reference {
      if !project_reference.trim().is_empty()
        && !record.project_reference.clone().unwrap_or_default().to_ascii_lowercase().contains(&project_reference.to_ascii_lowercase())
      {
        continue;
      }
    }
    records.push(record);
  }
  Ok(records)
}

#[tauri::command]
fn upsert_runtime_ledger_records(
  app: tauri::AppHandle,
  scope: String,
  records: Vec<RuntimeLedgerRecord>,
) -> Result<MemoryWriteProof, String> {
  let clean_scope = scope.trim().to_string();
  if clean_scope.is_empty() {
    return Err("runtime ledger scope is required".to_string());
  }

  let written_at_ms = now_ms();
  let (mut conn, path) = open_memory_db(&app)?;
  let tx = conn.transaction().map_err(|error| error.to_string())?;
  let mut written = 0_usize;

  for record in records.iter().take(5000) {
    let data_json = serde_json::to_string(&record.data).map_err(|error| error.to_string())?;
    tx.execute(
      "
      INSERT OR REPLACE INTO runtime_ledger (
        scope, id, data_json, status, confidence, verification_state, timestamp_ms, updated_at_ms
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ",
      params![
        &clean_scope,
        &record.id,
        data_json,
        &record.status,
        &record.confidence,
        &record.verification_state,
        record.timestamp_ms as i64,
        written_at_ms as i64,
      ],
    )
    .map_err(|error| error.to_string())?;
    written += 1;
  }

  tx.commit().map_err(|error| error.to_string())?;
  Ok(MemoryWriteProof {
    requested: records.len(),
    written,
    storage: "sqlite_runtime_ledger".to_string(),
    path: path.to_string_lossy().to_string(),
    written_at_ms,
    trust: "verified".to_string(),
  })
}

#[tauri::command]
fn list_runtime_ledger_records(
  app: tauri::AppHandle,
  scope: String,
  limit: Option<u32>,
) -> Result<Vec<RuntimeLedgerRecord>, String> {
  let clean_scope = scope.trim().to_string();
  if clean_scope.is_empty() {
    return Ok(vec![]);
  }
  let limit = limit.unwrap_or(1200).clamp(1, 5000) as i64;
  let (conn, _) = open_memory_db(&app)?;
  let mut stmt = conn
    .prepare(
      "
      SELECT id, data_json, status, confidence, verification_state, timestamp_ms
      FROM runtime_ledger
      WHERE scope = ?1
      ORDER BY timestamp_ms DESC
      LIMIT ?2
      ",
    )
    .map_err(|error| error.to_string())?;
  let rows = stmt
    .query_map(params![clean_scope, limit], row_to_runtime_record)
    .map_err(|error| error.to_string())?;
  let mut records = Vec::new();
  for row in rows {
    records.push(row.map_err(|error| error.to_string())?);
  }
  Ok(records)
}

#[tauri::command]
async fn fetch_research_sources(sources: Vec<ResearchSourceInput>) -> Vec<ResearchSourceProof> {
  let client = match reqwest::Client::builder()
    .timeout(Duration::from_secs(12))
    .redirect(reqwest::redirect::Policy::limited(5))
    .user_agent("Alphonso-Hector/0.1 local-first research verifier")
    .build()
  {
    Ok(client) => client,
    Err(error) => {
      return vec![ResearchSourceProof {
        url: String::new(),
        source_type: "unknown".to_string(),
        official: false,
        fetched_at_ms: now_ms(),
        http_status: None,
        ok: false,
        title: None,
        snippet: None,
        date_checked: unix_now_iso(),
        confidence: "failed".to_string(),
        risk_level: "medium".to_string(),
        verification_state: "failed".to_string(),
        error: Some(error.to_string()),
      }];
    }
  };

  let mut proofs = Vec::new();
  for source in sources.into_iter().take(10) {
    let fetched_at_ms = now_ms();
    let source_type = source.source_type.unwrap_or_else(|| "public_web".to_string());
    let official = source.official.unwrap_or(false);
    let risk_level = if official { "low" } else { "medium" }.to_string();
    let parsed = reqwest::Url::parse(source.url.trim());
    if parsed.as_ref().map(|url| url.scheme() != "http" && url.scheme() != "https").unwrap_or(true) {
      proofs.push(ResearchSourceProof {
        url: source.url,
        source_type,
        official,
        fetched_at_ms,
        http_status: None,
        ok: false,
        title: None,
        snippet: None,
        date_checked: unix_now_iso(),
        confidence: "failed".to_string(),
        risk_level,
        verification_state: "failed".to_string(),
        error: Some("Only http and https URLs are supported.".to_string()),
      });
      continue;
    }

    // Safety: the `continue` block above already handles every Err and non-http/https case.
    // If we reach this line, parsed is guaranteed Ok with a valid http(s) URL.
    let url = match parsed {
      Ok(u) => u,
      Err(_) => continue, // defensive fallback; should be unreachable due to guard above
    };
    match client.get(url.clone()).send().await {
      Ok(response) => {
        let status = response.status();
        match response.bytes().await {
          Ok(bytes) => {
            let max_len = bytes.len().min(200_000);
            let body = String::from_utf8_lossy(&bytes[..max_len]).to_string();
            let title = extract_title(&body);
            let text = strip_html_tags(&body);
            let snippet = if text.is_empty() {
              None
            } else {
              Some(text.chars().take(420).collect::<String>())
            };
            proofs.push(ResearchSourceProof {
              url: url.to_string(),
              source_type,
              official,
              fetched_at_ms,
              http_status: Some(status.as_u16()),
              ok: status.is_success(),
              title,
              snippet,
              date_checked: unix_now_iso(),
              confidence: if status.is_success() { "verified".to_string() } else { "failed".to_string() },
              risk_level,
              verification_state: if status.is_success() { "verified".to_string() } else { "failed".to_string() },
              error: if status.is_success() { None } else { Some(format!("HTTP status {}", status.as_u16())) },
            });
          }
          Err(error) => proofs.push(ResearchSourceProof {
            url: url.to_string(),
            source_type,
            official,
            fetched_at_ms,
            http_status: Some(status.as_u16()),
            ok: false,
            title: None,
            snippet: None,
            date_checked: unix_now_iso(),
            confidence: "failed".to_string(),
            risk_level,
            verification_state: "failed".to_string(),
            error: Some(error.to_string()),
          }),
        }
      }
      Err(error) => proofs.push(ResearchSourceProof {
        url: url.to_string(),
        source_type,
        official,
        fetched_at_ms,
        http_status: None,
        ok: false,
        title: None,
        snippet: None,
        date_checked: unix_now_iso(),
        confidence: "failed".to_string(),
        risk_level,
        verification_state: "failed".to_string(),
        error: Some(error.to_string()),
      }),
    }
  }

  proofs
}

#[tauri::command]
async fn search_research_sources(request: ResearchSearchInput) -> Result<Vec<ResearchSearchResult>, String> {
  let query = request.query.trim().to_string();
  if query.is_empty() {
    return Ok(vec![]);
  }
  let source_type = request.source_type.unwrap_or_else(|| "official_docs".to_string());
  let limit = request.limit.unwrap_or(6).clamp(1, 12) as usize;

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(14))
    .redirect(reqwest::redirect::Policy::limited(5))
    .user_agent("Alphonso-Hector/0.1 local-first research discovery")
    .build()
    .map_err(|error| error.to_string())?;

  let response = client
    .get("https://html.duckduckgo.com/html/")
    .query(&[("q", query.as_str()), ("kl", "us-en"), ("kp", "-1")])
    .header("Accept", "text/html,application/xhtml+xml")
    .header("Referer", "https://html.duckduckgo.com/")
    .send()
    .await
    .map_err(|error| format!("DuckDuckGo HTML request failed: {error}"))?;

  let status = response.status();
  if !status.is_success() {
    return Err(format!("DuckDuckGo HTML request returned HTTP {}", status.as_u16()));
  }

  let html = response.text().await.map_err(|error| error.to_string())?;
  Ok(parse_ddg_results(&html, &source_type, limit))
}

#[tauri::command]
async fn search_brave_sources(query: String, limit: Option<u8>, source_type: Option<String>) -> Result<Vec<ResearchSearchResult>, String> {
  let query = query.trim().to_string();
  if query.is_empty() {
    return Ok(vec![]);
  }
  let api_key = std::env::var("BRAVE_SEARCH_API_KEY")
    .map_err(|_| "BRAVE_SEARCH_API_KEY not set".to_string())?;
  let api_key = api_key.trim().to_string();
  if api_key.is_empty() {
    return Err("BRAVE_SEARCH_API_KEY is empty".to_string());
  }
  let count = limit.unwrap_or(8).clamp(1, 20);
  let src_type = source_type.unwrap_or_else(|| "official_docs".to_string());

  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(14))
    .user_agent("Alphonso-Hector/0.1 local-first research discovery")
    .build()
    .map_err(|e| e.to_string())?;

  let response = client
    .get("https://api.search.brave.com/res/v1/web/search")
    .query(&[
      ("q", query.as_str()),
      ("count", &count.to_string()),
      ("country", "us"),
      ("search_lang", "en"),
      ("safesearch", "moderate"),
    ])
    .header("Accept", "application/json")
    .header("Accept-Encoding", "gzip")
    .header("X-Subscription-Token", api_key.as_str())
    .send()
    .await
    .map_err(|e| format!("Brave Search request failed: {e}"))?;

  let status = response.status();
  if !status.is_success() {
    return Err(format!("Brave Search returned HTTP {}", status.as_u16()));
  }

  let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
  let raw_results = body
    .get("web")
    .and_then(|w| w.get("results"))
    .and_then(|r| r.as_array())
    .cloned()
    .unwrap_or_default();

  let results = raw_results
    .iter()
    .filter_map(|item| {
      let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
      if url.is_empty() { return None; }
      let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled").chars().take(180).collect::<String>();
      let snippet = item.get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.chars().take(320).collect::<String>());
      Some(ResearchSearchResult {
        url,
        title,
        snippet,
        source_type: src_type.clone(),
        provider: "brave_search".to_string(),
        date_checked: unix_now_iso(),
        confidence: "inferred".to_string(),
        risk_level: "medium".to_string(),
        verification_state: "inferred".to_string(),
      })
    })
    .take(count as usize)
    .collect();

  Ok(results)
}

#[tauri::command]
fn build_workspace_symbol_index(root: String, max_files: Option<u64>) -> Result<WorkspaceSymbolIndex, String> {
  let root_path = PathBuf::from(&root);
  let generated_at_ms = now_ms();
  let max_files = max_files.unwrap_or(500);

  if !root_path.exists() || !root_path.is_dir() {
    return Ok(WorkspaceSymbolIndex {
      root,
      generated_at_ms,
      max_files,
      files_indexed: 0,
      totals: vec![],
      dependency_edges: 0,
      files: vec![],
      trust: "failed".to_string(),
      error: Some("Workspace root does not exist or is not a directory.".to_string()),
    });
  }

  let mut stack = vec![root_path.clone()];
  let mut files: Vec<FileSymbolSummary> = vec![];
  let mut total_counts = [0_u64; 7];
  let mut dependency_edges = 0_usize;

  while let Some(dir) = stack.pop() {
    let entries = match fs::read_dir(&dir) {
      Ok(entries) => entries,
      Err(_) => continue,
    };

    for entry in entries.flatten() {
      let path = entry.path();
      let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        continue;
      };

      if path.is_dir() {
        if matches!(file_name, ".git" | "node_modules" | "target" | "dist") {
          continue;
        }
        stack.push(path);
        continue;
      }

      if !path.is_file() {
        continue;
      }

      let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");
      if !matches!(extension, "js" | "jsx" | "ts" | "tsx" | "rs" | "py") {
        continue;
      }

      if files.len() >= max_files as usize {
        break;
      }

      let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => continue,
      };
      let counts = symbol_counts_for_text(&content);
      let language = language_for_extension(extension);
      let dependencies = extract_dependencies(&content, &language);
      dependency_edges += dependencies.len();
      for (index, value) in counts.iter().enumerate() {
        total_counts[index] += value;
      }

      let bytes = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
      files.push(FileSymbolSummary {
        path: path.to_string_lossy().to_string(),
        language,
        bytes,
        symbol_hits: symbol_hits_from_counts(counts),
        dependencies,
        trust: "verified".to_string(),
      });
    }

    if files.len() >= max_files as usize {
      break;
    }
  }

  Ok(WorkspaceSymbolIndex {
    root,
    generated_at_ms,
    max_files,
    files_indexed: files.len() as u64,
    totals: symbol_hits_from_counts(total_counts),
    dependency_edges,
    files,
    trust: "verified".to_string(),
    error: None,
  })
}

fn readiness_surface_for_path(path: &Path) -> String {
  let lower = path.to_string_lossy().to_ascii_lowercase();
  if lower.contains("connector") || lower.contains("webhook") {
    return "connector".to_string();
  }
  if lower.contains("workflow") || lower.contains("receipt") || lower.contains("approval") {
    return "workflow".to_string();
  }
  if lower.contains("update") || lower.contains("release") || lower.contains("updater") || lower.contains("latest.json") {
    return "release".to_string();
  }
  if lower.contains("memory") || lower.contains("ledger") {
    return "memory".to_string();
  }
  if lower.contains("security") || lower.contains("auth") || lower.contains("policy") || lower.contains("signature") {
    return "security".to_string();
  }
  if lower.contains("component") || lower.contains("app.jsx") || lower.contains("panel") || lower.contains("view") {
    return "ui".to_string();
  }
  if lower.ends_with(".md") || lower.contains("docs") {
    return "docs".to_string();
  }
  "other".to_string()
}

fn readiness_file_extension(path: &Path) -> String {
  path.extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_ascii_lowercase()
}

fn readiness_scan_timed_out(started_at_ms: u64) -> bool {
  now_ms().saturating_sub(started_at_ms) > 90_000
}

fn readiness_path_contains_segment(path: &Path, segment: &str) -> bool {
  path.components().any(|component| {
    component
      .as_os_str()
      .to_string_lossy()
      .eq_ignore_ascii_case(segment)
  })
}

fn readiness_should_skip_path(path: &Path, file_name: &str) -> bool {
  let path_lower = path.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
  matches!(
    file_name,
    ".git"
      | "node_modules"
      | "target"
      | "dist"
      | "release"
      | "package-lock.json"
      | "yarn.lock"
      | "pnpm-lock.yaml"
      | "Cargo.lock"
  ) || readiness_path_contains_segment(path, ".git")
    || readiness_path_contains_segment(path, "node_modules")
    || readiness_path_contains_segment(path, "target")
    || readiness_path_contains_segment(path, "dist")
    || path_lower.contains("/release/rc0/")
    || path_lower.contains("/docs/handoff")
    || path_lower.contains("/src-tauri/gen/")
    || path_lower.contains("/generated/")
}

fn readiness_is_allowed_top_level_dir(file_name: &str) -> bool {
  matches!(file_name, "src" | "src-tauri" | "scripts" | "gateway" | "docs")
}

fn readiness_proof_scan_targets(root: &Path) -> Vec<PathBuf> {
  let targets = [
    "src/App.jsx",
    "src/components/EcosystemHub.jsx",
    "src/components/ProductionReadinessPanel.jsx",
    "src/components/SelfDevelopmentPanel.jsx",
    "src/components/OperatorDashboard.jsx",
    "src/services/nativeRc0ProofService.js",
    "src/services/nativeSelfDevelopmentAutostartService.js",
    "src/services/connectorRegistryService.js",
    "src/services/repoAuditService.js",
    "src/services/devPacketService.js",
    "src/services/selfDevelopmentService.js",
    "src/services/workflowExecutionService.js",
    "src/services/workflowReceiptService.js",
    "src/services/workflowMemoryService.js",
    "src/services/runtimeLedgerService.js",
    "src/services/productionReadinessService.js",
    "src/services/workspaceRootService.js",
    "scripts/proof-native-selfdev.mjs",
    "scripts/setup-updater-signing.mjs",
    "scripts/verify-updater-readiness.mjs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/native_proof.rs",
    "gateway/whatsapp-cloud/src/server.js",
    "gateway/whatsapp-cloud/src/verify.js",
    "gateway/whatsapp-cloud/src/normalize.js",
    "gateway/whatsapp-cloud/src/forward.js",
    "docs/UPDATER_SIGNING_SETUP.md",
  ];

  targets.iter().map(|relative| root.join(relative)).collect()
}

fn scan_readiness_target_paths(
  root: &Path,
  target_paths: Vec<PathBuf>,
  generated_at_ms: u64,
  max_files: usize,
  max_findings: usize,
) -> Result<WorkspaceReadinessScan, String> {
  let mut files_scanned = 0_u64;
  let mut findings: Vec<WorkspaceReadinessFinding> = vec![];
  let mut placeholder_count = 0_u64;
  let mut todo_count = 0_u64;
  let mut setup_required_count = 0_u64;
  let mut blocked_count = 0_u64;
  let failed_count = 0_u64;
  let mut partial_count = 0_u64;
  let scan_started_at_ms = generated_at_ms;

  for path in target_paths {
    if readiness_scan_timed_out(scan_started_at_ms) || findings.len() >= max_findings || files_scanned as usize >= max_files {
      return Ok(WorkspaceReadinessScan {
        root: root.to_string_lossy().to_string(),
        generated_at_ms,
        files_scanned,
        findings,
        placeholder_count,
        todo_count,
        setup_required_count,
        blocked_count,
        failed_count,
        partial_count,
        trust: "partial".to_string(),
        error: Some("Readiness scan time budget reached before proof surface completed.".to_string()),
      });
    }

    if !path.exists() || !path.is_file() {
      continue;
    }

    if readiness_should_skip_path(&path, path.file_name().and_then(|name| name.to_str()).unwrap_or("")) {
      continue;
    }

    let progress = NativeProofStageProof {
      stage: "08_scan_progress".to_string(),
      status: "running".to_string(),
      timestamp: format!("{}", now_ms()),
      process_id: std::process::id(),
      workspace_root: root.to_string_lossy().to_string(),
      output_dir: "release/rc0".to_string(),
      proof_request_found: true,
      window_label: None,
      note: Some(format!("Scanning proof surface file: {}", path.to_string_lossy())),
      error: None,
      duration_ms: None,
    };
    let _ = write_native_proof_stage(Path::new("release/rc0"), "08_scan_progress.json", &progress);

    let extension = readiness_file_extension(&path);
    if !matches!(
      extension.as_str(),
      "js" | "jsx" | "ts" | "tsx" | "rs" | "mjs" | "cjs" | "md" | "toml" | "json" | "yml" | "yaml" | "css" | "html"
    ) {
      continue;
    }

    if let Ok(metadata) = fs::metadata(&path) {
      const MAX_READY_SCAN_BYTES: u64 = 512 * 1024;
      if metadata.len() > MAX_READY_SCAN_BYTES {
        continue;
      }
    }

    files_scanned += 1;
    if files_scanned as usize > max_files {
      break;
    }

    let content = match fs::read_to_string(&path) {
      Ok(content) => content,
      Err(_) => continue,
    };

    if readiness_scan_timed_out(scan_started_at_ms) {
      return Ok(WorkspaceReadinessScan {
        root: root.to_string_lossy().to_string(),
        generated_at_ms,
        files_scanned,
        findings,
        placeholder_count,
        todo_count,
        setup_required_count,
        blocked_count,
        failed_count,
        partial_count,
        trust: "partial".to_string(),
        error: Some("Readiness scan time budget reached after reading a proof surface file.".to_string()),
      });
    }

    for (line_index, line) in content.lines().enumerate() {
      if findings.len() >= max_findings {
        break;
      }

      let Some((needle, kind, priority, severity)) = readiness_keyword_match(line) else {
        continue;
      };

      let line_number = (line_index + 1) as u64;
      let message = if needle == "setup required" || needle == "setup-required" {
        "Setup-required surface should be labeled clearly and backed by real checks.".to_string()
      } else if kind == "missing_approval" {
        "Approval gate is missing or not enforced; add Jose approval or truth-label the action.".to_string()
      } else if kind == "missing_receipt" {
        "Receipt-backed evidence is missing for a production-facing action.".to_string()
      } else if kind == "updater_blocker" {
        "Updater or release path is blocked and should not imply completion.".to_string()
      } else if kind == "connector_blocker" {
        "Connector path is blocked and should be marked setup_required until real provider proof exists.".to_string()
      } else if kind == "not_wired" {
        "Surface is explicitly marked as not wired; keep it disabled or implement the real path.".to_string()
      } else if kind == "fake" || kind == "simulation" {
        "Production-facing surface should not imply fake or simulated execution.".to_string()
      } else if kind == "placeholder" || kind == "scaffold" || kind == "demo" || kind == "mock" {
        "Production-facing surface should be replaced with real behavior or explicitly setup-required state.".to_string()
      } else {
        "Code review marker remains in the workspace and should be resolved or tracked.".to_string()
      };

      findings.push(WorkspaceReadinessFinding {
        id: format!("ready-{}-{}-{}", findings.len() + 1, files_scanned, line_number),
        path: path.to_string_lossy().to_string(),
        line_number,
        surface: readiness_surface_for_path(&path),
        kind: kind.to_string(),
        priority: priority.to_string(),
        severity: severity.to_string(),
        message,
        excerpt: line.trim().chars().take(180).collect(),
      });

      match kind {
        "placeholder" | "scaffold" | "demo" | "mock" | "not_wired" | "fake" | "simulated" => {
          placeholder_count += 1;
        }
        "todo" => {
          todo_count += 1;
        }
        "setup_required" => {
          setup_required_count += 1;
        }
        _ => {}
      }

      if priority == "P0" {
        blocked_count += 1;
      } else if priority == "P1" {
        partial_count += 1;
      }
    }

    if findings.len() >= max_findings || files_scanned as usize > max_files {
      break;
    }
  }

  let trust = if blocked_count > 0 {
    "failed"
  } else if placeholder_count > 0 || setup_required_count > 0 {
    "partial"
  } else {
    "verified"
  }
  .to_string();

  Ok(WorkspaceReadinessScan {
    root: root.to_string_lossy().to_string(),
    generated_at_ms,
    files_scanned,
    findings,
    placeholder_count,
    todo_count,
    setup_required_count,
    blocked_count,
    failed_count,
    partial_count,
    trust,
    error: None,
  })
}

fn readiness_keyword_match(line: &str) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
  let lower = line.to_ascii_lowercase();
  let patterns = [
    ("missing approval", "missing_approval", "P0", "P0"),
    ("approval gate", "missing_approval", "P0", "P0"),
    ("missing receipt", "missing_receipt", "P0", "P0"),
    ("receipt missing", "missing_receipt", "P0", "P0"),
    ("updater blocker", "updater_blocker", "P0", "P0"),
    ("release blocker", "updater_blocker", "P0", "P0"),
    ("connector blocker", "connector_blocker", "P0", "P0"),
    ("not wired", "not_wired", "P0", "P0"),
    ("fake success", "fake", "P0", "P0"),
    ("fake", "fake", "P0", "P0"),
    ("simulated", "simulation", "P0", "P0"),
    ("simulation", "simulation", "P0", "P0"),
    ("placeholder-only", "placeholder", "P1", "P1"),
    ("placeholder only", "placeholder", "P1", "P1"),
    ("placeholder", "placeholder", "P1", "P1"),
    ("scaffold", "scaffold", "P1", "P1"),
    ("demo-only", "demo", "P1", "P1"),
    ("demo", "demo", "P1", "P1"),
    ("mock", "mock", "P1", "P1"),
    ("setup-required", "setup_required", "P1", "P1"),
    ("setup required", "setup_required", "P1", "P1"),
    ("todo", "todo", "P2", "P2"),
    ("fixme", "fixme", "P2", "P2"),
  ];

  patterns
    .into_iter()
    .find(|(needle, _, _, _)| lower.contains(needle))
    .map(|(needle, kind, priority, severity)| (needle, kind, priority, severity))
}

#[tauri::command]
fn scan_workspace_readiness(
  root: String,
  max_files: Option<u64>,
  max_findings: Option<u64>,
  proof_mode: Option<bool>,
) -> Result<WorkspaceReadinessScan, String> {
  let root_path = PathBuf::from(&root);
  let generated_at_ms = now_ms();
  let scan_started_at_ms = generated_at_ms;
  let max_files = max_files.unwrap_or(1200) as usize;
  let max_findings = max_findings.unwrap_or(240) as usize;
  let proof_mode = proof_mode.unwrap_or(false)
    || std::env::var("ALPHONSO_RC0_PROOF")
      .map(|value| value.trim() == "1")
      .unwrap_or(false)
    || std::env::var("ALPHONSO_SELFDEV_AUTORUN")
      .map(|value| value.trim() == "1")
      .unwrap_or(false);

  if !root_path.exists() || !root_path.is_dir() {
    return Ok(WorkspaceReadinessScan {
      root,
      generated_at_ms,
      files_scanned: 0,
      findings: vec![],
      placeholder_count: 0,
      todo_count: 0,
      setup_required_count: 0,
      blocked_count: 0,
      failed_count: 0,
      partial_count: 0,
      trust: "failed".to_string(),
      error: Some("Workspace root does not exist or is not a directory.".to_string()),
    });
  }

  if proof_mode {
    let proof_start = NativeProofStageProof {
      stage: "08_scan_progress".to_string(),
      status: "running".to_string(),
      timestamp: format!("{}", now_ms()),
      process_id: std::process::id(),
      workspace_root: root_path.display().to_string(),
      output_dir: "release/rc0".to_string(),
      proof_request_found: true,
      window_label: None,
      note: Some("Native proof scan branch entered.".to_string()),
      error: None,
      duration_ms: None,
    };
    let _ = write_native_proof_stage(Path::new("release/rc0"), "08_scan_progress.json", &proof_start);
    return scan_readiness_target_paths(
      &root_path,
      readiness_proof_scan_targets(&root_path),
      generated_at_ms,
      max_files.min(80),
      max_findings,
    );
  }

  let mut stack = vec![root_path.clone()];
  let mut files_scanned = 0_u64;
  let mut findings: Vec<WorkspaceReadinessFinding> = vec![];
  let mut placeholder_count = 0_u64;
  let mut todo_count = 0_u64;
  let mut setup_required_count = 0_u64;
  let mut blocked_count = 0_u64;
  let mut failed_count = 0_u64;
  let mut partial_count = 0_u64;

  while let Some(dir) = stack.pop() {
    if readiness_scan_timed_out(scan_started_at_ms) {
      return Ok(WorkspaceReadinessScan {
        root,
        generated_at_ms,
        files_scanned,
        findings,
        placeholder_count,
        todo_count,
        setup_required_count,
        blocked_count,
        failed_count,
        partial_count,
        trust: "partial".to_string(),
        error: Some("Readiness scan time budget reached before traversal completed.".to_string()),
      });
    }

    if files_scanned as usize >= max_files {
      return Ok(WorkspaceReadinessScan {
        root,
        generated_at_ms,
        files_scanned,
        findings,
        placeholder_count,
        todo_count,
        setup_required_count,
        blocked_count,
        failed_count,
        partial_count,
        trust: "partial".to_string(),
        error: Some(format!("Readiness scan stopped after max_files={max_files}.")),
      });
    }

    let entries = match fs::read_dir(&dir) {
      Ok(entries) => entries,
      Err(_) => continue,
    };
    let is_root_dir = dir == root_path;

    for entry in entries.flatten() {
      if readiness_scan_timed_out(scan_started_at_ms) {
        return Ok(WorkspaceReadinessScan {
          root,
          generated_at_ms,
          files_scanned,
          findings,
          placeholder_count,
          todo_count,
          setup_required_count,
          blocked_count,
          failed_count,
          partial_count,
          trust: "partial".to_string(),
          error: Some("Readiness scan time budget reached before traversal completed.".to_string()),
        });
      }

      let path = entry.path();
      let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        continue;
      };

      if let Ok(file_type) = entry.file_type() {
        if file_type.is_symlink() {
          continue;
        }
      }

      if path.is_dir() {
        if readiness_should_skip_path(&path, file_name) {
          continue;
        }
        if is_root_dir && !readiness_is_allowed_top_level_dir(file_name) {
          continue;
        }
        stack.push(path);
        continue;
      }

      if !path.is_file() {
        continue;
      }

      if readiness_should_skip_path(&path, file_name) {
        continue;
      }

      let extension = readiness_file_extension(&path);
      if !matches!(
        extension.as_str(),
        "js" | "jsx" | "ts" | "tsx" | "rs" | "mjs" | "cjs" | "md" | "toml" | "json" | "yml" | "yaml" | "css" | "html"
      ) {
        continue;
      }

      if let Ok(metadata) = entry.metadata() {
        const MAX_READY_SCAN_BYTES: u64 = 512 * 1024;
        if metadata.len() > MAX_READY_SCAN_BYTES {
          continue;
        }
      }

      if files_scanned as usize >= max_files {
        return Ok(WorkspaceReadinessScan {
          root,
          generated_at_ms,
          files_scanned,
          findings,
          placeholder_count,
          todo_count,
          setup_required_count,
          blocked_count,
          failed_count,
          partial_count,
          trust: "partial".to_string(),
          error: Some(format!("Readiness scan stopped after max_files={max_files}.")),
        });
      }

      files_scanned += 1;

      let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => continue,
      };

      if readiness_scan_timed_out(scan_started_at_ms) {
        return Ok(WorkspaceReadinessScan {
          root,
          generated_at_ms,
          files_scanned,
          findings,
          placeholder_count,
          todo_count,
          setup_required_count,
          blocked_count,
          failed_count,
          partial_count,
          trust: "partial".to_string(),
          error: Some("Readiness scan time budget reached after reading a file batch.".to_string()),
        });
      }

      for (line_index, line) in content.lines().enumerate() {
        if findings.len() >= max_findings {
          break;
        }

        let Some((needle, kind, priority, severity)) = readiness_keyword_match(line) else {
          continue;
        };

        let line_number = (line_index + 1) as u64;
        let message = if needle == "setup required" || needle == "setup-required" {
          "Setup-required surface should be labeled clearly and backed by real checks.".to_string()
        } else if kind == "missing_approval" {
          "Approval gate is missing or not enforced; add Jose approval or truth-label the action.".to_string()
        } else if kind == "missing_receipt" {
          "Receipt-backed evidence is missing for a production-facing action.".to_string()
        } else if kind == "updater_blocker" {
          "Updater or release path is blocked and should not imply completion.".to_string()
        } else if kind == "connector_blocker" {
          "Connector path is blocked and should be marked setup_required until real provider proof exists.".to_string()
        } else if kind == "not_wired" {
          "Surface is explicitly marked as not wired; keep it disabled or implement the real path.".to_string()
        } else if kind == "fake" || kind == "simulation" {
          "Production-facing surface should not imply fake or simulated execution.".to_string()
        } else if kind == "placeholder" || kind == "scaffold" || kind == "demo" || kind == "mock" {
          "Production-facing surface should be replaced with real behavior or explicitly setup-required state.".to_string()
        } else {
          "Code review marker remains in the workspace and should be resolved or tracked.".to_string()
        };

        findings.push(WorkspaceReadinessFinding {
          id: format!("ready-{}-{}-{}", findings.len() + 1, files_scanned, line_number),
          path: path.to_string_lossy().to_string(),
          line_number,
          surface: readiness_surface_for_path(&path),
          kind: kind.to_string(),
          priority: priority.to_string(),
          severity: severity.to_string(),
          message,
          excerpt: line.trim().chars().take(180).collect(),
        });

        match kind {
          "placeholder" | "scaffold" | "demo" | "mock" | "not_wired" | "fake" | "simulated" => {
            placeholder_count += 1;
          }
          "todo" => {
            todo_count += 1;
          }
          "setup_required" => {
            setup_required_count += 1;
          }
          _ => {}
        }

        if priority == "P0" {
          blocked_count += 1;
        } else if priority == "P1" {
          partial_count += 1;
        } else if priority == "P2" && kind == "todo" {
          failed_count += 0;
        }
      }

      if findings.len() >= max_findings || files_scanned as usize >= max_files {
        break;
      }
    }

    if findings.len() >= max_findings || files_scanned as usize >= max_files {
      break;
    }
  }

  let trust = if blocked_count > 0 {
    "failed"
  } else if placeholder_count > 0 || setup_required_count > 0 {
    "partial"
  } else {
    "verified"
  }
  .to_string();

  Ok(WorkspaceReadinessScan {
    root,
    generated_at_ms,
    files_scanned,
    findings,
    placeholder_count,
    todo_count,
    setup_required_count,
    blocked_count,
    failed_count,
    partial_count,
    trust,
    error: None,
  })
}

#[tauri::command]
fn send_app_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
  use tauri_plugin_notification::NotificationExt;
  app.notification()
    .builder()
    .title(&title)
    .body(&body)
    .show()
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn inspect_updater_release(bundle_dir: String, manifest_dir: String) -> Result<ReleaseArtifactProof, String> {
  let bundle_path = PathBuf::from(&bundle_dir);
  let manifest_path = PathBuf::from(&manifest_dir).join("latest.json");

  if !bundle_path.exists() || !bundle_path.is_dir() {
    return Ok(ReleaseArtifactProof {
      bundle_dir,
      manifest_dir,
      installer_path: None,
      installer_found: false,
      signature_path: None,
      signature_found: false,
      latest_json_path: Some(manifest_path.to_string_lossy().to_string()),
      latest_json_found: manifest_path.exists(),
      manifest_valid: false,
      manifest_version: None,
      manifest_url: None,
      manifest_signature: None,
      trust: "failed".to_string(),
      error: Some("Updater bundle directory does not exist or is not a directory.".to_string()),
    });
  }

  let mut installer_candidates: Vec<(PathBuf, u64)> = vec![];
  for entry in fs::read_dir(&bundle_path).map_err(|error| error.to_string())? {
    let entry = entry.map_err(|error| error.to_string())?;
    let path = entry.path();
    if !path.is_file() {
      continue;
    }
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
    if !file_name.ends_with("-setup.exe") {
      continue;
    }
    let modified_at_ms = fs::metadata(&path)
      .ok()
      .and_then(|meta| meta.modified().ok())
      .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
      .map(|duration| duration.as_millis() as u64)
      .unwrap_or(0);
    installer_candidates.push((path, modified_at_ms));
  }
  installer_candidates.sort_by(|a, b| b.1.cmp(&a.1));

  let installer_path = installer_candidates.first().map(|(path, _)| path.clone());
  let signature_path = installer_path.as_ref().map(|path| PathBuf::from(format!("{}.sig", path.to_string_lossy())));
  let installer_found = installer_path
    .as_ref()
    .map(|path| path.exists() && path.is_file())
    .unwrap_or(false);
  let signature_found = signature_path
    .as_ref()
    .map(|path| path.exists() && path.is_file())
    .unwrap_or(false);
  let latest_json_found = manifest_path.exists() && manifest_path.is_file();

  let mut manifest_valid = false;
  let mut manifest_version = None;
  let mut manifest_url = None;
  let mut manifest_signature = None;
  let mut manifest_error = None;

  if latest_json_found {
    match fs::read_to_string(&manifest_path) {
      Ok(raw) => match serde_json::from_str::<Value>(&raw) {
        Ok(json) => {
          manifest_version = json.get("version").and_then(|value| value.as_str()).map(|value| value.to_string());
          let platform = json.get("platforms").and_then(|value| value.get("windows-x86_64"));
          manifest_signature = platform.and_then(|value| value.get("signature")).and_then(|value| value.as_str()).map(|value| value.to_string());
          manifest_url = platform.and_then(|value| value.get("url")).and_then(|value| value.as_str()).map(|value| value.to_string());
          manifest_valid = manifest_version.is_some()
            && manifest_signature.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false)
            && manifest_url.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false);
          if !manifest_valid {
            manifest_error = Some("latest.json is present but missing required version, url, or signature fields.".to_string());
          }
        }
        Err(error) => {
          manifest_error = Some(format!("latest.json could not be parsed: {error}"));
        }
      },
      Err(error) => {
        manifest_error = Some(format!("latest.json could not be read: {error}"));
      }
    }
  }

  let trust = if installer_found && signature_found && manifest_valid {
    "verified"
  } else if latest_json_found || installer_found || signature_found {
    "partial"
  } else {
    "failed"
  }
  .to_string();

  Ok(ReleaseArtifactProof {
    bundle_dir,
    manifest_dir,
    installer_path: installer_path.map(|path| path.to_string_lossy().to_string()),
    installer_found,
    signature_path: signature_path.map(|path| path.to_string_lossy().to_string()),
    signature_found,
    latest_json_path: Some(manifest_path.to_string_lossy().to_string()),
    latest_json_found,
    manifest_valid,
    manifest_version,
    manifest_url,
    manifest_signature,
    trust,
    error: manifest_error,
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  load_dotenv();
  // Shared HTTP client — built once at startup and stored in Tauri state.
  // All commands should prefer `state: tauri::State<'_, reqwest::Client>` over creating a new client per call.
  let http_client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .build()
    .expect("Failed to build shared HTTP client");
  tauri::Builder::default()
    .manage(http_client)
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
        let proof_output_dir = native_proof_output_dir();
        let proof_request = read_native_proof_request(&proof_output_dir);
        let workspace_root = native_workspace_root();
        let process_id = std::process::id();
        let timestamp = now_ms();
        let autorun_enabled = std::env::var("ALPHONSO_SELFDEV_AUTORUN")
          .map(|value| value.trim() == "1")
          .unwrap_or(false);
        let rc0_proof_enabled = std::env::var("ALPHONSO_RC0_PROOF")
          .map(|value| value.trim() == "1")
          .unwrap_or(false);
        let proof_requested = autorun_enabled || rc0_proof_enabled || proof_request.is_some();
        let env_missing_note = if autorun_enabled {
          None
        } else {
          Some("ALPHONSO_SELFDEV_AUTORUN is missing or not enabled in the native runtime.".to_string())
        };

        write_native_startup_trace(
          "setup_started",
          &workspace_root,
          Some("Rust setup hook executed before the webview loads."),
        );

        let process_started = NativeProofStageProof {
          stage: "01_process_started".to_string(),
          status: "running".to_string(),
          timestamp: format!("{}", timestamp),
          process_id,
          workspace_root: workspace_root.clone(),
          output_dir: proof_output_dir.display().to_string(),
          proof_request_found: proof_request.is_some(),
          window_label: None,
          note: None,
          error: None,
          duration_ms: None,
        };
        let env_detected = NativeProofStageProof {
          stage: "02_env_detected".to_string(),
          status: if proof_requested { "ready".to_string() } else { "setup_required".to_string() },
          timestamp: format!("{}", timestamp),
          process_id,
          workspace_root: workspace_root.clone(),
          output_dir: proof_output_dir.display().to_string(),
          proof_request_found: proof_request.is_some(),
          window_label: None,
          note: if proof_requested {
            Some("Native proof mode is enabled for this Tauri runtime.".to_string())
          } else {
            env_missing_note.clone()
          },
          error: if proof_requested { None } else { env_missing_note.clone() },
          duration_ms: None,
        };
        let tauri_started = NativeProofStageProof {
          stage: "03_tauri_started".to_string(),
          status: "running".to_string(),
          timestamp: format!("{}", now_ms()),
          process_id,
          workspace_root: workspace_root.clone(),
          output_dir: proof_output_dir.display().to_string(),
          proof_request_found: proof_request.is_some(),
          window_label: None,
          note: None,
          error: None,
          duration_ms: None,
        };
        let _ = write_native_proof_stage(&proof_output_dir, "01_process_started.json", &process_started);
        let _ = write_native_proof_stage(&proof_output_dir, "02_env_detected.json", &env_detected);
        let _ = write_native_proof_stage(&proof_output_dir, "03_tauri_started.json", &tauri_started);

        if proof_requested {
          let native_proof_started = NativeProofStageProof {
            stage: "05_native_proof_engine_started".to_string(),
            status: "running".to_string(),
            timestamp: format!("{}", now_ms()),
            process_id,
            workspace_root: workspace_root.clone(),
            output_dir: proof_output_dir.display().to_string(),
            proof_request_found: proof_request.is_some(),
            window_label: None,
            note: Some("Rust startup hook requested the native RC0 proof engine.".to_string()),
            error: None,
            duration_ms: None,
          };
          let _ = write_native_proof_stage(&proof_output_dir, "05_native_proof_engine_started.json", &native_proof_started);

          let validation_paths = vec![
            workspace_root.clone(),
            format!("{}/package.json", workspace_root),
            format!("{}/src", workspace_root),
            format!("{}/src-tauri", workspace_root),
            format!("{}/docs", workspace_root),
          ];
          let validation_proofs = verify_paths(validation_paths);
          let root_proof = validation_proofs.get(0).cloned();
          let entry_proofs = validation_proofs.into_iter().skip(1).collect::<Vec<_>>();
          let missing_entries = ["package.json", "src", "src-tauri", "docs"]
            .iter()
            .zip(entry_proofs.iter())
            .filter_map(|(entry, proof)| if proof.exists { None } else { Some((*entry).to_string()) })
            .collect::<Vec<_>>();
          let workspace_ok = root_proof.map(|proof| proof.exists && proof.is_dir).unwrap_or(false) && missing_entries.is_empty();
          let native_workspace_validated = NativeProofStageProof {
            stage: "06_workspace_validated".to_string(),
            status: if workspace_ok { "ready".to_string() } else { "setup_required".to_string() },
            timestamp: format!("{}", now_ms()),
            process_id,
            workspace_root: workspace_root.clone(),
            output_dir: proof_output_dir.display().to_string(),
            proof_request_found: proof_request.is_some(),
            window_label: None,
            note: Some(if workspace_ok {
              "Workspace root validated from the Rust startup hook.".to_string()
            } else {
              format!("Workspace validation is setup_required; missing entries: {}", missing_entries.join(", "))
            }),
            error: if workspace_ok {
              None
            } else {
              Some(format!("Workspace validation is setup_required; missing entries: {}", missing_entries.join(", ")))
            },
            duration_ms: None,
          };
          let _ = write_native_proof_stage(&proof_output_dir, "06_workspace_validated.json", &native_workspace_validated);
          let native_scan_started = NativeProofStageProof {
            stage: "07_scan_started".to_string(),
            status: if workspace_ok { "running".to_string() } else { "setup_required".to_string() },
            timestamp: format!("{}", now_ms()),
            process_id,
            workspace_root: workspace_root.clone(),
            output_dir: proof_output_dir.display().to_string(),
            proof_request_found: proof_request.is_some(),
            window_label: None,
            note: Some(if workspace_ok {
              "Rust startup hook scheduled the repository scan phase.".to_string()
            } else {
              "Repository scan remains setup_required until workspace validation passes.".to_string()
            }),
            error: if workspace_ok { None } else { Some("Workspace validation is setup_required.".to_string()) },
            duration_ms: None,
          };
          let _ = write_native_proof_stage(&proof_output_dir, "07_scan_started.json", &native_scan_started);
          start_native_rc0_proof_if_requested(
            workspace_root.clone(),
            proof_output_dir.display().to_string(),
            "automated".to_string(),
            Some(80),
          );
        }

        let proof_event_dir = proof_output_dir.clone();
        let _proof_event_listener_id = app.handle().listen("alphonso-native-proof-stage", move |event| {
          let payload = event.payload();
          if let Ok(value) = serde_json::from_str::<Value>(payload) {
            let _ = write_native_proof_event(&proof_event_dir, &value);
          }
        });

        let show_main_item = MenuItem::with_id(app, "show_main", "Open Alphonso", true, None::<&str>)?;
        let new_chat_item  = MenuItem::with_id(app, "new_chat",  "New Chat",      true, None::<&str>)?;
        let show_coach_item = MenuItem::with_id(app, "show_coach", "Show Coach", true, None::<&str>)?;
      let toggle_coach_item = MenuItem::with_id(app, "toggle_coach", "Toggle Coach", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit_app", "Quit Alphonso", true, None::<&str>)?;
      let tray_menu = Menu::with_items(app, &[&show_main_item, &new_chat_item, &show_coach_item, &toggle_coach_item, &quit_item])?;

      TrayIconBuilder::new()
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| {
          let event_id = event.id.as_ref();
          let _ = app_handle.emit("alphonso://tray_menu", event_id.to_string());

          match event_id {
            "show_main" => {
              if let Some(main_window) = app_handle.get_webview_window("main") {
                let _ = main_window.unminimize();
                let _ = main_window.show();
                let _ = main_window.set_focus();
              }
            }
            "new_chat" => {
              if let Some(main_window) = app_handle.get_webview_window("main") {
                let _ = main_window.unminimize();
                let _ = main_window.show();
                let _ = main_window.set_focus();
              }
              let _ = app_handle.emit("alphonso://new_chat", "tray");
            }
            "show_coach" => {
              if let Some(coach_window) = app_handle.get_webview_window("coach") {
                let _ = coach_window.show();
                let _ = coach_window.set_focus();
              }
            }
            "toggle_coach" => {
              let _ = app_handle.emit("alphonso://coach_toggle", "toggle".to_string());
            }
            "quit_app" => {
              app_handle.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app_handle = tray.app_handle();

            if let Some(main_window) = app_handle.get_webview_window("main") {
              let _ = main_window.unminimize();
              let _ = main_window.show();
              let _ = main_window.set_focus();
            }

            if let Some(coach_window) = app_handle.get_webview_window("coach") {
              let _ = coach_window.show();
              let _ = coach_window.set_focus();
            }
          }
        })
        .build(app)?;

      if proof_requested {
        if let Some(main_window) = app.get_webview_window("main") {
          let _ = main_window.unminimize();
          let _ = main_window.show();
          let _ = main_window.set_focus();
          let payload = NativeProofStageProof {
            stage: "04_frontend_loaded".to_string(),
            status: "window_visible".to_string(),
            timestamp: now_ms().to_string(),
            process_id: std::process::id(),
            workspace_root: workspace_root.clone(),
            output_dir: proof_output_dir.display().to_string(),
            proof_request_found: proof_request.is_some(),
            window_label: Some(main_window.label().to_string()),
            note: Some("Main window was shown during proof boot; frontend load is still being confirmed.".to_string()),
            error: None,
            duration_ms: None,
          };
          let _ = write_native_proof_stage(&proof_output_dir, "04_frontend_loaded.json", &payload);
        }
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Global hotkey: Ctrl+Shift+Space → show window + start voice input
      use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
      let shortcut: Shortcut = "Ctrl+Shift+Space".parse().unwrap_or_else(|_| "CommandOrControl+Shift+Space".parse().expect("fallback hotkey parse"));
      let app_handle_hs = app.handle().clone();
      app.handle().global_shortcut().on_shortcut(shortcut, move |_, _, event| {
        if event.state == ShortcutState::Pressed {
          if let Some(win) = app_handle_hs.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
          }
          let _ = app_handle_hs.emit("alphonso://voice_start", "hotkey");
        }
      })?;

      Ok(())
    })
    .on_page_load(|window, _payload| {
      let proof_output_dir = native_proof_output_dir();
      let payload = NativeProofStageProof {
        stage: "04_frontend_loaded".to_string(),
        status: "ready".to_string(),
        timestamp: now_ms().to_string(),
        process_id: std::process::id(),
        workspace_root: native_workspace_root(),
        output_dir: proof_output_dir.display().to_string(),
        proof_request_found: read_native_proof_request(&proof_output_dir).is_some(),
        window_label: Some(window.label().to_string()),
        note: Some("Page load observed for the native window.".to_string()),
        error: None,
        duration_ms: None,
      };
      write_native_startup_trace(
        "page_load",
        &window
          .app_handle()
          .path()
          .app_data_dir()
          .map(|path| path.display().to_string())
          .unwrap_or_else(|_| native_workspace_root()),
        Some("Tauri on_page_load observed the frontend mount."),
      );
      let _ = write_native_proof_stage(&proof_output_dir, "04_frontend_loaded.json", &payload);
    })
    .on_window_event(|window, event| {
      match event {
        WindowEvent::CloseRequested { api, .. } => {
          // Hide to tray instead of closing; "Quit Alphonso" in the tray menu exits for real.
          if window.label() == "main" {
            let _ = window.hide();
            api.prevent_close();
          }
        }
        WindowEvent::Focused(true) | WindowEvent::Resized(_) => {
          let proof_output_dir = native_proof_output_dir();
          let payload = NativeProofStageProof {
            stage: "04_frontend_loaded".to_string(),
            status: "window_ready".to_string(),
            timestamp: now_ms().to_string(),
            process_id: std::process::id(),
            workspace_root: native_workspace_root(),
            output_dir: proof_output_dir.display().to_string(),
            proof_request_found: read_native_proof_request(&proof_output_dir).is_some(),
            window_label: Some(window.label().to_string()),
            note: Some("Window-ready fallback observed before page-load confirmation.".to_string()),
            error: None,
            duration_ms: None,
          };
          let _ = write_native_proof_stage(&proof_output_dir, "04_frontend_loaded.json", &payload);
        }
        _ => {}
      }
    })
    .invoke_handler(tauri::generate_handler![
      execute_command_verified,
      run_native_rc0_proof,
      runway_generate_video,
      runway_list_pending_jobs,
      runway_resume_task,
      send_app_notification,
      save_settings,
      load_settings,
      kv_set,
      kv_get,
      verify_paths,
      read_runtime_env_value,
      alphonso_bridge_status,
      alphonso_bridge_send_packet,
      check_processes,
      check_ollama_runtime,
      ollama_list_models,
      ollama_generate,
      record_restore_point,
      write_handoff_export_file,
      write_workspace_text_file,
      append_audit_log,
      read_audit_log,
      verify_audit_chain,
      discover_plugins_from_disk,
      validate_plugin_manifest_disk,
      execute_plugin_tool,
      run_ocr_adapter,
      collect_workspace_proof,
      check_ocr_capability,
      get_memory_store_status,
      upsert_memory_records,
      list_memory_records,
      upsert_runtime_ledger_records,
      list_runtime_ledger_records,
      fetch_research_sources,
      search_research_sources,
      search_brave_sources,
      decompose_jose_command_backend,
      build_workspace_symbol_index,
      scan_workspace_readiness,
      inspect_updater_release,
      check_app_update,
      check_env_vars_presence,
      connector_poll_telegram,
      connector_poll_whatsapp,
      verify_whatsapp_cloud_webhook_challenge,
      verify_whatsapp_cloud_webhook_signature,
      normalize_whatsapp_cloud_inbound,
      connector_send_telegram,
      connector_send_whatsapp,
      connector_send_chatgpt,
      connector_send_claude,
      connector_send_notion,
      connector_send_clickup,
      connector_upload_youtube,
      meta_publish_content,
      tool_connection_post_webhook,
      connector_generate_sdwebui_image,
      connector_queue_comfyui_video,
      connector_get_comfyui_history,
      connector_check_local_runtime_health
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

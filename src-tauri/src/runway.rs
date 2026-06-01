use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_RUNWAY_BASE_URL: &str = "https://api.dev.runwayml.com";
const DEFAULT_RUNWAY_VERSION: &str = "2024-11-06";
const DEFAULT_RUNWAY_MODEL: &str = "gen4.5";
const DEFAULT_RUNWAY_RATIO: &str = "1280:720";
const DEFAULT_RUNWAY_DURATION: u32 = 5;
const DEFAULT_RUNWAY_TIMEOUT_SECS: u64 = 600;
const DEFAULT_OUTPUT_DIR: &str = "release/miya/runway";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunwayVideoRequest {
  pub prompt_text: String,
  pub prompt_image: Option<String>,
  pub model: Option<String>,
  pub ratio: Option<String>,
  pub duration: Option<u32>,
  pub output_dir: Option<String>,
  pub timeout_seconds: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunwayVideoProof {
  pub provider: String,
  pub ok: bool,
  pub task_id: Option<String>,
  pub status: String,
  pub model: String,
  pub ratio: String,
  pub duration: u32,
  pub output_dir: String,
  pub output_urls: Vec<String>,
  pub output_files: Vec<String>,
  pub setup_required: bool,
  pub trust: String,
  pub message: String,
  pub error: Option<String>,
  pub started_at_ms: u64,
  pub finished_at_ms: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunwayPendingJob {
  pub task_id: String,
  pub prompt_text: String,
  pub model: String,
  pub ratio: String,
  pub duration: u32,
  pub output_dir: String,
  pub started_at_ms: u64,
}

fn resolve_output_dir(output_dir: &str) -> PathBuf {
  let path = PathBuf::from(output_dir);
  if path.is_absolute() {
    path
  } else {
    std::env::current_dir().unwrap_or_default().join(path)
  }
}

fn pending_marker_path(dir: &PathBuf, task_id: &str) -> PathBuf {
  dir.join(format!("runway-{task_id}-pending.json"))
}

fn write_pending_marker(dir: &PathBuf, job: &RunwayPendingJob) {
  if let Ok(json) = serde_json::to_string_pretty(job) {
    let _ = fs::write(pending_marker_path(dir, &job.task_id), json);
  }
}

fn remove_pending_marker(dir: &PathBuf, task_id: &str) {
  let _ = fs::remove_file(pending_marker_path(dir, task_id));
}

async fn poll_and_download(
  client: &reqwest::Client,
  auth_header: &str,
  version: &str,
  base_url: &str,
  task_id: &str,
  model: String,
  ratio: String,
  duration: u32,
  output_dir_raw: String,
  saved_dir: PathBuf,
  timeout_seconds: u64,
  started_at_ms: u64,
) -> RunwayVideoProof {
  let task_endpoint = format!("{}/v1/tasks/{}", base_url.trim_end_matches('/'), task_id);
  let deadline = SystemTime::now()
    .checked_add(Duration::from_secs(timeout_seconds))
    .unwrap_or(SystemTime::now());
  let mut last_status = "PENDING".to_string();

  let task_json = loop {
    if SystemTime::now() >= deadline {
      remove_pending_marker(&saved_dir, task_id);
      return failed_proof(
        started_at_ms,
        output_dir_raw,
        model,
        ratio,
        duration,
        false,
        format!("Runway task timed out after {timeout_seconds}s."),
        Some(format!("task_id={task_id}, last_status={last_status}")),
      );
    }

    let task_response = match client
      .get(&task_endpoint)
      .header("Authorization", auth_header)
      .header("X-Runway-Version", version)
      .send()
      .await
    {
      Ok(response) => response,
      Err(error) => {
        remove_pending_marker(&saved_dir, task_id);
        return failed_proof(
          started_at_ms,
          output_dir_raw,
          model,
          ratio,
          duration,
          false,
          format!("Runway task lookup failed: {error}"),
          Some(error.to_string()),
        );
      }
    };

    if !task_response.status().is_success() {
      let status = task_response.status().as_u16();
      let text = task_response.text().await.unwrap_or_default();
      remove_pending_marker(&saved_dir, task_id);
      return failed_proof(
        started_at_ms,
        output_dir_raw,
        model,
        ratio,
        duration,
        false,
        format!("Runway task lookup returned HTTP {status}."),
        Some(text),
      );
    }

    let current_task_json: Value = match task_response.json().await {
      Ok(value) => value,
      Err(error) => {
        remove_pending_marker(&saved_dir, task_id);
        return failed_proof(
          started_at_ms,
          output_dir_raw,
          model,
          ratio,
          duration,
          false,
          format!("Runway task response could not be parsed: {error}"),
          Some(error.to_string()),
        );
      }
    };

    last_status = current_task_json
      .get("status")
      .and_then(Value::as_str)
      .unwrap_or("UNKNOWN")
      .to_string();

    match last_status.to_uppercase().as_str() {
      "SUCCEEDED" => break current_task_json,
      "FAILED" | "CANCELED" => {
        remove_pending_marker(&saved_dir, task_id);
        return failed_proof(
          started_at_ms,
          output_dir_raw,
          model,
          ratio,
          duration,
          false,
          format!("Runway task ended with status {last_status}."),
          Some(current_task_json.to_string()),
        );
      }
      _ => {
        tokio::time::sleep(Duration::from_secs(5)).await;
      }
    }
  };

  let output_urls = task_json
    .get("output")
    .and_then(Value::as_array)
    .map(|entries| {
      entries
        .iter()
        .filter_map(|entry| entry.as_str().map(ToString::to_string))
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();

  let mut output_files = Vec::new();
  if let Err(error) = fs::create_dir_all(&saved_dir) {
    remove_pending_marker(&saved_dir, task_id);
    return failed_proof(
      started_at_ms,
      output_dir_raw,
      model,
      ratio,
      duration,
      false,
      format!("Runway output directory could not be created: {error}"),
      Some(error.to_string()),
    );
  }

  for (index, output_url) in output_urls.iter().enumerate() {
    let file_path = saved_dir.join(format!("runway-{task_id}-{index}.mp4"));
    match client.get(output_url).send().await {
      Ok(response) if response.status().is_success() => match response.bytes().await {
        Ok(bytes) => {
          if fs::write(&file_path, &bytes).is_ok() {
            output_files.push(file_path.display().to_string());
          }
        }
        Err(error) => {
          remove_pending_marker(&saved_dir, task_id);
          return failed_proof(
            started_at_ms,
            output_dir_raw,
            model,
            ratio,
            duration,
            false,
            format!("Runway output download failed: {error}"),
            Some(error.to_string()),
          );
        }
      },
      Ok(response) => {
        remove_pending_marker(&saved_dir, task_id);
        return failed_proof(
          started_at_ms,
          output_dir_raw,
          model,
          ratio,
          duration,
          false,
          format!("Runway output download returned HTTP {}.", response.status().as_u16()),
          Some(output_url.clone()),
        );
      }
      Err(error) => {
        remove_pending_marker(&saved_dir, task_id);
        return failed_proof(
          started_at_ms,
          output_dir_raw,
          model,
          ratio,
          duration,
          false,
          format!("Runway output download request failed: {error}"),
          Some(error.to_string()),
        );
      }
    }
  }

  let proof = RunwayVideoProof {
    provider: "runway".to_string(),
    ok: true,
    task_id: Some(task_id.to_string()),
    status: "SUCCEEDED".to_string(),
    model,
    ratio,
    duration,
    output_dir: saved_dir.display().to_string(),
    output_urls: output_urls.clone(),
    output_files: output_files.clone(),
    setup_required: false,
    trust: "confirmed".to_string(),
    message: if output_files.is_empty() {
      "Runway task succeeded, but no outputs were downloaded.".to_string()
    } else {
      "Runway task succeeded and output was saved locally.".to_string()
    },
    error: None,
    started_at_ms,
    finished_at_ms: now_ms(),
  };

  remove_pending_marker(&saved_dir, task_id);
  let receipt_path = saved_dir.join(format!("runway-{task_id}.json"));
  let _ = fs::write(
    &receipt_path,
    serde_json::to_string_pretty(&proof).unwrap_or_else(|_| "{}".to_string()),
  );

  proof
}

#[tauri::command]
pub async fn runway_generate_video(request: RunwayVideoRequest) -> RunwayVideoProof {
  let started_at_ms = now_ms();
  let api_secret = match std::env::var("RUNWAYML_API_SECRET") {
    Ok(value) if !value.trim().is_empty() => value,
    _ => {
      return RunwayVideoProof {
        provider: "runway".to_string(),
        ok: false,
        task_id: None,
        status: "setup_required".to_string(),
        model: request.model.unwrap_or_else(|| DEFAULT_RUNWAY_MODEL.to_string()),
        ratio: request.ratio.unwrap_or_else(|| DEFAULT_RUNWAY_RATIO.to_string()),
        duration: request.duration.unwrap_or(DEFAULT_RUNWAY_DURATION),
        output_dir: request.output_dir.unwrap_or_else(|| DEFAULT_OUTPUT_DIR.to_string()),
        output_urls: Vec::new(),
        output_files: Vec::new(),
        setup_required: true,
        trust: "setup_required".to_string(),
        message: "RUNWAYML_API_SECRET is required for Runway generation.".to_string(),
        error: Some("RUNWAYML_API_SECRET missing".to_string()),
        started_at_ms,
        finished_at_ms: now_ms(),
      };
    }
  };

  if request.prompt_text.trim().is_empty() {
    return RunwayVideoProof {
      provider: "runway".to_string(),
      ok: false,
      task_id: None,
      status: "failed".to_string(),
      model: request.model.unwrap_or_else(|| DEFAULT_RUNWAY_MODEL.to_string()),
      ratio: request.ratio.unwrap_or_else(|| DEFAULT_RUNWAY_RATIO.to_string()),
      duration: request.duration.unwrap_or(DEFAULT_RUNWAY_DURATION),
      output_dir: request.output_dir.unwrap_or_else(|| DEFAULT_OUTPUT_DIR.to_string()),
      output_urls: Vec::new(),
      output_files: Vec::new(),
      setup_required: false,
      trust: "failed".to_string(),
      message: "Runway prompt text is required.".to_string(),
      error: Some("prompt_text missing".to_string()),
      started_at_ms,
      finished_at_ms: now_ms(),
    };
  }

  let model = request.model.unwrap_or_else(|| DEFAULT_RUNWAY_MODEL.to_string());
  let ratio = request.ratio.unwrap_or_else(|| DEFAULT_RUNWAY_RATIO.to_string());
  let duration = request.duration.unwrap_or(DEFAULT_RUNWAY_DURATION);
  let timeout_seconds = request.timeout_seconds.unwrap_or(DEFAULT_RUNWAY_TIMEOUT_SECS);
  let output_dir_raw = request.output_dir.unwrap_or_else(|| DEFAULT_OUTPUT_DIR.to_string());
  let saved_dir = resolve_output_dir(&output_dir_raw);
  let base_url = std::env::var("RUNWAYML_API_BASE_URL").unwrap_or_else(|_| DEFAULT_RUNWAY_BASE_URL.to_string());
  let version = std::env::var("RUNWAYML_API_VERSION").unwrap_or_else(|_| DEFAULT_RUNWAY_VERSION.to_string());
  let client = reqwest::Client::new();
  let auth_header = format!("Bearer {api_secret}");
  let endpoint = format!("{}/v1/image_to_video", base_url.trim_end_matches('/'));
  let mut body = json!({
    "model": model,
    "promptText": request.prompt_text,
    "ratio": ratio,
    "duration": duration,
  });
  if let Some(prompt_image) = request.prompt_image.as_ref().filter(|value| !value.trim().is_empty()) {
    body["promptImage"] = json!(prompt_image);
  }

  let create_response = match client
    .post(&endpoint)
    .header("Authorization", auth_header.clone())
    .header("X-Runway-Version", version.clone())
    .json(&body)
    .send()
    .await
  {
    Ok(response) => response,
    Err(error) => {
      return failed_proof(
        started_at_ms,
        output_dir_raw,
        model,
        ratio,
        duration,
        false,
        format!("Runway create request failed: {error}"),
        Some(error.to_string()),
      );
    }
  };

  if !create_response.status().is_success() {
    let status = create_response.status().as_u16();
    let text = create_response.text().await.unwrap_or_default();
    return failed_proof(
      started_at_ms,
      output_dir_raw,
      model,
      ratio,
      duration,
      false,
      format!("Runway create request returned HTTP {status}."),
      Some(text),
    );
  }

  let create_json: Value = match create_response.json().await {
    Ok(value) => value,
    Err(error) => {
      return failed_proof(
        started_at_ms,
        output_dir_raw,
        model,
        ratio,
        duration,
        false,
        format!("Runway create response could not be parsed: {error}"),
        Some(error.to_string()),
      );
    }
  };

  let task_id = create_json
    .get("id")
    .and_then(Value::as_str)
    .map(ToString::to_string);
  let Some(task_id) = task_id else {
    return failed_proof(
      started_at_ms,
      output_dir_raw,
      model,
      ratio,
      duration,
      false,
      "Runway create response did not include a task id.".to_string(),
      Some(create_json.to_string()),
    );
  };

  // Persist the job before polling so it can be resumed if the app is killed mid-render.
  let _ = fs::create_dir_all(&saved_dir);
  write_pending_marker(&saved_dir, &RunwayPendingJob {
    task_id: task_id.clone(),
    prompt_text: request.prompt_text.clone(),
    model: model.clone(),
    ratio: ratio.clone(),
    duration,
    output_dir: saved_dir.display().to_string(),
    started_at_ms,
  });

  poll_and_download(
    &client,
    &auth_header,
    &version,
    &base_url,
    &task_id,
    model,
    ratio,
    duration,
    output_dir_raw,
    saved_dir,
    timeout_seconds,
    started_at_ms,
  )
  .await
}

#[tauri::command]
pub async fn runway_list_pending_jobs(output_dir: Option<String>) -> Vec<RunwayPendingJob> {
  let dir = resolve_output_dir(&output_dir.unwrap_or_else(|| DEFAULT_OUTPUT_DIR.to_string()));
  let entries = match fs::read_dir(&dir) {
    Ok(entries) => entries,
    Err(_) => return Vec::new(),
  };
  let mut jobs = Vec::new();
  for entry in entries.flatten() {
    let name = entry.file_name();
    let name = name.to_string_lossy();
    if name.ends_with("-pending.json") && name.starts_with("runway-") {
      if let Ok(content) = fs::read_to_string(entry.path()) {
        if let Ok(job) = serde_json::from_str::<RunwayPendingJob>(&content) {
          jobs.push(job);
        }
      }
    }
  }
  jobs
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunwayResumeRequest {
  pub task_id: String,
  pub output_dir: Option<String>,
  pub timeout_seconds: Option<u64>,
}

#[tauri::command]
pub async fn runway_resume_task(request: RunwayResumeRequest) -> RunwayVideoProof {
  let started_at_ms = now_ms();
  let api_secret = match std::env::var("RUNWAYML_API_SECRET") {
    Ok(value) if !value.trim().is_empty() => value,
    _ => {
      return RunwayVideoProof {
        provider: "runway".to_string(),
        ok: false,
        task_id: Some(request.task_id),
        status: "setup_required".to_string(),
        model: DEFAULT_RUNWAY_MODEL.to_string(),
        ratio: DEFAULT_RUNWAY_RATIO.to_string(),
        duration: DEFAULT_RUNWAY_DURATION,
        output_dir: request.output_dir.unwrap_or_else(|| DEFAULT_OUTPUT_DIR.to_string()),
        output_urls: Vec::new(),
        output_files: Vec::new(),
        setup_required: true,
        trust: "setup_required".to_string(),
        message: "RUNWAYML_API_SECRET is required to resume a Runway task.".to_string(),
        error: Some("RUNWAYML_API_SECRET missing".to_string()),
        started_at_ms,
        finished_at_ms: now_ms(),
      };
    }
  };

  let output_dir_raw = request.output_dir.unwrap_or_else(|| DEFAULT_OUTPUT_DIR.to_string());
  let saved_dir = resolve_output_dir(&output_dir_raw);
  let base_url = std::env::var("RUNWAYML_API_BASE_URL").unwrap_or_else(|_| DEFAULT_RUNWAY_BASE_URL.to_string());
  let version = std::env::var("RUNWAYML_API_VERSION").unwrap_or_else(|_| DEFAULT_RUNWAY_VERSION.to_string());
  let client = reqwest::Client::new();
  let auth_header = format!("Bearer {api_secret}");
  let timeout_seconds = request.timeout_seconds.unwrap_or(DEFAULT_RUNWAY_TIMEOUT_SECS);

  // Read metadata from the pending marker if available.
  let pending = fs::read_to_string(pending_marker_path(&saved_dir, &request.task_id))
    .ok()
    .and_then(|s| serde_json::from_str::<RunwayPendingJob>(&s).ok());

  let model = pending.as_ref().map(|j| j.model.clone()).unwrap_or_else(|| DEFAULT_RUNWAY_MODEL.to_string());
  let ratio = pending.as_ref().map(|j| j.ratio.clone()).unwrap_or_else(|| DEFAULT_RUNWAY_RATIO.to_string());
  let duration = pending.as_ref().map(|j| j.duration).unwrap_or(DEFAULT_RUNWAY_DURATION);
  let original_start = pending.as_ref().map(|j| j.started_at_ms).unwrap_or(started_at_ms);

  poll_and_download(
    &client,
    &auth_header,
    &version,
    &base_url,
    &request.task_id,
    model,
    ratio,
    duration,
    output_dir_raw,
    saved_dir,
    timeout_seconds,
    original_start,
  )
  .await
}

fn failed_proof(
  started_at_ms: u64,
  output_dir: String,
  model: String,
  ratio: String,
  duration: u32,
  setup_required: bool,
  message: String,
  error: Option<String>,
) -> RunwayVideoProof {
  RunwayVideoProof {
    provider: "runway".to_string(),
    ok: false,
    task_id: None,
    status: if setup_required { "setup_required".to_string() } else { "failed".to_string() },
    model,
    ratio,
    duration,
    output_dir,
    output_urls: Vec::new(),
    output_files: Vec::new(),
    setup_required,
    trust: if setup_required { "setup_required".to_string() } else { "failed".to_string() },
    message,
    error,
    started_at_ms,
    finished_at_ms: now_ms(),
  }
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

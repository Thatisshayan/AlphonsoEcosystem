import { invoke } from '@tauri-apps/api/core';

const CONTENT_KV_KEY = 'content_catalyst_jobs_v1';

export async function persistContentJobsToSqlite(jobs) {
  try {
    await invoke('kv_set', { key: CONTENT_KV_KEY, value: JSON.stringify(jobs) });
  } catch { /* bridge not available in browser dev mode */ }
}

export async function hydrateContentJobsFromSqlite() {
  try {
    const json = await invoke('kv_get', { key: CONTENT_KV_KEY });
    if (!json) return null;
    const jobs = JSON.parse(json);
    return Array.isArray(jobs) ? jobs : null;
  } catch {
    return null;
  }
}

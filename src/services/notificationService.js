import { invoke } from '@tauri-apps/api/core';

// Sends a native OS notification via the Tauri backend.
// Falls back silently in browser/dev mode where the bridge isn't available.
export async function sendNativeNotification(title, body) {
  try {
    await invoke('send_app_notification', { title: String(title), body: String(body) });
  } catch {
    // dev/browser fallback — no-op
  }
}

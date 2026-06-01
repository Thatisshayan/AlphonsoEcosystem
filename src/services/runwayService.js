import { invoke } from '@tauri-apps/api/core';

export function buildRunwayVideoRequest({
  promptText,
  promptImage,
  model = 'gen4.5',
  ratio = '1280:720',
  duration = 5,
  outputDir,
  timeoutSeconds = 600
} = {}) {
  return {
    promptText: String(promptText || '').trim(),
    promptImage: promptImage ? String(promptImage).trim() : '',
    model: String(model || 'gen4.5').trim() || 'gen4.5',
    ratio: String(ratio || '1280:720').trim() || '1280:720',
    duration: Number(duration || 5),
    outputDir: outputDir ? String(outputDir).trim() : '',
    timeoutSeconds: Number(timeoutSeconds || 600)
  };
}

export async function generateRunwayVideo(options = {}) {
  const request = buildRunwayVideoRequest(options);
  return invoke('runway_generate_video', { request });
}

export async function listPendingRunwayJobs(outputDir) {
  return invoke('runway_list_pending_jobs', { outputDir: outputDir ?? null });
}

export async function resumeRunwayTask({ taskId, outputDir, timeoutSeconds } = {}) {
  return invoke('runway_resume_task', {
    request: {
      taskId: String(taskId || ''),
      outputDir: outputDir ? String(outputDir) : null,
      timeoutSeconds: timeoutSeconds ? Number(timeoutSeconds) : null
    }
  });
}

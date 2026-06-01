const STORAGE_PREFIX = 'alphonso_custom_avatar_v1_';
const MAX_DIMENSION = 256;
const JPEG_QUALITY = 0.82;

function storageKey(agentId) {
  return STORAGE_PREFIX + String(agentId || '').toLowerCase();
}

export function getCustomAvatarDataUrl(agentId) {
  try {
    return localStorage.getItem(storageKey(agentId)) || null;
  } catch {
    return null;
  }
}

export function removeCustomAvatar(agentId) {
  try {
    localStorage.removeItem(storageKey(agentId));
  } catch {
    // ignore
  }
}

export function listCustomAvatarAgentIds() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .map((k) => k.slice(STORAGE_PREFIX.length));
  } catch {
    return [];
  }
}

// Reads a File, resizes to ≤ MAX_DIMENSION × MAX_DIMENSION, returns a JPEG data URL.
export function processAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('File must be an image.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = () => reject(new Error('Could not load image.'));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

export async function setCustomAvatar(agentId, file) {
  const dataUrl = await processAvatarFile(file);
  try {
    localStorage.setItem(storageKey(agentId), dataUrl);
  } catch (err) {
    throw new Error(`Failed to save avatar: ${err.message}`);
  }
  return dataUrl;
}

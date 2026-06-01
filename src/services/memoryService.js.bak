import { invoke } from '@tauri-apps/api/core';
import { TRUST_STATES, timestampMs } from './trustModel';

const MEMORY_KEY = 'alphonso_memory_items_v1';

export const MEMORY_CATEGORIES = [
  'project_memory',
  'task_memory',
  'runtime_memory',
  'workspace_memory',
  'creative_memory',
  'orchestration_memory',
  'research_memory',
  'source_memory',
  'citation_memory',
  'preference_memory',
  'code_symbol_memory',
  'timeline_memory'
];

const durableMemoryProbe = {
  checked: false,
  available: false,
  nextCheckAtMs: 0
};

let durableWriteQueue = Promise.resolve();

function readMemory() {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMemory(items) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(items.slice(-1000)));
}

function withExpiryState(item) {
  if (item.expiresAt && item.expiresAt < timestampMs() && item.confidence !== TRUST_STATES.EXPIRED) {
    return {
      ...item,
      confidence: TRUST_STATES.EXPIRED,
      verificationState: TRUST_STATES.EXPIRED
    };
  }
  return item;
}

function normalizeDurableRecord(row) {
  const content = row.content;
  const governance = content && typeof content === 'object' && !Array.isArray(content)
    ? content.__governance || {}
    : {};
  const normalizedContent = content && typeof content === 'object' && !Array.isArray(content) && Object.prototype.hasOwnProperty.call(content, 'value')
    ? content.value
    : content;
  return {
    id: row.id,
    title: row.title || 'Untitled memory',
    content: normalizedContent ?? '',
    category: row.category || 'timeline_memory',
    sourceAgent: row.sourceAgent || 'alphonso',
    source: row.source || 'runtime',
    timestampMs: Number(row.timestampMs || timestampMs()),
    confidence: row.confidence || TRUST_STATES.UNVERIFIED,
    verificationState: row.verificationState || TRUST_STATES.UNVERIFIED,
    projectReference: row.projectReference || null,
    expiresAt: row.expiresAt || null,
    expiryRule: row.expiryRule || null,
    workflowOwner: governance.workflowOwner || row.workflowOwner || null,
    sensitivity: governance.sensitivity || row.sensitivity || 'internal',
    retentionPolicy: governance.retentionPolicy || row.retentionPolicy || 'standard',
    privacyStatus: governance.privacyStatus || row.privacyStatus || 'local_governed',
    updatedAtMs: Number(governance.updatedAtMs || row.updatedAtMs || row.timestampMs || timestampMs())
  };
}

function mergeById(rows) {
  const byId = new Map();
  rows.forEach((row) => {
    if (!row?.id) return;
    byId.set(row.id, row);
  });
  return [...byId.values()].sort((a, b) => Number(a.timestampMs || 0) - Number(b.timestampMs || 0));
}

function toDurableRecord(item) {
  const governance = {
    workflowOwner: item.workflowOwner || null,
    sensitivity: item.sensitivity || 'internal',
    retentionPolicy: item.retentionPolicy || 'standard',
    privacyStatus: item.privacyStatus || 'local_governed',
    updatedAtMs: Number(item.updatedAtMs || timestampMs())
  };
  const baseContent = item.content ?? '';
  const content = baseContent && typeof baseContent === 'object' && !Array.isArray(baseContent)
    ? { ...baseContent, __governance: governance }
    : { value: baseContent, __governance: governance };
  return {
    id: item.id,
    title: item.title,
    content,
    category: item.category,
    sourceAgent: item.sourceAgent,
    source: item.source,
    timestampMs: Number(item.timestampMs || timestampMs()),
    confidence: item.confidence || TRUST_STATES.UNVERIFIED,
    verificationState: item.verificationState || TRUST_STATES.UNVERIFIED,
    projectReference: item.projectReference || null,
    expiresAt: item.expiresAt || null,
    expiryRule: item.expiryRule || null
  };
}

async function checkDurableMemoryAvailable(force = false) {
  const now = timestampMs();
  if (!force && durableMemoryProbe.checked && durableMemoryProbe.nextCheckAtMs > now) {
    return durableMemoryProbe.available;
  }
  try {
    const status = await invoke('get_memory_store_status');
    const available = Boolean(status?.available);
    durableMemoryProbe.checked = true;
    durableMemoryProbe.available = available;
    durableMemoryProbe.nextCheckAtMs = now + (available ? 60_000 : 15_000);
    return available;
  } catch {
    durableMemoryProbe.checked = true;
    durableMemoryProbe.available = false;
    durableMemoryProbe.nextCheckAtMs = now + 15_000;
    return false;
  }
}

function queueDurableWrite(record) {
  durableWriteQueue = durableWriteQueue
    .then(async () => {
      const available = await checkDurableMemoryAvailable();
      if (!available) return;
      await invoke('upsert_memory_records', { records: [toDurableRecord(record)] });
    })
    .catch(() => {
      durableMemoryProbe.available = false;
      durableMemoryProbe.nextCheckAtMs = timestampMs() + 10_000;
    });
}

export function listMemoryItems() {
  return readMemory().map(withExpiryState);
}

export async function hydrateMemoryFromDurable(filters = {}) {
  const available = await checkDurableMemoryAvailable(true);
  if (!available) return listMemoryItems();

  try {
    const rows = await invoke('list_memory_records', { filters });
    const durableRows = Array.isArray(rows) ? rows.map(normalizeDurableRecord) : [];
    if (!durableRows.length) {
      const localRows = listMemoryItems();
      if (localRows.length) {
        await invoke('upsert_memory_records', {
          records: localRows.map(toDurableRecord)
        });
      }
      return localRows;
    }

    const merged = mergeById([...readMemory(), ...durableRows]).map(withExpiryState);
    writeMemory(merged);
    return merged;
  } catch {
    return listMemoryItems();
  }
}

export function pushMemoryItem(partial) {
  const items = readMemory();
  const item = {
    id: `mem-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestampMs: timestampMs(),
    title: partial.title || 'Untitled memory',
    category: partial.category || 'timeline_memory',
    confidence: partial.confidence || TRUST_STATES.UNVERIFIED,
    source: partial.source || 'runtime',
    sourceAgent: partial.sourceAgent || partial.agent || 'alphonso',
    verificationState: partial.verificationState || TRUST_STATES.UNVERIFIED,
    expiresAt: partial.expiresAt || null,
    expiryRule: partial.expiryRule || null,
    projectReference: partial.projectReference || null,
    content: partial.content || '',
    workflowOwner: partial.workflowOwner || null,
    sensitivity: partial.sensitivity || 'internal',
    retentionPolicy: partial.retentionPolicy || 'standard',
    privacyStatus: partial.privacyStatus || 'local_governed',
    updatedAtMs: timestampMs()
  };

  items.push(item);
  writeMemory(items);
  queueDurableWrite(item);
  return item;
}

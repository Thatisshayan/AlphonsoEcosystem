// Lightweight in-memory ring buffer (last 100 entries) for connector call audit
const MAX_ENTRIES = 100;
const log = [];

export function appendConnectorAuditEntry({ connectorId, ok, latencyMs, errorCode }) {
  log.push({ connectorId, ok, latencyMs, errorCode: errorCode || null, ts: Date.now() });
  if (log.length > MAX_ENTRIES) log.shift();
}

export function getConnectorAuditLog() {
  return [...log];
}

export function getLastEntryForConnector(connectorId) {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].connectorId === connectorId) return log[i];
  }
  return null;
}

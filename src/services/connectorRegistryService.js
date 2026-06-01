import { invoke } from '@tauri-apps/api/core';
import { AGENTS, createAgentPacket, requestPacketRetry, sendPacketToDeadLetter, updatePacketStatus } from './agentBusService';
import { appendSessionEvent } from './sessionIntelligenceService';
import { TRUST_STATES, timestampMs } from './trustModel';
import { persistScopeRows } from './runtimeLedgerService';
import { createJoseCommandRoute } from './joseCommandRouterService';
import { evaluatePolicyGate } from './policyEnforcementService';
import { appendOrchestrationReceipt } from './orchestrationReceiptService';
import { requireApproval } from './approval/approvalService';
import { appendConnectorAuditEntry } from './connectorAuditLogService';

const CONNECTOR_KEY = 'alphonso_connector_registry_v2';
const CONNECTOR_AUDIT_KEY = 'alphonso_connector_audit_v2';
const CONNECTOR_AUTH_KEY = 'alphonso_connector_auth_profiles_v1';
export const CONNECTOR_SCOPE = 'connector_registry_v2';
export const CONNECTOR_AUDIT_SCOPE = 'connector_audit_v2';
export const CONNECTOR_AUTH_SCOPE = 'connector_auth_profiles_v1';

const DEFAULT_CONNECTORS = [
  {
    id: 'telegram',
    name: 'Telegram Bridge',
    status: 'not_configured',
    transport: 'bot_api',
    requiredEnv: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS'],
    permissions: ['inbound_messages', 'jose_routing', 'approval_requests'],
    disabledReason: 'Token and allowed chat IDs are not configured in the app environment.'
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Bridge',
    status: 'not_configured',
    transport: 'whatsapp_cloud_api_or_twilio',
    requiredEnv: ['WHATSAPP_PROVIDER', 'WHATSAPP_ALLOWED_NUMBERS'],
    permissions: ['inbound_messages', 'jose_routing', 'approval_requests'],
    disabledReason: 'WhatsApp Cloud API or Twilio credentials are not configured.'
  },
  {
    id: 'youtube',
    name: 'YouTube Connector',
    status: 'not_configured',
    transport: 'youtube_data_api_v3',
    requiredEnv: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_CHANNEL_ID'],
    permissions: ['upload_video', 'metadata_update', 'approval_requests'],
    disabledReason: 'OAuth credentials are not configured.'
  },
  {
    id: 'mobile_bridge',
    name: 'Mobile Bridge',
    status: 'foundation_only',
    transport: 'future_secure_local_relay',
    requiredEnv: [],
    permissions: ['remote_approvals', 'runtime_status', 'active_tasks', 'voice_notes'],
    disabledReason: 'Mobile transport is not implemented yet.'
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT Connector',
    status: 'not_configured',
    transport: 'openai_api_adapter',
    requiredEnv: ['OPENAI_API_KEY'],
    permissions: ['prompt_exchange', 'approval_requests'],
    disabledReason: 'OpenAI API key is not configured. Live bridge transport is not wired yet.'
  },
  {
    id: 'claude',
    name: 'Claude Connector',
    status: 'not_configured',
    transport: 'anthropic_api_adapter',
    requiredEnv: ['ANTHROPIC_API_KEY'],
    permissions: ['prompt_exchange', 'approval_requests'],
    disabledReason: 'Anthropic API key is not configured. Live bridge transport is not wired yet.'
  },
  {
    id: 'notion',
    name: 'Notion Connector',
    status: 'not_configured',
    transport: 'notion_api_adapter',
    requiredEnv: ['NOTION_API_KEY', 'NOTION_PARENT_PAGE_ID'],
    permissions: ['docs_read', 'docs_write', 'approval_requests'],
    disabledReason: 'Notion API key and parent page id are not configured.'
  },
  {
    id: 'clickup',
    name: 'ClickUp Connector',
    status: 'not_configured',
    transport: 'clickup_api_adapter',
    requiredEnv: ['CLICKUP_API_KEY', 'CLICKUP_LIST_ID'],
    permissions: ['task_read', 'task_write', 'approval_requests'],
    disabledReason: 'ClickUp API key and list id are not configured.'
  },
  {
    id: 'sd_webui',
    name: 'Local SD WebUI Image',
    status: 'foundation_only',
    transport: 'automatic1111_local_api',
    requiredEnv: [],
    permissions: ['local_image_generation'],
    disabledReason: 'Requires local Stable Diffusion WebUI API runtime (default: http://127.0.0.1:7860).'
  },
  {
    id: 'comfyui_video',
    name: 'Local ComfyUI Video',
    status: 'foundation_only',
    transport: 'comfyui_local_api',
    requiredEnv: [],
    permissions: ['local_video_generation'],
    disabledReason: 'Requires local ComfyUI runtime + workflow JSON (default: http://127.0.0.1:8188).'
  },
  {
    id: 'runway',
    name: 'Runway Cloud Video',
    status: 'not_configured',
    transport: 'runway_api',
    requiredEnv: ['RUNWAYML_API_SECRET'],
    permissions: ['cloud_video_generation', 'approval_requests'],
    disabledReason: 'Runway API secret is not configured in the backend environment.'
  }
];

const DEFAULT_AUTH_PROFILES = {
  telegram: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  },
  whatsapp: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  },
  youtube: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  },
  chatgpt: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  },
  claude: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  },
  notion: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  },
  clickup: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  },
  sd_webui: {
    enabled: true,
    allowlist: [],
    mode: 'local_only'
  },
  comfyui_video: {
    enabled: true,
    allowlist: [],
    mode: 'local_only'
  },
  runway: {
    enabled: false,
    allowlist: [],
    mode: 'allowlist_required'
  }
};

function readRows(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRows(key, rows) {
  const nextRows = rows.slice(-500);
  localStorage.setItem(key, JSON.stringify(nextRows));
  const scope = key === CONNECTOR_KEY
    ? CONNECTOR_SCOPE
    : key === CONNECTOR_AUDIT_KEY
      ? CONNECTOR_AUDIT_SCOPE
      : null;
  if (scope) {
    persistScopeRows(scope, nextRows, (row) => ({
      id: row.id,
      data: row,
      status: row.status || row.action || 'recorded',
      confidence: row.trust || TRUST_STATES.TEMPORARY,
      verificationState: row.trust || TRUST_STATES.UNVERIFIED,
      timestampMs: Number(row.updatedAtMs || row.timestampMs || timestampMs())
    }));
  }
}

function readAuthProfiles() {
  try {
    const raw = localStorage.getItem(CONNECTOR_AUTH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_AUTH_PROFILES, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_AUTH_PROFILES };
  }
}

function writeAuthProfiles(profiles) {
  localStorage.setItem(CONNECTOR_AUTH_KEY, JSON.stringify(profiles));
  const rows = Object.entries(profiles || {}).map(([id, profile]) => ({
    id: `auth-${id}`,
    ...profile
  }));
  persistScopeRows(CONNECTOR_AUTH_SCOPE, rows, (row) => ({
    id: row.id,
    data: row,
    status: row.enabled ? 'enabled' : 'disabled',
    confidence: TRUST_STATES.TEMPORARY,
    verificationState: TRUST_STATES.UNVERIFIED,
    timestampMs: timestampMs()
  }));
}

function normalizeAllowlist(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 120);
}

function authorizeConnectorRequest(connectorId) {
  const profiles = readAuthProfiles();
  const profile = profiles?.[connectorId] || { enabled: false, allowlist: [], mode: 'allowlist_required' };
  if (profile.mode === 'local_only') {
    return {
      enabled: true,
      isAuthorized: true,
      mode: 'local_only'
    };
  }
  if (!profile.enabled) {
    return {
      enabled: false,
      isAuthorized: false,
      mode: profile.mode || 'allowlist_required'
    };
  }
  return {
    enabled: true,
    isAuthorized: true,
    mode: profile.mode || 'allowlist_required'
  };
}

export function isConnectorAuthenticated(connectorId) {
  const auth = authorizeConnectorRequest(connectorId);
  return {
    ok: Boolean(auth.isAuthorized),
    success: Boolean(auth.isAuthorized),
    connector: connectorId,
    enabled: Boolean(auth.enabled),
    mode: auth.mode || 'allowlist_required'
  };
}

function logUnauthenticatedConnectorRequest(connectorId, actionType, commandPreview = '', options = {}) {
  const detail = {
    connector: connectorId,
    action: actionType,
    reason: 'not_authenticated',
    timestamp: timestampMs(),
    commandPreview: String(commandPreview || '').slice(0, 200),
    requestedBy: options.requestedBy || 'jose'
  };
  appendConnectorAudit(connectorId, 'request_rejected', detail);
  appendOrchestrationReceipt({
    workflowId: 'connector_policy',
    commandId: options.commandId || null,
    packetId: options.packetId || null,
    eventType: 'connector_request_rejected',
    status: 'blocked',
    agent: AGENTS.JOSE,
    connectorId,
    actionType,
    riskLevel: 'high',
    approved: false,
    blocked: true,
    setupRequired: false,
    details: detail,
    confidence: TRUST_STATES.FAILED,
    verificationState: TRUST_STATES.FAILED
  });
  return {
    success: false,
    ok: false,
    error: 'not_authenticated',
    connector: connectorId,
    blocked: true,
    trust: TRUST_STATES.FAILED
  };
}

function gateConnectorAction(connectorId, actionType, commandPreview, options = {}) {
  const auth = options.auth || authorizeConnectorRequest(connectorId);
  const gate = evaluatePolicyGate({
    connectorId,
    actionType,
    commandPreview,
    approved: Boolean(options.approved),
    auth
  });
  appendConnectorAudit(connectorId, gate.ok ? 'policy_allow' : 'policy_block', {
    actionType,
    commandPreview: String(commandPreview || '').slice(0, 200),
    approved: Boolean(options.approved),
    reason: gate.reason || null,
    riskLevel: gate.riskLevel
  });
  appendOrchestrationReceipt({
    workflowId: 'connector_policy',
    commandId: options.commandId || null,
    packetId: options.packetId || null,
    eventType: gate.ok ? 'connector_policy_allow' : 'connector_policy_block',
    status: gate.ok ? 'allowed' : 'blocked',
    agent: AGENTS.JOSE,
    connectorId,
    actionType,
    riskLevel: gate.riskLevel || 'medium',
    approved: Boolean(options.approved),
    blocked: !gate.ok,
    setupRequired: Boolean(gate.setupRequired),
    details: {
      reason: gate.reason || null,
      authMode: auth.mode || 'allowlist_required'
    },
    confidence: gate.confidence || TRUST_STATES.VERIFIED,
    verificationState: gate.verificationState || TRUST_STATES.UNVERIFIED
  });
  return gate;
}

async function requireConnectorReady(connectorId, actionType, commandPreview = '', options = {}) {
  const envProof = await verifyConnectorEnvironment(connectorId);
  if (envProof?.ok) return { ok: true };

  const reason = `Connector ${connectorId} is not configured in runtime env.`;
  appendConnectorAudit(connectorId, 'setup_required', {
    actionType,
    commandPreview: String(commandPreview || '').slice(0, 180),
    missingEnv: Object.entries(envProof?.envPresence || {})
      .filter(([, present]) => !present)
      .map(([key]) => key),
    status: envProof?.status || 'not_configured'
  });
  appendOrchestrationReceipt({
    workflowId: 'connector_policy',
    commandId: options.commandId || null,
    packetId: options.packetId || null,
    eventType: 'connector_setup_required',
    status: 'setup_required',
    agent: AGENTS.JOSE,
    connectorId,
    actionType,
    riskLevel: 'high',
    approved: Boolean(options.approved),
    blocked: true,
    setupRequired: true,
    details: {
      reason,
      connectorStatus: envProof?.status || 'not_configured'
    },
    confidence: TRUST_STATES.UNVERIFIED,
    verificationState: TRUST_STATES.PLACEHOLDER
  });
  return {
    ok: false,
    connectorId,
    blocked: true,
    setupRequired: true,
    trust: TRUST_STATES.PLACEHOLDER,
    error: reason
  };
}

function upsertConnectorRows(existing) {
  const merged = [
    ...existing,
    ...DEFAULT_CONNECTORS.filter((item) => !existing.some((row) => row.id === item.id))
  ].map((connector) => ({
    ...connector,
    trust: connector.status === 'configured' ? TRUST_STATES.VERIFIED : TRUST_STATES.PLACEHOLDER,
    updatedAtMs: connector.updatedAtMs || timestampMs(),
    envPresence: connector.envPresence || {}
  }));
  writeRows(CONNECTOR_KEY, merged);
  return merged;
}

export function listConnectors() {
  const existing = readRows(CONNECTOR_KEY);
  return upsertConnectorRows(existing);
}

export function listConnectorAudit() {
  return readRows(CONNECTOR_AUDIT_KEY);
}

export function listConnectorAuthProfiles() {
  return readAuthProfiles();
}

export function updateConnectorAuthProfile(connectorId, patch = {}) {
  const profiles = readAuthProfiles();
  const current = profiles[connectorId] || { enabled: false, allowlist: [], mode: 'allowlist_required' };
  const next = {
    ...current,
    ...patch,
    allowlist: patch.allowlist ? normalizeAllowlist(patch.allowlist) : current.allowlist
  };
  profiles[connectorId] = next;
  writeAuthProfiles(profiles);
  appendConnectorAudit(connectorId, 'auth_profile_updated', {
    enabled: next.enabled,
    allowlistCount: (next.allowlist || []).length,
    mode: next.mode || 'allowlist_required'
  });
  return next;
}

export function setConnectorStatus(connectorId, status, note = '') {
  const connectors = listConnectors().map((connector) => (
    connector.id === connectorId
      ? { ...connector, status, note, updatedAtMs: timestampMs(), trust: TRUST_STATES.TEMPORARY }
      : connector
  ));
  writeRows(CONNECTOR_KEY, connectors);
  appendConnectorAudit(connectorId, 'status_updated', { status, note });
  return connectors.find((connector) => connector.id === connectorId);
}

export function appendConnectorAudit(connectorId, action, details = {}) {
  const rows = readRows(CONNECTOR_AUDIT_KEY);
  const entry = {
    id: `connector-audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    connectorId,
    action,
    details,
    timestampMs: timestampMs(),
    trust: TRUST_STATES.TEMPORARY
  };
  rows.push(entry);
  writeRows(CONNECTOR_AUDIT_KEY, rows);
  return entry;
}

export async function verifyConnectorEnvironment(connectorId) {
  const connector = listConnectors().find((item) => item.id === connectorId);
  if (!connector) return null;
  if (!connector.requiredEnv?.length) {
    const foundationOnly = ['mobile_bridge', 'sd_webui', 'comfyui_video'].includes(connector.id);
    let health = null;
    if (['sd_webui', 'comfyui_video'].includes(connector.id)) {
      try {
        health = await invoke('connector_check_local_runtime_health', { connectorId: connector.id });
      } catch (error) {
        health = {
          ok: false,
          connectorId: connector.id,
          provider: connector.id === 'sd_webui' ? 'automatic1111' : 'comfyui',
          endpoint: connector.id === 'sd_webui' ? 'http://127.0.0.1:7860' : 'http://127.0.0.1:8188',
          probePath: connector.id === 'sd_webui' ? '/sdapi/v1/samplers' : '/system_stats',
          checkedAtMs: timestampMs(),
          trust: TRUST_STATES.FAILED,
          message: 'Local runtime health probe failed.',
          error: String(error)
        };
      }
    }
    return {
      connectorId,
      ok: foundationOnly ? Boolean(health?.ok ?? false) : true,
      envPresence: {},
      status: foundationOnly ? 'foundation_only' : 'configured',
      checkedAtMs: timestampMs(),
      lastTestAtMs: timestampMs(),
      lastTestStatus: foundationOnly
        ? (health?.ok ? 'verified' : health ? 'failed' : 'foundation_only')
        : 'configured',
      lastTestError: health?.error || null,
      health,
      trust: foundationOnly
        ? (connector.id === 'mobile_bridge' ? TRUST_STATES.PLACEHOLDER : health?.ok ? TRUST_STATES.VERIFIED : TRUST_STATES.FAILED)
        : TRUST_STATES.VERIFIED
    };
  }

  let envPresence = {};
  try {
    envPresence = await invoke('check_env_vars_presence', { names: connector.requiredEnv });
  } catch (error) {
    appendConnectorAudit(connector.id, 'env_check_failed', { error: String(error) });
    return {
      connectorId,
      ok: false,
      envPresence: {},
      status: 'not_configured',
      checkedAtMs: timestampMs(),
      lastTestAtMs: timestampMs(),
      lastTestStatus: 'failed',
      lastTestError: String(error),
      trust: TRUST_STATES.FAILED,
      error: String(error)
    };
  }

  let ok = connector.requiredEnv.every((name) => Boolean(envPresence[name]));
  let missing = connector.requiredEnv.filter((name) => !envPresence[name]);
  if (connector.id === 'whatsapp') {
    const cloudSet = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'];
    const twilioSet = ['WHATSAPP_TWILIO_ACCOUNT_SID', 'WHATSAPP_TWILIO_AUTH_TOKEN', 'WHATSAPP_TWILIO_FROM'];
    const providerPresence = await invoke('check_env_vars_presence', { names: [...cloudSet, ...twilioSet] });
    envPresence = { ...envPresence, ...providerPresence };
    const cloudReady = cloudSet.every((name) => Boolean(providerPresence[name]));
    const twilioReady = twilioSet.every((name) => Boolean(providerPresence[name]));
    ok = ok && (cloudReady || twilioReady);
    missing = [
      ...missing,
      ...(cloudReady || twilioReady ? [] : ['WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TWILIO_*'])
    ];
  }
  const status = ok ? 'configured' : 'not_configured';
  const connectors = listConnectors().map((item) => (
    item.id === connector.id
      ? {
        ...item,
        status,
        envPresence,
        lastTestAtMs: timestampMs(),
        lastTestStatus: ok ? 'verified' : 'setup_required',
        lastTestError: ok ? null : 'Connector environment is incomplete.',
        updatedAtMs: timestampMs(),
        trust: ok ? TRUST_STATES.VERIFIED : TRUST_STATES.UNVERIFIED,
        disabledReason: ok
          ? `${connector.name} env requirements verified in runtime environment.`
          : `${connector.name} env requirements are incomplete.`
      }
      : item
  ));
  writeRows(CONNECTOR_KEY, connectors);
  appendConnectorAudit(connector.id, 'env_verified', {
    ok,
    missing,
    requiredCount: connector.requiredEnv.length
  });
  return {
    connectorId: connector.id,
    ok,
    envPresence,
    status,
    checkedAtMs: timestampMs(),
    lastTestAtMs: timestampMs(),
    lastTestStatus: ok ? 'verified' : 'setup_required',
    lastTestError: ok ? null : 'Connector environment is incomplete.',
    trust: ok ? TRUST_STATES.VERIFIED : TRUST_STATES.UNVERIFIED
  };
}

export function parseInboundConnectorMessage(connectorId, text, senderId = '') {
  const clean = String(text || '').trim();
  const lowered = clean.toLowerCase();
  let targetAgent = AGENTS.JOSE;
  if (lowered.startsWith('ask hector')) targetAgent = AGENTS.HECTOR;
  if (lowered.startsWith('ask miya')) targetAgent = AGENTS.MIYA;
  if (lowered.startsWith('ask alphonso')) targetAgent = AGENTS.ALPHONSO;

  const risky = /delete|remove|run|execute|upload|post|send|buy|purchase|deploy|restore/i.test(clean);
  const external = /upload|publish|post|youtube|telegram|whatsapp|send/i.test(clean);

  const authProfiles = readAuthProfiles();
  const profile = authProfiles[connectorId] || { enabled: false, allowlist: [], mode: 'allowlist_required' };
  const normalizedSender = String(senderId || '').trim();
  const allowlist = Array.isArray(profile.allowlist) ? profile.allowlist : [];
  const isAuthorized = profile.enabled && normalizedSender && allowlist.includes(normalizedSender);

  return {
    connectorId,
    senderId: normalizedSender || null,
    originalText: clean,
    routeTo: targetAgent,
    routedThrough: AGENTS.JOSE,
    requiresApproval: risky || external,
    riskLevel: external ? 'high' : risky ? 'medium' : 'low',
    parsedAtMs: timestampMs(),
    auth: {
      mode: profile.mode || 'allowlist_required',
      enabled: Boolean(profile.enabled),
      allowlistCount: allowlist.length,
      isAuthorized
    }
  };
}

export function createConnectorRoutePacket(connectorId, text, senderId = '') {
  const parsed = parseInboundConnectorMessage(connectorId, text, senderId);
  if (!parsed.auth.isAuthorized) {
    appendConnectorAudit(connectorId, 'route_rejected_unauthorized', {
      senderId: parsed.senderId,
      routeTo: parsed.routeTo,
      textPreview: parsed.originalText.slice(0, 120)
    });
    return {
      packet: null,
      rejected: true,
      reason: 'Sender is not authorized in connector allowlist.',
      parsed
    };
  }

  const packet = createAgentPacket({
    fromAgent: connectorId,
    toAgent: AGENTS.JOSE,
    title: `${connectorId} inbound route`,
    packetType: 'connector_inbound_message',
    payload: parsed,
    source: `${connectorId}-bridge`,
    confidence: TRUST_STATES.TEMPORARY,
    verificationState: TRUST_STATES.UNVERIFIED,
    requiresApproval: true,
    riskLevel: parsed.riskLevel,
    actionType: 'remote_message_route',
    commandPreview: parsed.originalText,
    fileChangePreview: 'No file change. Connector message route only.',
    rollbackAvailable: false
  });

  appendConnectorAudit(connectorId, 'route_packet_created', {
    packetId: packet.id,
    riskLevel: parsed.riskLevel,
    senderId: parsed.senderId,
    routeTo: parsed.routeTo
  });

  appendSessionEvent({
    category: 'connector',
    title: `${connectorId} inbound message routed to Jose`,
    details: { packetId: packet.id, riskLevel: parsed.riskLevel, routeTo: parsed.routeTo },
    agent: AGENTS.JOSE,
    confidence: TRUST_STATES.TEMPORARY,
    verificationState: TRUST_STATES.UNVERIFIED
  });

  return { packet, rejected: false, reason: null, parsed };
}

export async function pollTelegramConnector(limit = 12) {
  const readiness = await requireConnectorReady('telegram', 'inbound_poll', `poll limit ${limit}`);
  if (!readiness.ok) {
    return { ok: false, count: 0, routed: 0, rejected: 0, messages: [], ...readiness };
  }
  let proof;
  try {
    proof = await invoke('connector_poll_telegram', { limit });
  } catch (error) {
    appendConnectorAudit('telegram', 'poll_failed', { error: String(error) });
    return {
      ok: false,
      count: 0,
      routed: 0,
      rejected: 0,
      messages: [],
      error: String(error)
    };
  }

  const messages = Array.isArray(proof?.messages) ? proof.messages : [];
  let routed = 0;
  let rejected = 0;
  let joseDistributed = 0;
  let joseFailures = 0;
  const packets = [];
  for (const message of messages) {
    const senderId = message?.fromId || message?.chatId || '';
    const route = createConnectorRoutePacket('telegram', message?.text || '', senderId);
    if (route?.rejected) {
      rejected += 1;
      continue;
    }
    if (route?.packet) {
      routed += 1;
      packets.push(route.packet);
      appendConnectorAudit('telegram', 'poll_message_routed', {
        packetId: route.packet.id,
        updateId: message?.updateId ?? null,
        chatId: message?.chatId ?? null
      });
      try {
        const command = await createJoseCommandRoute({
          commandText: route?.parsed?.originalText || message?.text || '',
          source: 'telegram'
        });
        if (command?.id) {
          joseDistributed += 1;
          updatePacketStatus(route.packet.id, 'reported_to_jose', {
            joseCommandId: command.id,
            commandDistributedAtMs: timestampMs(),
            verificationState: TRUST_STATES.VERIFIED,
            confidence: TRUST_STATES.VERIFIED
          });
          appendConnectorAudit('telegram', 'jose_command_distributed', {
            packetId: route.packet.id,
            commandId: command.id,
            assignmentCount: command.assignments?.length || 0
          });
        }
      } catch (error) {
        joseFailures += 1;
        const retried = requestPacketRetry(route.packet.id, `Jose distribution failed: ${String(error)}`);
        const retryCount = Number(retried?.retryCount || 0);
        if (retryCount >= 3) {
          sendPacketToDeadLetter(route.packet.id, 'Connector route exceeded retry attempts during Jose distribution.');
        }
        appendConnectorAudit('telegram', 'jose_command_distribution_failed', {
          packetId: route.packet.id,
          error: String(error),
          retryCount
        });
      }
    }
  }

  return {
    ok: Boolean(proof?.ok),
    count: messages.length,
    routed,
    rejected,
    joseDistributed,
    joseFailures,
    packets,
    cursor: proof?.cursor ?? null,
    trust: proof?.trust || TRUST_STATES.TEMPORARY,
    error: proof?.error || null
  };
}

export async function pollWhatsAppConnector(limit = 12) {
  const readiness = await requireConnectorReady('whatsapp', 'inbound_poll', `poll limit ${limit}`);
  if (!readiness.ok) {
    return { ok: false, count: 0, routed: 0, rejected: 0, messages: [], ...readiness };
  }
  let proof;
  try {
    proof = await invoke('connector_poll_whatsapp', { limit });
  } catch (error) {
    appendConnectorAudit('whatsapp', 'poll_failed', { error: String(error) });
    return {
      ok: false,
      count: 0,
      routed: 0,
      rejected: 0,
      messages: [],
      error: String(error)
    };
  }

  const messages = Array.isArray(proof?.messages) ? proof.messages : [];
  let routed = 0;
  let rejected = 0;
  let joseDistributed = 0;
  let joseFailures = 0;
  const packets = [];

  for (const message of messages) {
    const senderId = message?.fromId || message?.chatId || '';
    const route = createConnectorRoutePacket('whatsapp', message?.text || '', senderId);
    if (route?.rejected) {
      rejected += 1;
      continue;
    }
    if (route?.packet) {
      routed += 1;
      packets.push(route.packet);
      appendConnectorAudit('whatsapp', 'poll_message_routed', {
        packetId: route.packet.id,
        chatId: message?.chatId ?? null
      });
      try {
        const command = await createJoseCommandRoute({
          commandText: route?.parsed?.originalText || message?.text || '',
          source: 'whatsapp'
        });
        if (command?.id) {
          joseDistributed += 1;
          updatePacketStatus(route.packet.id, 'reported_to_jose', {
            joseCommandId: command.id,
            commandDistributedAtMs: timestampMs(),
            verificationState: TRUST_STATES.VERIFIED,
            confidence: TRUST_STATES.VERIFIED
          });
          appendConnectorAudit('whatsapp', 'jose_command_distributed', {
            packetId: route.packet.id,
            commandId: command.id,
            assignmentCount: command.assignments?.length || 0
          });
        }
      } catch (error) {
        joseFailures += 1;
        const retried = requestPacketRetry(route.packet.id, `Jose distribution failed: ${String(error)}`);
        const retryCount = Number(retried?.retryCount || 0);
        if (retryCount >= 3) {
          sendPacketToDeadLetter(route.packet.id, 'Connector route exceeded retry attempts during Jose distribution.');
        }
        appendConnectorAudit('whatsapp', 'jose_command_distribution_failed', {
          packetId: route.packet.id,
          error: String(error),
          retryCount
        });
      }
    }
  }

  return {
    ok: Boolean(proof?.ok),
    count: messages.length,
    routed,
    rejected,
    joseDistributed,
    joseFailures,
    packets,
    cursor: proof?.cursor ?? null,
    trust: proof?.trust || TRUST_STATES.TEMPORARY,
    error: proof?.error || null
  };
}

export function normalizeWhatsAppCloudInboundPayload(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const messages = [];
  entries.forEach((entry) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    changes.forEach((change) => {
      const value = change?.value || {};
      const metaPhone = value?.metadata?.display_phone_number || null;
      const incoming = Array.isArray(value?.messages) ? value.messages : [];
      incoming.forEach((msg) => {
        const text = msg?.text?.body ? String(msg.text.body).trim() : '';
        if (!text) return;
        messages.push({
          provider: 'whatsapp_cloud_api',
          chatId: String(msg?.from || ''),
          fromId: String(msg?.from || ''),
          text,
          messageId: String(msg?.id || ''),
          phoneNumber: metaPhone,
          receivedAtMs: timestampMs()
        });
      });
    });
  });
  return messages;
}

export async function verifyWhatsAppCloudWebhookChallenge({ mode, verifyToken, challenge }) {
  try {
    return await invoke('verify_whatsapp_cloud_webhook_challenge', {
      mode: mode || null,
      verifyToken: verifyToken || null,
      challenge: challenge || null
    });
  } catch (error) {
    return {
      ok: false,
      trust: TRUST_STATES.FAILED,
      error: String(error),
      checkedAtMs: timestampMs()
    };
  }
}

export async function verifyWhatsAppCloudWebhookSignature({ rawBody, signatureHeader }) {
  try {
    return await invoke('verify_whatsapp_cloud_webhook_signature', {
      rawBody: String(rawBody || ''),
      signatureHeader: signatureHeader || null
    });
  } catch (error) {
    return {
      ok: false,
      trust: TRUST_STATES.FAILED,
      error: String(error),
      checkedAtMs: timestampMs()
    };
  }
}

export async function simulateWhatsAppCloudInbound(payload) {
  let messages = normalizeWhatsAppCloudInboundPayload(payload);
  try {
    const proof = await invoke('normalize_whatsapp_cloud_inbound', {
      rawBody: JSON.stringify(payload || {})
    });
    if (proof?.ok && Array.isArray(proof.messages)) {
      messages = proof.messages.map((message) => ({
        provider: 'whatsapp_cloud_api',
        chatId: message.chatId || '',
        fromId: message.fromId || '',
        text: message.text || '',
        messageId: '',
        phoneNumber: null,
        receivedAtMs: message.receivedAtMs || timestampMs()
      }));
    }
  } catch {
    // Fall back to JS normalization.
  }
  const routed = [];
  const rejected = [];
  messages.forEach((message) => {
    const result = createConnectorRoutePacket('whatsapp', message.text, message.fromId);
    if (result?.rejected) {
      rejected.push({
        ...message,
        reason: result.reason
      });
      return;
    }
    if (result?.packet) {
      updatePacketStatus(result.packet.id, 'reported_to_jose', {
        connectorSimulation: true,
        verificationState: TRUST_STATES.TEMPORARY
      });
      appendConnectorAudit('whatsapp', 'cloud_inbound_simulated_route', {
        packetId: result.packet.id,
        fromId: message.fromId,
        messageId: message.messageId
      });
      routed.push({
        ...message,
        packetId: result.packet.id
      });
    }
  });
  return {
    ok: true,
    provider: 'whatsapp_cloud_api',
    setupRequired: true,
    setupRequiredReason: 'Cloud API inbound needs hosted webhook endpoint + signature verification wiring in deployment environment.',
    count: messages.length,
    routedCount: routed.length,
    rejectedCount: rejected.length,
    routed,
    rejected
  };
}

async function requireConnectorApproval(connectorId, actionType, summary, options = {}) {
  return requireApproval({
    actionType,
    approved: Boolean(options.approved),
    force: true,
    summary,
    reason: options.reason || '',
    riskLevel: options.riskLevel || 'high',
    requestedBy: options.requestedBy || 'jose',
    workflowId: options.workflowId || 'connector_policy',
    commandId: options.commandId || null,
    packetId: options.packetId || null,
    metadata: {
      connectorId,
      target: options.target || null,
      ...options.metadata
    }
  });
}

export async function sendTelegramConnectorMessage(chatId, text, options = {}) {
  const auth = isConnectorAuthenticated('telegram');
  if (!auth.ok) {
    return logUnauthenticatedConnectorRequest('telegram', 'external_send', text, {
      ...options,
      target: chatId
    });
  }
  const approval = await requireConnectorApproval('telegram', 'external_send', text, {
    ...options,
    target: chatId
  });
  if (!approval.ok) return approval;
  const readiness = await requireConnectorReady('telegram', 'external_send', text, options);
  if (!readiness.ok) return readiness;
  const gate = gateConnectorAction('telegram', 'external_send', text, options);
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'telegram',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'Telegram policy gate blocked the action.'
    };
  }
  const result = await invoke('connector_send_telegram', { chatId, text });
  appendConnectorAudit('telegram', result?.ok ? 'send_success' : 'send_failed', {
    target: chatId,
    externalId: result?.externalId || null,
    error: result?.error || null
  });
  return result;
}

export async function proveTelegramConnectorPath(chatId, text, options = {}) {
  const proofText = String(text || '').trim() || 'Alphonso Telegram live proof.';
  const proofTarget = String(chatId || '').trim();
  if (!proofTarget) {
    return {
      ok: false,
      connectorId: 'telegram',
      blocked: true,
      setupRequired: true,
      trust: TRUST_STATES.UNVERIFIED,
      error: 'Telegram chat id is required for live proof.'
    };
  }

  const envProof = await verifyConnectorEnvironment('telegram');
  if (!envProof?.ok) {
    return {
      ok: false,
      connectorId: 'telegram',
      blocked: true,
      setupRequired: true,
      envProof,
      trust: envProof?.trust || TRUST_STATES.UNVERIFIED,
      error: envProof?.error || 'Telegram environment is not configured.'
    };
  }

  const result = await sendTelegramConnectorMessage(proofTarget, proofText, {
    ...options,
    approved: options.approved ?? true,
    requestedBy: options.requestedBy || 'jose',
    reason: options.reason || 'Telegram live connector proof path'
  });

  appendConnectorAudit('telegram', result?.ok ? 'live_proof_success' : 'live_proof_failed', {
    target: proofTarget,
    externalId: result?.externalId || null,
    error: result?.error || null
  });

  return {
    ...result,
    connectorId: 'telegram',
    proofType: 'telegram_live_send',
    proofMode: 'live_connector_proof',
    proofTarget,
    proofText,
    setupRequired: false,
    verifiedAtMs: timestampMs()
  };
}

export async function sendWhatsAppConnectorMessage(to, text, options = {}) {
  const auth = isConnectorAuthenticated('whatsapp');
  if (!auth.ok) {
    return logUnauthenticatedConnectorRequest('whatsapp', 'external_send', text, {
      ...options,
      target: to
    });
  }
  const approval = await requireConnectorApproval('whatsapp', 'external_send', text, {
    ...options,
    target: to
  });
  if (!approval.ok) return approval;
  const readiness = await requireConnectorReady('whatsapp', 'external_send', text, options);
  if (!readiness.ok) return readiness;
  const gate = gateConnectorAction('whatsapp', 'external_send', text, options);
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'whatsapp',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'WhatsApp policy gate blocked the action.'
    };
  }
  const result = await invoke('connector_send_whatsapp', { to, text });
  appendConnectorAudit('whatsapp', result?.ok ? 'send_success' : 'send_failed', {
    target: to,
    externalId: result?.externalId || null,
    error: result?.error || null
  });
  return result;
}

export async function sendChatGptConnectorMessage(text, options = {}) {
  const auth = isConnectorAuthenticated('chatgpt');
  if (!auth.ok) {
    return logUnauthenticatedConnectorRequest('chatgpt', 'paid_connector_send', text, options);
  }

  // Check for missing API key before any network call
  let envCheck = null;
  try {
    envCheck = await invoke('check_env_vars_presence', { names: ['OPENAI_API_KEY'] });
  } catch {
    envCheck = null;
  }
  if (envCheck && !envCheck['OPENAI_API_KEY']) {
    appendConnectorAudit('chatgpt', 'send_blocked_missing_key', { text: String(text || '').slice(0, 80) });
    return {
      success: false,
      ok: false,
      connectorId: 'chatgpt',
      blocked: true,
      error: 'API key missing — configure OPENAI_API_KEY in settings',
      code: 'MISSING_KEY',
      trust: TRUST_STATES.FAILED
    };
  }

  const approval = await requireConnectorApproval('chatgpt', 'paid_connector_send', text, options);
  if (!approval.ok) return approval;
  const readiness = await requireConnectorReady('chatgpt', 'paid_connector_send', text, options);
  if (!readiness.ok) return readiness;
  const gate = gateConnectorAction('chatgpt', 'paid_connector_send', text, options);
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'chatgpt',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'ChatGPT connector policy gate blocked the action.'
    };
  }

  let result;
  try {
    const timeoutMs = options.timeoutMs || 30000;
    const invokePromise = invoke('connector_send_chatgpt', { text });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('CONNECTOR_TIMEOUT')), timeoutMs)
    );
    result = await Promise.race([invokePromise, timeoutPromise]);
  } catch (error) {
    const errMsg = String(error || '');
    const isTimeout = errMsg === 'CONNECTOR_TIMEOUT' || errMsg.toLowerCase().includes('timeout');
    const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('rate_limit');
    const isMissingKey = errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('unauthorized') || errMsg.includes('401');

    let userError, code;
    if (isTimeout) {
      userError = 'Request timed out after 30s';
      code = 'TIMEOUT';
    } else if (isRateLimit) {
      userError = 'Rate limited — wait 60s and retry';
      code = 'RATE_LIMITED';
    } else if (isMissingKey) {
      userError = 'API key missing — configure OPENAI_API_KEY in settings';
      code = 'MISSING_KEY';
    } else {
      userError = `ChatGPT connector error: ${errMsg}`;
      code = 'INVOKE_ERROR';
    }

    appendConnectorAudit('chatgpt', 'send_failed', { error: errMsg, code });
    return {
      success: false,
      ok: false,
      connectorId: 'chatgpt',
      blocked: false,
      error: userError,
      code,
      trust: TRUST_STATES.FAILED
    };
  }

  // Handle HTTP-level error codes returned by the Rust command
  if (result && !result.ok) {
    const httpStatus = result.httpStatus || result.status || null;
    let userError = result.error || 'ChatGPT connector returned an error.';
    let code = 'SEND_FAILED';
    if (httpStatus === 429 || String(result.error || '').includes('429') || String(result.error || '').toLowerCase().includes('rate limit')) {
      userError = 'Rate limited — wait 60s and retry';
      code = 'RATE_LIMITED';
    } else if (httpStatus === 401 || httpStatus === 403) {
      userError = 'API key missing — configure OPENAI_API_KEY in settings';
      code = 'MISSING_KEY';
    }
    appendConnectorAudit('chatgpt', 'send_failed', { error: userError, code, httpStatus });
    return { success: false, ok: false, connectorId: 'chatgpt', error: userError, code, httpStatus, trust: TRUST_STATES.FAILED };
  }

  appendConnectorAudit('chatgpt', 'send_success', {
    target: result?.target || 'chatgpt',
    externalId: result?.externalId || null,
    error: result?.error || null
  });
  appendConnectorAuditEntry({ connectorId: 'chatgpt', ok: Boolean(result?.ok), latencyMs: null, errorCode: null });
  return result;
}

export async function sendClaudeConnectorMessage(text, options = {}) {
  const auth = isConnectorAuthenticated('claude');
  if (!auth.ok) {
    return logUnauthenticatedConnectorRequest('claude', 'paid_connector_send', text, options);
  }

  // Check for missing API key before any network call
  let envCheck = null;
  try {
    envCheck = await invoke('check_env_vars_presence', { names: ['ANTHROPIC_API_KEY'] });
  } catch {
    envCheck = null;
  }
  if (envCheck && !envCheck['ANTHROPIC_API_KEY']) {
    appendConnectorAudit('claude', 'send_blocked_missing_key', { text: String(text || '').slice(0, 80) });
    return {
      success: false,
      ok: false,
      connectorId: 'claude',
      blocked: true,
      error: 'API key missing — configure ANTHROPIC_API_KEY in settings',
      code: 'MISSING_KEY',
      trust: TRUST_STATES.FAILED
    };
  }

  const approval = await requireConnectorApproval('claude', 'paid_connector_send', text, options);
  if (!approval.ok) return approval;
  const readiness = await requireConnectorReady('claude', 'paid_connector_send', text, options);
  if (!readiness.ok) return readiness;
  const gate = gateConnectorAction('claude', 'paid_connector_send', text, options);
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'claude',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'Claude connector policy gate blocked the action.'
    };
  }

  let result;
  try {
    const timeoutMs = options.timeoutMs || 30000;
    const invokePromise = invoke('connector_send_claude', { text });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('CONNECTOR_TIMEOUT')), timeoutMs)
    );
    result = await Promise.race([invokePromise, timeoutPromise]);
  } catch (error) {
    const errMsg = String(error || '');
    const isTimeout = errMsg === 'CONNECTOR_TIMEOUT' || errMsg.toLowerCase().includes('timeout');
    const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('rate limit') || errMsg.toLowerCase().includes('rate_limit');
    const isMissingKey = errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('unauthorized') || errMsg.includes('401');

    let userError, code;
    if (isTimeout) {
      userError = 'Request timed out after 30s';
      code = 'TIMEOUT';
    } else if (isRateLimit) {
      userError = 'Rate limited — wait 60s and retry';
      code = 'RATE_LIMITED';
    } else if (isMissingKey) {
      userError = 'API key missing — configure ANTHROPIC_API_KEY in settings';
      code = 'MISSING_KEY';
    } else {
      userError = `Claude connector error: ${errMsg}`;
      code = 'INVOKE_ERROR';
    }

    appendConnectorAudit('claude', 'send_failed', { error: errMsg, code });
    return {
      success: false,
      ok: false,
      connectorId: 'claude',
      blocked: false,
      error: userError,
      code,
      trust: TRUST_STATES.FAILED
    };
  }

  // Handle HTTP-level error codes returned by the Rust command
  if (result && !result.ok) {
    const httpStatus = result.httpStatus || result.status || null;
    let userError = result.error || 'Claude connector returned an error.';
    let code = 'SEND_FAILED';
    if (httpStatus === 429 || String(result.error || '').includes('429') || String(result.error || '').toLowerCase().includes('rate limit')) {
      userError = 'Rate limited — wait 60s and retry';
      code = 'RATE_LIMITED';
    } else if (httpStatus === 401 || httpStatus === 403) {
      userError = 'API key missing — configure ANTHROPIC_API_KEY in settings';
      code = 'MISSING_KEY';
    }
    appendConnectorAudit('claude', 'send_failed', { error: userError, code, httpStatus });
    return { success: false, ok: false, connectorId: 'claude', error: userError, code, httpStatus, trust: TRUST_STATES.FAILED };
  }

  appendConnectorAudit('claude', 'send_success', {
    target: result?.target || 'claude',
    externalId: result?.externalId || null,
    error: result?.error || null
  });
  appendConnectorAuditEntry({ connectorId: 'claude', ok: Boolean(result?.ok), latencyMs: null, errorCode: null });
  return result;
}

export async function sendNotionConnectorEntry({ title, content = '', parentPageId = '' }, options = {}) {
  const auth = isConnectorAuthenticated('notion');
  if (!auth.ok) {
    return logUnauthenticatedConnectorRequest('notion', 'external_write', title, {
      ...options,
      target: parentPageId || 'env:NOTION_PARENT_PAGE_ID'
    });
  }
  const approval = await requireConnectorApproval('notion', 'external_write', title, {
    ...options,
    target: parentPageId || 'env:NOTION_PARENT_PAGE_ID'
  });
  if (!approval.ok) return approval;
  const readiness = await requireConnectorReady('notion', 'external_write', title, options);
  if (!readiness.ok) return readiness;
  const gate = gateConnectorAction('notion', 'external_write', title, options);
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'notion',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'Notion connector policy gate blocked the action.'
    };
  }
  const result = await invoke('connector_send_notion', {
    title,
    content,
    parentPageId: parentPageId || null
  });
  appendConnectorAudit('notion', result?.ok ? 'send_success' : 'send_failed', {
    target: parentPageId || 'env:NOTION_PARENT_PAGE_ID',
    externalId: result?.externalId || null,
    error: result?.error || null
  });
  return result;
}

export async function sendClickUpConnectorTask({ title, content = '', listId = '' }, options = {}) {
  const auth = isConnectorAuthenticated('clickup');
  if (!auth.ok) {
    return logUnauthenticatedConnectorRequest('clickup', 'external_write', title, {
      ...options,
      target: listId || 'env:CLICKUP_LIST_ID'
    });
  }
  const approval = await requireConnectorApproval('clickup', 'external_write', title, {
    ...options,
    target: listId || 'env:CLICKUP_LIST_ID'
  });
  if (!approval.ok) return approval;
  const readiness = await requireConnectorReady('clickup', 'external_write', title, options);
  if (!readiness.ok) return readiness;
  const gate = gateConnectorAction('clickup', 'external_write', title, options);
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'clickup',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'ClickUp connector policy gate blocked the action.'
    };
  }
  const result = await invoke('connector_send_clickup', {
    title,
    content,
    listId: listId || null
  });
  appendConnectorAudit('clickup', result?.ok ? 'send_success' : 'send_failed', {
    target: listId || 'env:CLICKUP_LIST_ID',
    externalId: result?.externalId || null,
    error: result?.error || null
  });
  return result;
}

export async function uploadYouTubeConnectorVideo({
  filePath,
  title,
  description = '',
  tags = [],
  privacyStatus = 'private'
}, options = {}) {
  const auth = isConnectorAuthenticated('youtube');
  if (!auth.ok) {
    return logUnauthenticatedConnectorRequest('youtube', 'external_publish', title, {
      ...options,
      target: filePath
    });
  }
  const approval = await requireConnectorApproval('youtube', 'external_publish', title, {
    ...options,
    target: filePath
  });
  if (!approval.ok) return approval;
  const readiness = await requireConnectorReady('youtube', 'external_publish', title, options);
  if (!readiness.ok) return readiness;
  const gate = gateConnectorAction('youtube', 'external_publish', title, options);
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'youtube',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'YouTube connector policy gate blocked the action.'
    };
  }
  const result = await invoke('connector_upload_youtube', {
    filePath,
    title,
    description,
    tags,
    privacyStatus
  });
  appendConnectorAudit('youtube', result?.ok ? 'upload_success' : 'upload_failed', {
    filePath,
    title,
    videoId: result?.videoId || null,
    url: result?.url || null,
    error: result?.error || null
  });
  return result;
}

export async function generateSdWebUiImage({
  prompt,
  negativePrompt = '',
  width = 768,
  height = 768,
  steps = 24,
  cfgScale = 7
}, options = {}) {
  const gate = gateConnectorAction('sd_webui', 'local_image_generation', prompt, { ...options, approved: true });
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'sd_webui',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'SD WebUI policy gate blocked the action.'
    };
  }
  const result = await invoke('connector_generate_sdwebui_image', {
    prompt,
    negativePrompt: negativePrompt || null,
    width,
    height,
    steps,
    cfgScale
  });
  appendConnectorAudit('sd_webui', result?.ok ? 'image_generation_success' : 'image_generation_failed', {
    provider: result?.provider || 'automatic1111',
    error: result?.error || null,
    message: result?.message || null
  });
  return result;
}

export async function queueComfyUiVideo({
  prompt,
  workflowJson
}, options = {}) {
  const gate = gateConnectorAction('comfyui_video', 'local_video_generation', prompt, { ...options, approved: true });
  if (!gate.ok) {
    return {
      ok: false,
      connectorId: 'comfyui_video',
      blocked: true,
      trust: gate.verificationState || TRUST_STATES.PENDING,
      error: gate.reason || 'ComfyUI policy gate blocked the action.'
    };
  }
  const result = await invoke('connector_queue_comfyui_video', {
    prompt,
    workflowJson
  });
  appendConnectorAudit('comfyui_video', result?.ok ? 'video_queue_success' : 'video_queue_failed', {
    provider: result?.provider || 'comfyui',
    jobId: result?.jobId || null,
    error: result?.error || null
  });
  return result;
}

export async function getComfyUiVideoHistory(promptId) {
  const result = await invoke('connector_get_comfyui_history', {
    promptId
  });
  appendConnectorAudit('comfyui_video', result?.ok ? 'video_history_success' : 'video_history_failed', {
    provider: result?.provider || 'comfyui',
    jobId: result?.jobId || promptId || null,
    error: result?.error || null,
    outputCount: Array.isArray(result?.outputPaths) ? result.outputPaths.length : 0
  });
  return result;
}

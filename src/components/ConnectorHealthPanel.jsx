import { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle,
  Circle,
  Clapperboard,
  FileText,
  Image,
  MessageCircle,
  PenLine,
  ShieldOff,
  Video,
  Wifi,
  WifiOff,
  Youtube,
  ZapOff
} from 'lucide-react';
import {
  listConnectors,
  listConnectorAuthProfiles,
  verifyConnectorEnvironment
} from '../services/connectorRegistryService';

// Icons per connector id
const CONNECTOR_ICONS = {
  telegram: MessageCircle,
  whatsapp: MessageCircle,
  youtube: Youtube,
  claude: Bot,
  chatgpt: Bot,
  notion: FileText,
  clickup: PenLine,
  sd_webui: Image,
  comfyui_video: Video,
  runway: Clapperboard,
  mobile_bridge: Wifi
};

// Human-friendly label map
const CONNECTOR_LABELS = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  youtube: 'YouTube',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  notion: 'Notion',
  clickup: 'ClickUp',
  sd_webui: 'SD WebUI',
  comfyui_video: 'ComfyUI',
  runway: 'Runway',
  mobile_bridge: 'Mobile Bridge'
};

/**
 * Derives a simplified UX status from the connector registry object.
 *
 * Returns one of:
 *   'live'           — configured + env verified + last test verified
 *   'missing_config' — has required env keys but none are present
 *   'foundation_only'— local-only connector with no env requirements
 *   'disabled'       — everything else (not_configured, unknown, etc.)
 */
function deriveStatus(connector) {
  if (!connector) return 'disabled';
  const status = String(connector.status || '').toLowerCase();
  const requiredEnv = Array.isArray(connector.requiredEnv) ? connector.requiredEnv : [];
  const envPresence = connector.envPresence || {};

  if (status === 'foundation_only') return 'foundation_only';

  if (status === 'configured') {
    const allEnvPresent = requiredEnv.length === 0 || requiredEnv.every((k) => Boolean(envPresence[k]));
    const testOk = connector.lastTestStatus === 'verified';
    if (allEnvPresent && testOk) return 'live';
    // configured but env missing or test not verified
    return 'missing_config';
  }

  if (requiredEnv.length > 0) {
    const anyPresent = requiredEnv.some((k) => Boolean(envPresence[k]));
    if (anyPresent) return 'missing_config';
  }

  return 'disabled';
}

const STATUS_BADGE = {
  live: {
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    label: 'Live'
  },
  missing_config: {
    dot: 'bg-amber-400',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    label: 'Missing Config'
  },
  foundation_only: {
    dot: 'bg-slate-400',
    badge: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    label: 'Local Only'
  },
  disabled: {
    dot: 'bg-zinc-600',
    badge: 'border-zinc-600/30 bg-zinc-800/40 text-zinc-500',
    label: 'Disabled'
  }
};

function ConnectorCard({ connector, zeroCostMode }) {
  const status = deriveStatus(connector);
  const { dot, badge, label } = STATUS_BADGE[status] || STATUS_BADGE.disabled;
  const Icon = CONNECTOR_ICONS[connector.id] || Circle;
  const displayName = CONNECTOR_LABELS[connector.id] || connector.name;
  const requiredEnv = Array.isArray(connector.requiredEnv) ? connector.requiredEnv : [];
  const envPresence = connector.envPresence || {};
  const zeroCostBlocking = zeroCostMode && ['claude', 'chatgpt', 'runway', 'youtube'].includes(connector.id);

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
      status === 'live'
        ? 'border-emerald-500/20 bg-emerald-500/5'
        : status === 'missing_config'
          ? 'border-amber-500/20 bg-amber-500/5'
          : status === 'foundation_only'
            ? 'border-slate-500/20 bg-slate-500/5'
            : 'border-white/[0.06] bg-zinc-900/40'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 shrink-0 ${
            status === 'live' ? 'text-emerald-400' :
            status === 'missing_config' ? 'text-amber-400' :
            status === 'foundation_only' ? 'text-slate-400' :
            'text-zinc-600'
          }`} />
          <span className="text-sm font-semibold text-zinc-100 leading-tight">{displayName}</span>
        </div>

        {/* Status badge */}
        <span className={`shrink-0 flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </span>
      </div>

      {/* Transport */}
      <div className="text-[10px] text-zinc-600 font-mono leading-relaxed truncate">
        {connector.transport || 'unknown'}
      </div>

      {/* Zero-cost mode warning */}
      {zeroCostBlocking && (
        <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300/90">
          <ZapOff className="w-3 h-3 shrink-0" />
          Blocked by zero-cost mode
        </div>
      )}

      {/* Env keys */}
      {requiredEnv.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-600">Required env</div>
          {requiredEnv.map((key) => {
            const present = Boolean(envPresence[key]);
            return (
              <div key={key} className="flex items-center justify-between rounded bg-black/20 px-2 py-0.5 font-mono text-[9px]">
                <span className="text-zinc-500 truncate">{key}</span>
                <span className={`shrink-0 ml-2 ${present ? 'text-emerald-400' : 'text-zinc-700'}`}>
                  {present ? 'present' : 'missing'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {requiredEnv.length === 0 && (
        <div className="text-[10px] text-zinc-600 italic">No credentials required</div>
      )}

      {/* Last test */}
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
        {status === 'live' ? (
          <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
        ) : (
          <ShieldOff className="w-3 h-3 shrink-0" />
        )}
        <span>
          Health: {connector.lastTestStatus || 'not run'}
          {connector.lastTestAtMs ? ` · ${new Date(connector.lastTestAtMs).toLocaleDateString()}` : ''}
        </span>
      </div>

      {/* Disabled reason */}
      {status !== 'live' && connector.disabledReason && (
        <div className="text-[10px] text-zinc-600 leading-relaxed line-clamp-2">
          {connector.disabledReason}
        </div>
      )}

      {/* Test button placeholder */}
      <button
        disabled
        title="Test connection — coming soon"
        className="mt-auto w-full rounded-lg border border-white/[0.06] bg-zinc-800/50 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600 cursor-not-allowed select-none"
      >
        Test Connection
      </button>
    </div>
  );
}

function StatusSummaryBar({ connectors, zeroCostMode }) {
  const counts = connectors.reduce(
    (acc, c) => {
      const s = deriveStatus(c);
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-zinc-900/50 px-4 py-2.5 text-[10px] font-semibold">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-emerald-300">{counts.live || 0} live</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        <span className="text-amber-300">{counts.missing_config || 0} missing config</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-slate-400" />
        <span className="text-slate-300">{counts.foundation_only || 0} local only</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-zinc-600" />
        <span className="text-zinc-500">{counts.disabled || 0} disabled</span>
      </div>
      {zeroCostMode && (
        <div className="ml-auto flex items-center gap-1.5 text-amber-400/80">
          <ZapOff className="w-3 h-3" />
          Zero-cost mode active
        </div>
      )}
    </div>
  );
}

export function ConnectorHealthPanel({ zeroCostMode = false }) {
  const [connectors, setConnectors] = useState(() => listConnectors());
  const [probing, setProbing] = useState(false);

  // Run env verification for all connectors on mount (best-effort)
  useEffect(() => {
    let cancelled = false;
    const probeAll = async () => {
      setProbing(true);
      const ids = listConnectors().map((c) => c.id);
      for (const id of ids) {
        if (cancelled) break;
        try {
          await verifyConnectorEnvironment(id);
        } catch {
          // ignore individual probe failures
        }
      }
      if (!cancelled) {
        setConnectors(listConnectors());
        setProbing(false);
      }
    };
    probeAll();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="space-y-4">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {probing ? (
              <WifiOff className="w-4 h-4 text-zinc-500 animate-pulse" />
            ) : (
              <Wifi className="w-4 h-4 text-teal-400" />
            )}
            <h2 className="text-sm font-bold tracking-widest text-zinc-200 uppercase">
              Connector Health
            </h2>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500 leading-relaxed">
            {probing
              ? 'Probing connector environments…'
              : 'Live status of all configured connector paths. Env keys are checked via the Tauri runtime.'}
          </p>
        </div>
        <button
          onClick={() => {
            setConnectors(listConnectors());
          }}
          className="shrink-0 rounded-lg border border-white/[0.06] bg-zinc-800 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Summary bar */}
      <StatusSummaryBar connectors={connectors} zeroCostMode={zeroCostMode} />

      {/* Card grid — 2 cols by default, 3 on wider viewports */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {connectors.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            zeroCostMode={zeroCostMode}
          />
        ))}
      </div>

      <p className="text-[10px] text-zinc-700 leading-relaxed">
        Status is derived from the connector registry and Tauri env probe. A connector is marked
        &quot;live&quot; only when all required env vars are present and the last test returned verified.
        Test buttons are placeholders — active testing is available in the Connector Setup panel
        (Operator tab).
      </p>
    </section>
  );
}

/**
 * Returns a compact status dot element for use in sidebars / headers.
 * color: 'green' | 'yellow' | 'gray'
 */
export function ConnectorStatusDot({ connectorId }) {
  const [status, setStatus] = useState('disabled');

  useEffect(() => {
    const connectors = listConnectors();
    const connector = connectors.find((c) => c.id === connectorId);
    setStatus(deriveStatus(connector));
  }, [connectorId]);

  const colorMap = {
    live: 'text-emerald-400',
    missing_config: 'text-amber-400',
    foundation_only: 'text-slate-400',
    disabled: 'text-zinc-700'
  };

  return (
    <span
      className={`text-[8px] leading-none select-none ${colorMap[status] || 'text-zinc-700'}`}
      title={`${connectorId}: ${status}`}
      aria-label={`${connectorId} status: ${status}`}
    >
      ●
    </span>
  );
}

/**
 * A compact header strip showing aggregated connector counts.
 * Use when there is no sidebar to show per-connector dots.
 */
export function ConnectorStatusStrip({ zeroCostMode = false }) {
  const [connectors, setConnectors] = useState(() => listConnectors());

  useEffect(() => {
    setConnectors(listConnectors());
  }, []);

  const counts = connectors.reduce((acc, c) => {
    const s = deriveStatus(c);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex items-center gap-3 text-[9px] font-semibold">
      {(counts.live || 0) > 0 && (
        <span className="flex items-center gap-1 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {counts.live} live
        </span>
      )}
      {(counts.missing_config || 0) > 0 && (
        <span className="flex items-center gap-1 text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {counts.missing_config} missing config
        </span>
      )}
      {(counts.disabled || 0) > 0 && (
        <span className="flex items-center gap-1 text-zinc-600">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
          {counts.disabled} disabled
        </span>
      )}
      {zeroCostMode && (
        <span className="flex items-center gap-1 text-amber-500/70">
          <ZapOff className="w-2.5 h-2.5" />
          zero-cost
        </span>
      )}
    </div>
  );
}

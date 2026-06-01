import { AlertTriangle, Shield, ShieldAlert } from 'lucide-react';

const RISK_BADGE = {
  high: {
    classes: 'border-red-500/40 bg-red-500/10 text-red-300',
    dot: 'bg-red-400',
    label: 'High Risk'
  },
  medium: {
    classes: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
    label: 'Medium Risk'
  },
  low: {
    classes: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
    label: 'Low Risk'
  }
};

function inferRiskLevel(label) {
  if (!label) return 'medium';
  const lower = String(label).toLowerCase();
  if (
    lower.includes('delete') ||
    lower.includes('destroy') ||
    lower.includes('remove') ||
    lower.includes('reset') ||
    lower.includes('drop') ||
    lower.includes('wipe') ||
    lower.includes('restore') ||
    lower.includes('publish') ||
    lower.includes('upload') ||
    lower.includes('send') ||
    lower.includes('execute command') ||
    lower.includes('run release')
  ) return 'high';
  if (
    lower.includes('verify') ||
    lower.includes('check') ||
    lower.includes('read') ||
    lower.includes('list') ||
    lower.includes('collect') ||
    lower.includes('build')
  ) return 'low';
  return 'medium';
}

function isDestructiveAction(label) {
  if (!label) return false;
  const lower = String(label).toLowerCase();
  return (
    lower.includes('delete') ||
    lower.includes('destroy') ||
    lower.includes('drop') ||
    lower.includes('wipe') ||
    lower.includes('reset') ||
    lower.includes('irreversible') ||
    lower.includes('restore snapshot')
  );
}

function inferConnector(label) {
  if (!label) return null;
  const lower = String(label).toLowerCase();
  if (lower.includes('telegram')) return 'Telegram';
  if (lower.includes('whatsapp')) return 'WhatsApp';
  if (lower.includes('youtube')) return 'YouTube';
  if (lower.includes('claude')) return 'Claude';
  if (lower.includes('chatgpt') || lower.includes('openai')) return 'ChatGPT';
  if (lower.includes('notion')) return 'Notion';
  if (lower.includes('clickup')) return 'ClickUp';
  if (lower.includes('runway')) return 'Runway';
  if (lower.includes('plugin')) return 'Plugin Sandbox';
  if (lower.includes('ollama')) return 'Ollama';
  if (lower.includes('snapshot')) return 'Recovery';
  if (lower.includes('workspace')) return 'Workspace';
  if (lower.includes('screen')) return 'Screen Observer';
  return null;
}

/**
 * ApprovalModal
 *
 * Props:
 *   label      — string: the action description (used by legacy callers)
 *   action     — string: explicit action name (overrides label when provided)
 *   connector  — string: explicit connector name (auto-inferred from label if omitted)
 *   riskLevel  — 'high' | 'medium' | 'low' (auto-inferred from label if omitted)
 *   onConfirm  — function: called when user clicks Approve
 *   onCancel   — function: called when user clicks Deny / presses Escape
 */
export function ApprovalModal({
  label,
  action,
  connector,
  riskLevel,
  onConfirm,
  onCancel
}) {
  const actionText = action || label || 'Unknown action';
  const resolvedConnector = connector || inferConnector(actionText);
  const resolvedRisk = riskLevel || inferRiskLevel(actionText);
  const destructive = isDestructiveAction(actionText);

  const risk = RISK_BADGE[resolvedRisk] || RISK_BADGE.medium;
  const RiskIcon = resolvedRisk === 'high' ? ShieldAlert : Shield;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-modal-title"
        className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-zinc-900 shadow-2xl p-6 space-y-4"
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <RiskIcon className={`w-5 h-5 shrink-0 mt-0.5 ${resolvedRisk === 'high' ? 'text-red-400' : 'text-amber-400'}`} />
          <div className="flex-1 min-w-0">
            <div
              id="approval-modal-title"
              className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-1"
            >
              Approval Required
            </div>
            <div className="text-sm text-zinc-200 leading-snug break-words">{actionText}</div>
          </div>
        </div>

        {/* Meta row: connector + risk badge */}
        <div className="flex items-center gap-2 flex-wrap">
          {resolvedConnector && (
            <div className="rounded-lg border border-white/10 bg-zinc-800/60 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
              {resolvedConnector}
            </div>
          )}
          <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${risk.classes}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${risk.dot}`} />
            {risk.label}
          </div>
        </div>

        {/* Destructive warning */}
        {destructive && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
            <div className="text-[11px] text-red-300 leading-relaxed font-semibold">
              This action is irreversible. Proceed only if you are certain.
            </div>
          </div>
        )}

        {/* Subtitle */}
        <div className="text-[11px] text-zinc-500">
          Jose requires explicit approval before this action executes. Denying will block the
          operation and log a rejection receipt.
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-zinc-400 bg-zinc-800 border border-white/10 hover:bg-zinc-700 transition-colors"
          >
            Deny
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-white transition-colors shadow-lg ${
              resolvedRisk === 'high'
                ? 'bg-red-700 hover:bg-red-600'
                : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

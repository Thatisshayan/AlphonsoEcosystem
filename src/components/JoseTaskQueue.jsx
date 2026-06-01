import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Inbox, Loader, RefreshCw, RotateCcw, SkipForward, XCircle } from 'lucide-react';
import { listAgentPackets, approvePacket, rejectPacket } from '../services/agentBusService';
import { listJoseCommands } from '../services/joseCommandRouterService';
import { getOrchestrationQueueSnapshot, replayPacketFromDeadLetter } from '../services/orchestrationQueueService';
import { AgentAvatar } from './AgentAvatar';

const STAGES = [
  { key: 'pending_approval', label: 'Pending',   icon: Clock,        color: 'text-amber-300',  ring: 'border-amber-500/30  bg-amber-950/30'  },
  { key: 'queued',           label: 'Queued',    icon: Inbox,        color: 'text-blue-300',   ring: 'border-blue-500/30   bg-blue-950/30'   },
  { key: 'executing',        label: 'Running',   icon: Loader,       color: 'text-indigo-300', ring: 'border-indigo-500/30 bg-indigo-950/30' },
  { key: 'approved',         label: 'Approved',  icon: CheckCircle2, color: 'text-emerald-300',ring: 'border-emerald-500/30 bg-emerald-950/30'},
  { key: 'failed',           label: 'Failed',    icon: AlertTriangle,color: 'text-red-300',    ring: 'border-red-500/30    bg-red-950/30'    },
  { key: 'dead_letter',      label: 'Dead',      icon: XCircle,      color: 'text-zinc-400',   ring: 'border-zinc-500/30   bg-zinc-900/40'   },
];

const ALL_KEY = 'all';

function statusStage(status) {
  return STAGES.find((s) => s.key === status) || { label: status, icon: Clock, color: 'text-zinc-400', ring: 'border-zinc-700 bg-zinc-900/40' };
}

function relTime(ts) {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function PacketCard({ packet, onApprove, onReject, onReplay }) {
  const stage = statusStage(packet.status);
  const Icon = stage.icon;
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${stage.ring}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${stage.color}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-zinc-100 leading-snug truncate">{packet.title || packet.packetType || packet.id}</div>
          <div className="flex flex-wrap items-center gap-1 mt-0.5 text-[10px] text-zinc-500">
            <AgentAvatar agentId={packet.fromAgent} name={packet.fromAgent} sizeClass="h-3.5 w-3.5" />
            <span>{packet.fromAgent}</span>
            <span>→</span>
            <AgentAvatar agentId={packet.toAgent} name={packet.toAgent} sizeClass="h-3.5 w-3.5" />
            <span>{packet.toAgent}</span>
            <span className="ml-1 opacity-50">·</span>
            <span>{relTime(packet.createdAt)}</span>
            {packet.riskLevel && <span className={`rounded px-1 font-bold uppercase tracking-widest ${packet.riskLevel === 'high' ? 'text-red-400' : 'text-zinc-500'}`}>{packet.riskLevel}</span>}
          </div>
        </div>
        <span className={`shrink-0 text-[9px] font-bold uppercase tracking-widest ${stage.color}`}>{stage.label}</span>
      </div>
      {(packet.commandPreview || packet.actionType) && (
        <div className="rounded-lg bg-black/20 px-2 py-1 text-[10px] font-mono text-zinc-400 truncate">
          {packet.commandPreview || packet.actionType}
        </div>
      )}
      <div className="flex gap-2">
        {packet.status === 'pending_approval' && (
          <>
            <button onClick={() => onApprove(packet.id)} className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-500/35 transition-colors">Approve</button>
            <button onClick={() => onReject(packet.id)}  className="rounded-lg bg-red-500/20    px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-red-200    hover:bg-red-500/35    transition-colors">Reject</button>
          </>
        )}
        {packet.status === 'dead_letter' && (
          <button onClick={() => onReplay(packet.id)} className="flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-amber-200 hover:bg-amber-500/35 transition-colors">
            <RotateCcw className="w-2.5 h-2.5" /> Replay
          </button>
        )}
      </div>
    </div>
  );
}

export function JoseTaskQueue({ onRefresh }) {
  const [filter, setFilter] = useState(ALL_KEY);
  const [packets, setPackets] = useState(() => listAgentPackets());
  const [commands, setCommands] = useState(() => listJoseCommands());
  const [snapshot, setSnapshot] = useState(() => getOrchestrationQueueSnapshot());

  const refresh = () => {
    setPackets(listAgentPackets());
    setCommands(listJoseCommands());
    setSnapshot(getOrchestrationQueueSnapshot());
    onRefresh?.();
  };

  const counts = useMemo(() => {
    const map = {};
    STAGES.forEach((s) => { map[s.key] = 0; });
    packets.forEach((p) => { if (map[p.status] !== undefined) map[p.status]++; });
    return map;
  }, [packets]);

  const visible = useMemo(() => {
    const list = filter === ALL_KEY ? packets : packets.filter((p) => p.status === filter);
    return list.slice().reverse().slice(0, 40);
  }, [packets, filter]);

  const handleApprove = (id) => { approvePacket(id, 'Jose queue approve'); refresh(); };
  const handleReject  = (id) => { rejectPacket(id,  'Jose queue reject');  refresh(); };
  const handleReplay  = (id) => { replayPacketFromDeadLetter(id, 'Manual replay'); refresh(); };

  const totalActive = (counts.pending_approval || 0) + (counts.queued || 0) + (counts.executing || 0);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/60 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-300">Jose Task Pipeline</span>
          {totalActive > 0 && (
            <span className="rounded-full bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 text-[9px] font-bold text-blue-300">{totalActive} active</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
          <span>cmds: {commands.length}</span>
          <button onClick={refresh} className="hover:text-zinc-300 transition-colors"><RefreshCw className="w-3 h-3" /></button>
        </div>
      </div>

      {/* Stage pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter(ALL_KEY)}
          className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest transition-colors ${filter === ALL_KEY ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          All ({packets.length})
        </button>
        {STAGES.map((s) => {
          const Icon = s.icon;
          const count = counts[s.key] || 0;
          return (
            <button
              key={s.key}
              onClick={() => setFilter(s.key)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest transition-colors border ${
                filter === s.key ? `${s.ring} ${s.color}` : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon className="w-2.5 h-2.5" />
              {s.label} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {/* Pipeline flow bar */}
      <div className="flex items-center gap-1 text-[9px]">
        {STAGES.slice(0, 4).map((s, i) => {
          const count = counts[s.key] || 0;
          return (
            <React.Fragment key={s.key}>
              <div className={`flex-1 rounded py-1 text-center font-bold transition-colors ${count > 0 ? `${s.ring} ${s.color}` : 'bg-zinc-900/40 text-zinc-700'}`}>
                {s.label}{count > 0 ? ` ${count}` : ''}
              </div>
              {i < 3 && <SkipForward className="w-2.5 h-2.5 text-zinc-700 shrink-0" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* Cards */}
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <p className="text-[11px] text-zinc-600 py-4 text-center">No tasks in this stage.</p>
        ) : (
          visible.map((p) => (
            <PacketCard key={p.id} packet={p} onApprove={handleApprove} onReject={handleReject} onReplay={handleReplay} />
          ))
        )}
      </div>

      {/* Jose command summary */}
      {commands.length > 0 && (
        <div className="border-t border-white/[0.04] pt-3 space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Jose Commands ({commands.length})</div>
          {commands.slice(-5).reverse().map((cmd) => (
            <div key={cmd.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-900/40 px-2 py-1">
              <span className="text-[10px] text-zinc-400 truncate flex-1">{cmd.commandText?.slice(0, 80) || cmd.id}</span>
              <span className={`text-[9px] font-bold uppercase shrink-0 ${cmd.status === 'reported_to_shayan' ? 'text-emerald-400' : cmd.status === 'failed' ? 'text-red-400' : 'text-zinc-500'}`}>{cmd.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

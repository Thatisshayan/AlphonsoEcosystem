import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Minus } from 'lucide-react';
import { listAgentProfiles } from '../agents/agentRegistry';
import { AgentAvatar } from './AgentAvatar';

const STORAGE_KEY = 'alphonso_agent_dock_minimized_v1';

function useOllamaStatus() {
  const [online, setOnline] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    }
    check();
    const interval = setInterval(check, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  return online;
}

export function AgentDock({ companions }) {
  const [minimized, setMinimized] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const registryAgents = listAgentProfiles();
  const activeIds = new Set(companions.map((item) => item.agentId));
  const otherAgents = registryAgents.filter((agent) => !activeIds.has(agent.id));
  const summary = companions.map((item) => item.name).join(' · ');
  const ollamaOnline = useOllamaStatus();

  function toggle() {
    setMinimized((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  }

  return (
    <div className="pointer-events-auto w-[17.5rem] rounded-xl border border-white/10 bg-zinc-950/95 shadow-xl backdrop-blur-xl overflow-hidden">
      {/* Header — always visible */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100 flex-1">Agent Dock</div>

        {/* Ollama connectivity pill */}
        <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${
          ollamaOnline === null
            ? 'border-zinc-700 bg-zinc-900/60 text-zinc-500'
            : ollamaOnline
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-red-500/30 bg-red-500/10 text-red-400'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            ollamaOnline === null ? 'bg-zinc-600' : ollamaOnline ? 'bg-emerald-400' : 'bg-red-400'
          }`} />
          {ollamaOnline === null ? 'checking' : ollamaOnline ? 'Ollama' : 'offline'}
        </div>

        {/* Minimize / expand button */}
        <button
          onClick={toggle}
          title={minimized ? 'Expand agent dock' : 'Minimize agent dock'}
          className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          {minimized ? <ChevronDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
        </button>
      </div>

      {/* Body — hidden when minimized */}
      {!minimized && (
        <div className="space-y-2 p-2.5">
          {/* Active companions summary row */}
          <div className="flex items-center gap-2 overflow-hidden rounded-lg border border-white/8 bg-zinc-900/60 px-2.5 py-2">
            <div className="flex -space-x-2 shrink-0">
              {companions.map((item) => (
                <div key={item.agentId} className="rounded-full border border-zinc-950 bg-zinc-950 p-0.5 shadow-md">
                  <AgentAvatar agentId={item.agentId} name={item.name} sizeClass="h-6 w-6" />
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-200 truncate">{summary}</div>
              <div className="text-[8px] text-zinc-400 truncate">Active companions</div>
            </div>
          </div>

          {/* Per-agent state grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {companions.map((item) => (
              <div key={item.agentId} className="rounded-lg border border-white/8 bg-zinc-900/45 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="shrink-0">
                    <AgentAvatar agentId={item.agentId} name={item.name} sizeClass="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-200 truncate">{item.name}</div>
                    <div className="text-[8px] text-zinc-500 truncate">{item.state}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Other (inactive) agents */}
          {otherAgents.length > 0 && (
            <div className="rounded-lg border border-white/8 bg-zinc-900/35 p-2">
              <div className="mb-1 text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-500">Other agents</div>
              <div className="flex flex-wrap gap-1">
                {otherAgents.map((agent) => (
                  <div key={agent.id} className="flex items-center gap-1 rounded-full border border-white/8 bg-zinc-950/60 px-1.5 py-1">
                    <AgentAvatar agentId={agent.id} name={agent.name} sizeClass="h-4 w-4" />
                    <span className="max-w-[4.5rem] truncate text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-300">{agent.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

// Simple in-memory log — imported by services to append events
export const agentActivityLog = [];

export function appendAgentActivity({ agent, action, detail }) {
  agentActivityLog.push({ agent, action, detail: detail || '', ts: Date.now() });
  if (agentActivityLog.length > 200) agentActivityLog.shift();
}

export function AgentActivityLog() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    setEntries([...agentActivityLog].reverse());
    const interval = setInterval(() => setEntries([...agentActivityLog].reverse()), 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.05] shrink-0">
        <Activity className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Agent Activity</span>
        <span className="ml-auto text-[10px] text-zinc-600">{entries.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {entries.length === 0 && (
          <div className="text-[11px] text-zinc-600 text-center py-8">No agent activity yet</div>
        )}
        {entries.map((e, i) => (
          <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-900/40 transition-colors">
            <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-500 w-12 shrink-0 mt-0.5">{e.agent}</span>
            <span className="text-[10px] text-zinc-400 flex-1 min-w-0 truncate">{e.action}{e.detail ? ` — ${e.detail}` : ''}</span>
            <span className="text-[9px] text-zinc-600 shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

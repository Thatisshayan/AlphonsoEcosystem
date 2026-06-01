import React, { Suspense, lazy, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Layers3,
  Network,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
  Workflow
} from 'lucide-react';
import {
  addPacketReference,
  approvePacket,
  listAgentPackets,
  listApprovalQueue,
  markPacketExecuted,
  rejectPacket
} from '../services/agentBusService';
import {
  installSkillPack,
  listSkillPackAudit,
  listSkillPacks,
  setSkillPackEnabled,
  uninstallSkillPack,
  validateSkillPackManifest
} from '../services/skillPackService';
import {
  WORKFLOW_NODE_LIBRARY,
  addWorkflowEdge,
  addWorkflowNode,
  createWorkflow,
  listWorkflows
} from '../services/workflowBuilderService';
import { appendSessionEvent, listSessionEvents, summarizeSession } from '../services/sessionIntelligenceService';
import { collectResourceSnapshot, listResourceSnapshots, summarizeResourceUsage } from '../services/resourceCostService';
import { listMarketplaceItems, setMarketplaceItemStatus } from '../services/localMarketplaceService';
import { listSnapshots } from '../services/recoveryService';
import { ConnectorSetupPanel } from './ConnectorSetupPanel';
import { ProductionReadinessPanel } from './ProductionReadinessPanel';
import { SelfDevelopmentPanel } from './SelfDevelopmentPanel';
import { EcosystemMaturityPanelsGate } from './EcosystemMaturityPanelsGate';

const WorkflowOperationsDashboard = lazy(() =>
  import('./WorkflowOperationsDashboard').then((module) => ({
    default: module.WorkflowOperationsDashboard
  }))
);

const AgentWorkshop = lazy(() =>
  import('./agentWorkshop/AgentWorkshop').then((module) => ({
    default: module.AgentWorkshop
  }))
);

export function EcosystemHub({ settings, setSettings, ollamaStatus, verificationLogs = [], voiceStatus, workspaceFoundation, updateCheckState, nativeSelfDevProof, setNativeSelfDevProof, nativeProofHooks }) {
  const [packets, setPackets] = useState(() => listAgentPackets());
  const [skills, setSkills] = useState(() => listSkillPacks());
  const [skillAudit, setSkillAudit] = useState(() => listSkillPackAudit());
  const [workflows, setWorkflows] = useState(() => listWorkflows());
  const [sessionSummary, setSessionSummary] = useState(() => summarizeSession(24));
  const [resourceSummary, setResourceSummary] = useState(() => summarizeResourceUsage(24));
  const [resourceSnapshots, setResourceSnapshots] = useState(() => listResourceSnapshots());
  const [marketItems, setMarketItems] = useState(() => listMarketplaceItems());
  const [snapshots, setSnapshots] = useState(() => listSnapshots());
  const [showAdvancedSections, setShowAdvancedSections] = useState(false);
  const [manifestInput, setManifestInput] = useState('{\n  "id": "pack.youtube-studio",\n  "name": "YouTube Pack",\n  "version": "1.0.0",\n  "permissions": ["memory.read", "workflows.write"],\n  "category": "creator"\n}');
  const [newWorkflowName, setNewWorkflowName] = useState('Shayan -> Jose -> Agents -> Jose Confirmation Flow');
  const [handoffNote, setHandoffNote] = useState('Creative packet validated and queued for supervised execution.');

  const approvalQueue = useMemo(() => listApprovalQueue(), [packets]);
  const timeline = useMemo(() => listSessionEvents().slice(-30).reverse(), [sessionSummary, packets, workflows, resourceSnapshots]);

  const refreshAll = () => {
    setPackets(listAgentPackets());
    setSkills(listSkillPacks());
    setSkillAudit(listSkillPackAudit());
    setWorkflows(listWorkflows());
    setSessionSummary(summarizeSession(24));
    setResourceSummary(summarizeResourceUsage(24));
    setResourceSnapshots(listResourceSnapshots());
    setMarketItems(listMarketplaceItems());
    setSnapshots(listSnapshots());
  };

  const runApprove = (packetId) => {
    approvePacket(packetId, 'operator');
    appendSessionEvent({
      category: 'approval',
      title: 'Packet approved',
      details: { packetId },
      agent: 'alphonso'
    });
    refreshAll();
  };

  const runReject = (packetId) => {
    rejectPacket(packetId, 'Rejected by operator review queue.');
    appendSessionEvent({
      category: 'approval',
      title: 'Packet rejected',
      details: { packetId },
      agent: 'alphonso'
    });
    refreshAll();
  };

  const runExecutePacket = (packetId) => {
    const packet = markPacketExecuted(packetId, {
      status: 'execution_report_ready',
      note: handoffNote
    });
    if (packet) {
      addPacketReference(packetId, {
        type: 'execution_report',
        value: `exec-${Date.now()}`
      });
    }
    appendSessionEvent({
      category: 'task',
      title: 'Packet marked executed',
      details: { packetId, status: 'resolved' },
      agent: 'alphonso'
    });
    refreshAll();
  };

  const runInstallSkillPack = () => {
    let parsed = null;
    try {
      parsed = JSON.parse(manifestInput);
    } catch {
      parsed = null;
    }

    if (!parsed) return;
    installSkillPack(parsed);
    appendSessionEvent({
      category: 'skill_pack',
      title: 'Skill pack installed',
      details: { id: parsed.id },
      agent: 'alphonso'
    });
    refreshAll();
  };

  const runValidateManifest = () => {
    let parsed = null;
    try {
      parsed = JSON.parse(manifestInput);
    } catch {
      parsed = null;
    }
    const result = validateSkillPackManifest(parsed);
    appendSessionEvent({
      category: 'verification',
      title: 'Skill manifest validation',
      details: result,
      agent: 'alphonso',
      verificationState: result.valid ? 'verified' : 'failed'
    });
    refreshAll();
  };

  const runCreateWorkflow = () => {
    const flow = createWorkflow(newWorkflowName, 'shared');
    let updated = addWorkflowNode(flow.id, 'trigger', { x: 0, y: 0 }, { label: 'Shayan command received' });
    updated = addWorkflowNode(flow.id, 'approval', { x: 220, y: 0 }, { label: 'Jose routes and gates approvals' });
    updated = addWorkflowNode(flow.id, 'action', { x: 440, y: 0 }, { label: 'Agents report back to Jose' });
    if (updated?.nodes?.length >= 3) {
      addWorkflowEdge(flow.id, updated.nodes[0].id, updated.nodes[1].id, 'always');
      addWorkflowEdge(flow.id, updated.nodes[1].id, updated.nodes[2].id, 'if approved');
    }
    appendSessionEvent({
      category: 'workflow',
      title: 'Workflow created',
      details: { id: flow.id, name: flow.name },
      agent: 'alphonso'
    });
    refreshAll();
  };

  const runResourceSnapshot = () => {
    collectResourceSnapshot({
      ollamaConnected: ollamaStatus.state === 'connected',
      modelName: settings.selectedModel,
      tokenEstimate: Math.round((timeline.length + packets.length) * 250)
    });
    appendSessionEvent({
      category: 'runtime',
      title: 'Resource snapshot collected',
      details: { model: settings.selectedModel || null },
      agent: 'alphonso'
    });
    refreshAll();
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
      <header className="rounded-2xl border border-white/10 bg-zinc-950/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 font-bold">Shared Agent Intelligence Bus</div>
            <h1 className="text-xl font-bold text-white mt-2">Operator + Creator Ecosystem</h1>
            <p className="text-sm text-zinc-400 mt-2 max-w-2xl">
          Local-first orchestration hub for handoffs, skill packs, visual workflows, session intelligence, and supervised runtime control.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/60 p-1">
            <button
              onClick={() => setShowAdvancedSections(false)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition ${!showAdvancedSections ? 'bg-indigo-500/20 text-indigo-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Essential
            </button>
            <button
              onClick={() => setShowAdvancedSections(true)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition ${showAdvancedSections ? 'bg-indigo-500/20 text-indigo-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Advanced
            </button>
          </div>
        </div>
      </header>

      <EcosystemMaturityPanelsGate
        showAdvancedSections={showAdvancedSections}
        settings={settings}
        setSettings={setSettings}
        ollamaStatus={ollamaStatus}
        verificationLogs={verificationLogs}
        voiceStatus={voiceStatus}
        workspaceFoundation={workspaceFoundation}
        onRefresh={refreshAll}
      />
      {showAdvancedSections && (
        <Suspense
          fallback={
            <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3 text-sm text-zinc-400">
              Loading advanced ecosystem tools...
            </div>
          }
        >
          <WorkflowOperationsDashboard settings={settings} />
          <AgentWorkshop />
        </Suspense>
      )}
      <ConnectorSetupPanel />
      <ProductionReadinessPanel
        settings={settings}
        setSettings={setSettings}
        ollamaStatus={ollamaStatus}
        verificationLogs={verificationLogs}
        workspaceFoundation={workspaceFoundation}
        updateCheckState={updateCheckState}
        nativeSelfDevProof={nativeSelfDevProof}
      />
      <SelfDevelopmentPanel
        settings={settings}
        setSettings={setSettings}
        verificationLogs={verificationLogs}
        workspaceFoundation={workspaceFoundation}
        updateCheckState={updateCheckState}
        nativeSelfDevProof={nativeSelfDevProof}
        setNativeSelfDevProof={setNativeSelfDevProof}
        nativeProofHooks={nativeProofHooks}
      />

      {showAdvancedSections && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel icon={Network} title="Handoff Queue">
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {approvalQueue.length === 0 && <p className="text-sm text-zinc-500">No pending approvals.</p>}
                {approvalQueue.map((packet) => (
                  <div key={packet.id} className="rounded-lg border border-white/10 bg-zinc-900/55 p-3 space-y-2">
                    <div className="text-xs font-semibold text-zinc-200">{packet.title}</div>
                    <div className="text-[11px] text-zinc-500">{packet.fromAgent} {'->'} {packet.toAgent} | {packet.packetType}</div>
                    <div className="flex gap-2">
                      <button onClick={() => runApprove(packet.id)} className="rounded bg-emerald-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200">Approve</button>
                      <button onClick={() => runReject(packet.id)} className="rounded bg-red-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-red-200">Reject</button>
                      <button onClick={() => runExecutePacket(packet.id)} className="rounded bg-indigo-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-indigo-200">Mark Executed</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-zinc-500">Execution Note</label>
                <input value={handoffNote} onChange={(event) => setHandoffNote(event.target.value)} className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[11px]" />
              </div>
            </Panel>

            <Panel icon={Layers3} title="Skill Pack System">
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {skills.map((skill) => (
                  <div key={skill.id} className="rounded-lg border border-white/10 bg-zinc-900/55 px-3 py-2 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">{skill.name}</div>
                      <div className="text-[11px] text-zinc-500">{skill.id} | {skill.version}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setSkillPackEnabled(skill.id, !skill.enabled); refreshAll(); }} className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200">{skill.enabled ? 'Disable' : 'Enable'}</button>
                      <button onClick={() => { uninstallSkillPack(skill.id); refreshAll(); }} className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-200">Uninstall</button>
                    </div>
                  </div>
                ))}
              </div>
              <textarea value={manifestInput} onChange={(event) => setManifestInput(event.target.value)} rows={7} className="mt-3 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 font-mono text-[11px] text-zinc-200" />
              <div className="mt-2 flex gap-2">
                <button onClick={runValidateManifest} className="rounded bg-zinc-800 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-200">Validate</button>
                <button onClick={runInstallSkillPack} className="rounded bg-indigo-500/25 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-indigo-100">Install</button>
              </div>
              <div className="mt-2 text-[11px] text-zinc-500">Audit entries: {skillAudit.length}</div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel icon={Workflow} title="Visual Workflow Builder">
              <div className="flex gap-2">
                <input value={newWorkflowName} onChange={(event) => setNewWorkflowName(event.target.value)} className="flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm" />
                <button onClick={runCreateWorkflow} className="rounded bg-indigo-500/25 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-indigo-100">Create</button>
              </div>
              <div className="mt-3 text-[11px] text-zinc-500">Node Library: {WORKFLOW_NODE_LIBRARY.map((node) => node.label).join(', ')}</div>
              <div className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                {workflows.map((flow) => (
                  <div key={flow.id} className="rounded-lg border border-white/10 bg-zinc-900/50 px-3 py-2 text-[11px] text-zinc-300">
                    {flow.name} | nodes {flow.nodes.length} | edges {flow.edges.length}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel icon={Activity} title="Session Intelligence + Timeline">
              <div className="text-[11px] text-zinc-300">Events (24h): {sessionSummary.totalEvents}</div>
              <div className="text-[11px] text-zinc-500 mt-1">Warnings: {sessionSummary.warnings?.length || 0} | Unresolved: {sessionSummary.unresolved?.length || 0}</div>
              <div className="mt-3 space-y-2 max-h-44 overflow-y-auto pr-1">
                {timeline.map((event) => (
                  <div key={event.id} className="rounded-lg border border-white/10 bg-zinc-900/50 px-3 py-2">
                    <div className="text-[11px] text-zinc-200">{event.title}</div>
                    <div className="text-[10px] text-zinc-500">{event.category} | {new Date(event.timestampMs).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel icon={ClipboardList} title="Persistent Activity Timeline">
              <div className="text-[11px] text-zinc-500">
                Timeline combines builds, edits, approvals, AI actions, task updates, and memory changes through session events.
              </div>
              <div className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                {timeline.slice(0, 8).map((event) => (
                  <div key={event.id} className="rounded-lg border border-white/10 bg-zinc-900/50 px-3 py-2 text-[11px] text-zinc-300">
                    {event.title}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel icon={ShieldAlert} title="Human Override Layer">
              <div className="space-y-2 text-[11px] text-zinc-400">
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2">Safe mode and approval gates remain active.</div>
                <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2">Emergency stop path: reject all pending packets in approval queue.</div>
                <div className="rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-2">Action preview path: use handoff queue details before approve/execute.</div>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => approvalQueue.forEach((packet) => runReject(packet.id))} className="rounded bg-red-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-200 flex items-center gap-1">
                  <PauseCircle className="h-3.5 w-3.5" /> Emergency Stop
                </button>
                <button onClick={() => approvalQueue.forEach((packet) => runApprove(packet.id))} className="rounded bg-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-200 flex items-center gap-1">
                  <PlayCircle className="h-3.5 w-3.5" /> Resume Queue
                </button>
              </div>
            </Panel>
          </div>

          <Panel icon={CheckCircle2} title="Runtime Resource + Cost Awareness">
            <div className="flex gap-2">
              <button onClick={runResourceSnapshot} className="rounded bg-indigo-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-indigo-100">Collect Snapshot</button>
              <button onClick={refreshAll} className="rounded bg-zinc-800 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-200">Refresh</button>
            </div>
            <div className="mt-3 text-[11px] text-zinc-400">
              Points: {resourceSummary.points} | Avg token estimate: {resourceSummary.avgTokenEstimate} | Max JS heap used: {resourceSummary.maxJsHeapUsed}
            </div>
            <div className="mt-2 space-y-1">
              {(resourceSummary.recommendations || []).map((rec) => (
                <div key={rec} className="text-[11px] text-zinc-500">{rec}</div>
              ))}
            </div>
            <div className="mt-3 space-y-2 max-h-36 overflow-y-auto pr-1">
              {resourceSnapshots.slice(-10).reverse().map((snapshot) => (
                <div key={snapshot.id} className="rounded-lg border border-white/10 bg-zinc-900/50 px-3 py-2 text-[11px] text-zinc-300">
                  {new Date(snapshot.timestampMs).toLocaleTimeString()} | model {snapshot.modelName || 'none'} | tokens {snapshot.tokenEstimate}
                </div>
              ))}
            </div>
          </Panel>

          <MarketplacePanel marketItems={marketItems} onRefresh={refreshAll} />
          <SnapshotDiffPanel snapshots={snapshots} />
        </>
      )}
    </div>
  );
}

function SnapshotDiffPanel({ snapshots }) {
  const sorted = [...snapshots].sort((a, b) => b.timestampMs - a.timestampMs);
  const [leftId, setLeftId]   = useState(() => sorted[0]?.id || '');
  const [rightId, setRightId] = useState(() => sorted[1]?.id || '');

  const left  = sorted.find((s) => s.id === leftId);
  const right = sorted.find((s) => s.id === rightId);

  const diffKeys = (a, b) => {
    const allKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    const rows = [];
    for (const k of allKeys) {
      const av = JSON.stringify(a?.[k] ?? null);
      const bv = JSON.stringify(b?.[k] ?? null);
      rows.push({ key: k, left: av, right: bv, changed: av !== bv });
    }
    return rows;
  };

  const payloadA = left?.payload  || {};
  const payloadB = right?.payload || {};
  const rows = diffKeys(payloadA, payloadB);
  const changedCount = rows.filter((r) => r.changed).length;

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3.5 space-y-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-400 font-bold">
        <Activity className="w-4 h-4 text-indigo-300" /> Snapshot Diff
        {changedCount > 0 && <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[9px] text-amber-300">{changedCount} changed</span>}
      </div>

      {sorted.length < 2 ? (
        <div className="text-[11px] text-zinc-600">Need at least 2 snapshots to compare. Create snapshots from the Ecosystem sidebar.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {[['Left (A)', leftId, setLeftId], ['Right (B)', rightId, setRightId]].map(([label, val, setter]) => (
              <div key={label}>
                <div className="text-[9px] font-bold uppercase text-zinc-600 mb-1">{label}</div>
                <select
                  value={val}
                  onChange={(e) => setter(e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-white/10 px-2 py-1.5 text-[10px] text-zinc-200 outline-none"
                >
                  {sorted.map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.timestampMs).toLocaleString()} — {s.id.slice(-8)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
            {rows.length === 0 && <div className="text-[11px] text-zinc-600">Both snapshots are empty.</div>}
            {rows.map((row) => (
              <div key={row.key} className={`rounded-lg px-2 py-1.5 text-[10px] ${row.changed ? 'bg-amber-950/30 border border-amber-500/20' : 'bg-zinc-900/30 border border-white/[0.04]'}`}>
                <div className={`font-mono font-bold mb-0.5 ${row.changed ? 'text-amber-200' : 'text-zinc-500'}`}>{row.key}</div>
                {row.changed ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-zinc-400 truncate">A: {row.left.slice(0, 60)}</div>
                    <div className="text-zinc-200 truncate">B: {row.right.slice(0, 60)}</div>
                  </div>
                ) : (
                  <div className="text-zinc-600 truncate">{row.left.slice(0, 80)}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const TYPE_FILTERS = ['all', 'agent', 'skill_pack', 'connector', 'workflow', 'theme'];
const STATUS_COLOR = { installed: 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30', available: 'text-zinc-400 border-zinc-600/30 bg-zinc-900/30', installing: 'text-blue-300 border-blue-500/30 bg-blue-950/30' };

function MarketplacePanel({ marketItems, onRefresh }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [registryUrl, setRegistryUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState('');

  const visible = typeFilter === 'all' ? marketItems : marketItems.filter((i) => i.type === typeFilter);

  const fetchRemote = async () => {
    const url = registryUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchMsg('');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      items.forEach((item) => {
        if (item.id && item.name) {
          setMarketplaceItemStatus(item.id, item.status || 'available');
        }
      });
      setFetchMsg(`Loaded ${items.length} item(s) from registry.`);
      onRefresh();
    } catch (err) {
      setFetchMsg(`Fetch failed: ${err.message}`);
    } finally {
      setFetching(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3.5 space-y-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-400 font-bold">
        <Layers3 className="w-4 h-4 text-indigo-300" /> Plugin Marketplace
      </div>

      {/* Remote registry fetch */}
      <div className="flex gap-2">
        <input
          value={registryUrl}
          onChange={(e) => setRegistryUrl(e.target.value)}
          placeholder="Registry URL (optional)"
          className="flex-1 rounded-lg bg-zinc-900 border border-white/10 px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500/40"
        />
        <button
          onClick={fetchRemote}
          disabled={fetching || !registryUrl.trim()}
          className="rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 text-[10px] font-bold text-indigo-200 hover:bg-indigo-500/35 disabled:opacity-50"
        >
          {fetching ? '…' : 'Fetch'}
        </button>
      </div>
      {fetchMsg && <div className="text-[10px] text-zinc-500">{fetchMsg}</div>}

      {/* Type filters */}
      <div className="flex flex-wrap gap-1">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors ${typeFilter === t ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-200' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            {t} {t === 'all' ? `(${marketItems.length})` : `(${marketItems.filter((i) => i.type === t).length})`}
          </button>
        ))}
      </div>

      {/* Item grid */}
      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        {visible.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-zinc-200 truncate">{item.name}</div>
              <div className="text-[10px] text-zinc-600">{item.type} · {item.id}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${STATUS_COLOR[item.status] || STATUS_COLOR.available}`}>
                {item.status}
              </span>
              {item.status === 'installed'
                ? <button onClick={() => { setMarketplaceItemStatus(item.id, 'available'); onRefresh(); }} className="text-[9px] text-zinc-500 hover:text-red-400 font-bold uppercase">Remove</button>
                : <button onClick={() => { setMarketplaceItemStatus(item.id, 'installed'); onRefresh(); }} className="text-[9px] text-emerald-400 hover:text-emerald-300 font-bold uppercase">Install</button>
              }
            </div>
          </div>
        ))}
        {visible.length === 0 && <div className="text-[11px] text-zinc-600 py-3 text-center">No items in this category.</div>}
      </div>
    </section>
  );
}

function Panel({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3.5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-400 font-bold mb-3">
        <Icon className="w-4 h-4 text-indigo-300" /> {title}
      </div>
      {children}
    </section>
  );
}

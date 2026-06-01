import React, { Suspense, lazy, useState } from 'react';
import {
  Activity,
  Brain,
  CheckCircle2,
  Command,
  Download,
  FolderTree,
  HardDrive,
  Monitor,
  Package,
  RefreshCw,
  Shield,
  TerminalSquare
} from 'lucide-react';
import { trustColor } from '../services/trustModel';

const TrustReceiptBrowser = lazy(() => import('./TrustReceiptBrowser').then((mod) => ({ default: mod.TrustReceiptBrowser })));

function Badge({ children, color = 'zinc' }) {
  const colors = {
    zinc: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
  };
  return <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold rounded border ${colors[color]}`}>{children}</span>;
}

export function OperatorDashboard({
  operatorMode,
  setOperatorMode,
  modes,
  ollamaStatus,
  lastCheckedAt,
  verificationLogs,
  durableAuditLogs,
  onVerifyOllama,
  onVerifyAuditChain,
  onVerifyProcess,
  onVerifyPaths,
  onVerifyCommand,
  memoryItems,
  plugins,
  diskPluginManifests,
  pluginAudit,
  onTogglePlugin,
  onDiscoverPlugins,
  workspaceFoundation,
  onToggleWorkspaceFeature,
  workspaceProof,
  ocrCapability,
  onRunWorkspaceProof,
  onCheckOcrCapability,
  workspaceSymbolIndex,
  onBuildSymbolIndex,
  onExecutePluginTool,
  onValidatePluginManifest,
  lastPluginToolRun,
  lastManifestValidation,
  pluginSandboxPolicy,
  onUpdatePluginSandboxPolicy,
  auditChainProof,
  onRunOcrAdapter,
  lastOcrAdapterRun,
  snapshots,
  onCreateSnapshot,
  onRestoreSnapshot,
  onBackupMemory,
  onRunRuntimeRepair,
  onRunReleasePreflight,
  onExportDiagnostics,
  coachMode,
  coachAlwaysOnTop,
  onToggleCoachMode,
  onToggleCoachTop,
  screenObserverState,
  screenObserverLogs,
  onRequestScreenObserverPermission,
  onStartScreenObserver,
  onStopScreenObserver,
  onUpdateScreenObserverSettings
}) {
  const [program, setProgram] = useState('ollama');
  const [args, setArgs] = useState('list');
  const [pluginManifestPath, setPluginManifestPath] = useState('');
  const [pluginId, setPluginId] = useState('');
  const [pluginToolId, setPluginToolId] = useState('');
  const [pluginExtraArgs, setPluginExtraArgs] = useState('');
  const [ocrAdapter, setOcrAdapter] = useState('version_check');
  const [ocrImagePath, setOcrImagePath] = useState('');
  const [ocrExtraArgs, setOcrExtraArgs] = useState('');
  const [sampleEveryInput, setSampleEveryInput] = useState(String(screenObserverState?.sampleEveryMs || 5000));

  const latestLogs = [...verificationLogs].reverse().slice(0, 10);
  const latestMemory = [...memoryItems].reverse().slice(0, 10);
  const latestAudit = [...pluginAudit].reverse().slice(0, 5);
  const latestSnapshotId = snapshots.length > 0 ? [...snapshots].reverse()[0].id : null;

  const runCommandProof = () => {
    const parsedArgs = args.trim() ? args.trim().split(/\s+/) : [];
    onVerifyCommand(program.trim(), parsedArgs);
  };

  const runPluginTool = () => {
    const extraArgs = pluginExtraArgs.trim() ? pluginExtraArgs.trim().split(/\s+/) : [];
    onExecutePluginTool({
      manifestPath: pluginManifestPath.trim(),
      pluginId: pluginId.trim(),
      toolId: pluginToolId.trim(),
      extraArgs
    });
  };

  const runOcr = () => {
    const extraArgs = ocrExtraArgs.trim() ? ocrExtraArgs.trim().split(/\s+/) : [];
    onRunOcrAdapter({
      adapter: ocrAdapter,
      imagePath: ocrImagePath.trim() || null,
      extraArgs
    });
  };

  if (!operatorMode) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-5">
        <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-white">Operator Mode is Off</h1>
              <p className="text-sm text-zinc-500 mt-1">Enable Operator Mode to access telemetry, proofs, memory dashboards, and supervised runtime tools.</p>
            </div>
            <button
              onClick={() => setOperatorMode(true)}
              className="rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 px-4 py-2 text-xs font-bold uppercase tracking-widest"
            >
              Enable
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-5 px-4 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white">Operator Mode</h1>
          <p className="text-sm text-zinc-500">Supervised runtime control, verification logs, memory state, plugin registry, and recovery foundations.</p>
        </div>
        <button
          onClick={() => setOperatorMode(!operatorMode)}
          className={`w-14 h-7 rounded-full transition-colors relative ${operatorMode ? 'bg-emerald-500' : 'bg-zinc-800'}`}
        >
          <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all ${operatorMode ? 'right-1' : 'left-1'}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
        <Panel icon={Activity} title="Runtime Health">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-zinc-500">Ollama status</span><span className="font-semibold text-zinc-200">{ollamaStatus.label}</span></div>
            <div className="flex items-center justify-between"><span className="text-zinc-500">Trust</span><Badge color={trustColor(ollamaStatus.trust || 'unverified')}>{ollamaStatus.trust || 'unverified'}</Badge></div>
            <div className="flex items-center justify-between"><span className="text-zinc-500">Last check</span><span className="text-zinc-300">{lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : 'not checked'}</span></div>
          </div>
          <div className="mt-3 flex gap-2">
            <ActionButton onClick={onVerifyOllama} label="Verify Ollama" icon={RefreshCw} />
            <ActionButton onClick={onVerifyAuditChain} label="Verify Audit Chain" icon={CheckCircle2} />
            <ActionButton onClick={() => onVerifyProcess(['ollama'])} label="Check PID" icon={Command} />
          </div>
          <div className="mt-3 rounded-lg bg-zinc-900/60 border border-white/10 px-3 py-2 text-[11px] text-zinc-400">
            {auditChainProof ? `Audit chain: ${auditChainProof.trust} (${auditChainProof.verified_entries || 0}/${auditChainProof.total_entries || 0})` : 'Audit chain has not been verified yet.'}
          </div>
        </Panel>

        <Panel icon={Shield} title="Identity + Privacy">
          <div className="space-y-2 text-sm text-zinc-300">
            <p className="text-zinc-500">Local-first mode is visible and supervised. No hidden uploads, no hidden recording, no silent actions.</p>
            <div className="flex items-center gap-2">
              <Badge color={modes.localOnlyMode ? 'green' : 'zinc'}>{modes.localOnlyMode ? 'local runtime' : 'local mode off'}</Badge>
              <Badge color={modes.approvalMode ? 'indigo' : 'zinc'}>{modes.approvalMode ? 'approval mode' : 'approval off'}</Badge>
              <Badge color={modes.safeMode ? 'amber' : 'zinc'}>{modes.safeMode ? 'safe mode' : 'safe off'}</Badge>
            </div>
          </div>
        </Panel>

        <Panel icon={Brain} title="Coach Mode">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-zinc-500">Pinned coach window</span><Badge color={coachMode ? 'green' : 'zinc'}>{coachMode ? 'active' : 'inactive'}</Badge></div>
            <div className="flex items-center justify-between"><span className="text-zinc-500">Always on top</span><Badge color={coachAlwaysOnTop ? 'green' : 'zinc'}>{coachAlwaysOnTop ? 'on' : 'off'}</Badge></div>
          </div>
          <div className="mt-3 flex gap-2">
            <ActionButton onClick={onToggleCoachMode} label={coachMode ? 'Close Coach' : 'Open Coach'} icon={HardDrive} />
            <ActionButton onClick={onToggleCoachTop} label={coachAlwaysOnTop ? 'Top Off' : 'Top On'} icon={CheckCircle2} />
          </div>
        </Panel>
      </div>

      <Panel icon={Monitor} title="Screen Intelligence (Visible Only)">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
            <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Observer Status</div>
            <div className="text-[11px] text-zinc-200 mt-1">{screenObserverState?.status || 'idle'}</div>
            <div className="text-[10px] text-zinc-500 mt-1">{screenObserverState?.currentSummary || 'Screen observer is off.'}</div>
          </div>
          <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
            <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Permission + Alerts</div>
            <div className="text-[11px] text-zinc-200 mt-1">permission: {screenObserverState?.permission || 'unknown'}</div>
            <div className="text-[10px] text-zinc-400 mt-1">alerts: {screenObserverState?.alertsCount || 0}</div>
            <div className="text-[10px] text-zinc-500 mt-1">last alert: {screenObserverState?.lastAlertAtMs ? new Date(screenObserverState.lastAlertAtMs).toLocaleTimeString() : 'none'}</div>
          </div>
          <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
            <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Sampling</div>
            <div className="text-[11px] text-zinc-200 mt-1">{screenObserverState?.sampleEveryMs || 5000} ms</div>
            <div className="text-[10px] text-zinc-500 mt-1">Trust: {screenObserverState?.trust || 'unverified'}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-1.5">
          <ActionButton onClick={onRequestScreenObserverPermission} label="Enable Notifications" icon={Shield} />
          <ActionButton onClick={onStartScreenObserver} label="Start Screen Observer" icon={Activity} />
          <ActionButton onClick={onStopScreenObserver} label="Stop Screen Observer" icon={RefreshCw} />
        </div>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-2">
          <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
            <label className="text-[10px] uppercase tracking-widest text-zinc-500">Sample Interval (ms)</label>
            <input
              value={sampleEveryInput}
              onChange={(event) => setSampleEveryInput(event.target.value)}
              className="mt-1 w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] font-mono"
              placeholder="5000"
            />
            <button
              onClick={() => {
                const parsed = Number(sampleEveryInput);
                const safeMs = Number.isFinite(parsed) ? Math.max(1200, Math.min(60000, Math.round(parsed))) : 5000;
                setSampleEveryInput(String(safeMs));
                onUpdateScreenObserverSettings({ sampleEveryMs: safeMs });
              }}
              className="mt-2 rounded bg-zinc-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-200 hover:bg-zinc-700"
            >
              Apply
            </button>
          </div>
          <ToggleTile
            label="Desktop Notification Alerts"
            enabled={screenObserverState?.notificationsEnabled !== false}
            onToggle={() => onUpdateScreenObserverSettings({ notificationsEnabled: !(screenObserverState?.notificationsEnabled !== false) })}
          />
          <ToggleTile
            label="Audio Escalation Beep"
            enabled={screenObserverState?.audioAlertEnabled === true}
            onToggle={() => onUpdateScreenObserverSettings({ audioAlertEnabled: !(screenObserverState?.audioAlertEnabled === true) })}
          />
        </div>
        <div className="mt-3 rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
          <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Recent Observation Events</div>
          <div className="mt-2 space-y-2 max-h-36 overflow-y-auto pr-1">
            {(!screenObserverLogs || screenObserverLogs.length === 0) && (
              <div className="text-[11px] text-zinc-500">No observation events yet. Start observer to capture visible-screen telemetry.</div>
            )}
            {(screenObserverLogs || []).slice().reverse().slice(0, 12).map((event) => (
              <div key={event.id} className="rounded-lg border border-white/10 bg-zinc-900/50 px-2.5 py-2">
                <div className="text-xs text-zinc-200">{event.summary}</div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {event.status} | change {event.changeLevel} | {new Date(event.timestampMs).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-zinc-500">
            Local-only visual pattern detection. Semantic app/window understanding remains setup_required.
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <Panel icon={TerminalSquare} title="Command Verification">
          <div className="space-y-2">
            <input value={program} onChange={(event) => setProgram(event.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-sm" placeholder="program, e.g. ollama" />
            <input value={args} onChange={(event) => setArgs(event.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-sm font-mono" placeholder="args, e.g. list" />
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={runCommandProof} label="Run Verified Command" icon={Command} />
              <ActionButton onClick={() => onVerifyPaths(['./src', './src-tauri/tauri.conf.json'])} label="Verify Paths" icon={FolderTree} />
            </div>
          </div>
        </Panel>

        <Panel icon={Package} title="Plugin Registry">
          <div className="space-y-2">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="flex items-center justify-between rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
                <div>
                  <div className="text-[13px] font-semibold text-zinc-100">{plugin.name}</div>
                  <div className="text-[10px] text-zinc-500">{plugin.id}</div>
                </div>
                <button onClick={() => onTogglePlugin(plugin.id, !plugin.enabled)} className={`px-2.5 py-1 rounded text-xs font-bold ${plugin.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-300'}`}>
                  {plugin.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <ActionButton onClick={onDiscoverPlugins} label="Scan Disk Manifests" icon={RefreshCw} />
          </div>
          <div className="mt-3 space-y-2 max-h-36 overflow-y-auto pr-1">
            {diskPluginManifests.length === 0 && <p className="text-[11px] text-zinc-500">No disk plugin manifests discovered yet.</p>}
            {diskPluginManifests.slice(0, 8).map((manifest, index) => (
              <div key={`${manifest.manifest_path}-${index}`} className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-zinc-200 truncate">{manifest.name || manifest.id}</div>
                  <Badge color={trustColor(manifest.trust || 'unverified')}>{manifest.trust || 'unverified'}</Badge>
                </div>
                <div className="text-[10px] text-zinc-500 mt-1 truncate">{manifest.manifest_path}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[10px] text-zinc-500">Audit: {latestAudit.map((entry) => `${entry.pluginId} ${entry.action}`).join(' | ') || 'no plugin events yet'}</div>
          <div className="mt-3 space-y-2">
            <input value={pluginManifestPath} onChange={(event) => setPluginManifestPath(event.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] font-mono" placeholder="manifest path" />
            <div className="grid grid-cols-2 gap-2">
              <input value={pluginId} onChange={(event) => setPluginId(event.target.value)} className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px]" placeholder="plugin id" />
              <input value={pluginToolId} onChange={(event) => setPluginToolId(event.target.value)} className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px]" placeholder="tool id" />
            </div>
            <input value={pluginExtraArgs} onChange={(event) => setPluginExtraArgs(event.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] font-mono" placeholder="extra args (optional)" />
            <ActionButton onClick={runPluginTool} label="Execute Plugin Tool" icon={Command} />
            <ActionButton onClick={() => onValidatePluginManifest(pluginManifestPath.trim())} label="Validate Manifest" icon={CheckCircle2} />
            {lastPluginToolRun && (
              <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2 text-[11px] text-zinc-400">
                {lastPluginToolRun.plugin_id}:{lastPluginToolRun.tool_id} | exit {String(lastPluginToolRun.exit_code)}
              </div>
            )}
            {lastManifestValidation && (
              <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2 text-[11px] text-zinc-400">
                manifest valid: {String(lastManifestValidation.valid)} | errors: {(lastManifestValidation.errors || []).length} | warnings: {(lastManifestValidation.warnings || []).length}
              </div>
            )}
            <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2 space-y-2">
              <div className="text-[11px] uppercase tracking-widest text-zinc-500">Plugin Sandbox Policy</div>
              <div className="flex items-center justify-between text-[11px] text-zinc-300">
                <span>Require Manifest Validation</span>
                <button
                  onClick={() => onUpdatePluginSandboxPolicy({ requireManifestValidation: !pluginSandboxPolicy?.requireManifestValidation })}
                  className={`px-2 py-1 rounded ${pluginSandboxPolicy?.requireManifestValidation ? 'bg-emerald-500/20 text-emerald-200' : 'bg-zinc-700 text-zinc-300'}`}
                >
                  {pluginSandboxPolicy?.requireManifestValidation ? 'On' : 'Off'}
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-300">
                <span>Max Extra Args</span>
                <div className="flex gap-1">
                  <button onClick={() => onUpdatePluginSandboxPolicy({ maxExtraArgs: Math.max(0, (pluginSandboxPolicy?.maxExtraArgs || 0) - 1) })} className="rounded bg-zinc-800 px-2 py-1">-</button>
                  <span className="px-2 py-1 rounded bg-zinc-800">{pluginSandboxPolicy?.maxExtraArgs ?? '-'}</span>
                  <button onClick={() => onUpdatePluginSandboxPolicy({ maxExtraArgs: (pluginSandboxPolicy?.maxExtraArgs || 0) + 1 })} className="rounded bg-zinc-800 px-2 py-1">+</button>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-300">
                <span>Max Arg Length</span>
                <div className="flex gap-1">
                  <button onClick={() => onUpdatePluginSandboxPolicy({ maxArgLength: Math.max(20, (pluginSandboxPolicy?.maxArgLength || 20) - 10) })} className="rounded bg-zinc-800 px-2 py-1">-</button>
                  <span className="px-2 py-1 rounded bg-zinc-800">{pluginSandboxPolicy?.maxArgLength ?? '-'}</span>
                  <button onClick={() => onUpdatePluginSandboxPolicy({ maxArgLength: (pluginSandboxPolicy?.maxArgLength || 0) + 10 })} className="rounded bg-zinc-800 px-2 py-1">+</button>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel icon={Brain} title="Memory Dashboard">
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {latestMemory.length === 0 && <p className="text-sm text-zinc-500">No memory records yet.</p>}
            {latestMemory.map((item) => (
              <div key={item.id} className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300">{item.category}</span>
                  <Badge color={trustColor(item.confidence)}>{item.confidence}</Badge>
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">{item.content}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel icon={FolderTree} title="Workspace Intelligence Foundation">
          <div className="space-y-2 text-sm">
            <WorkspaceRow label="OCR Pipeline (supervised)" featureKey="ocr" foundation={workspaceFoundation} onToggle={onToggleWorkspaceFeature} />
            <WorkspaceRow label="Screen Capture (permission-based)" featureKey="screenCapture" foundation={workspaceFoundation} onToggle={onToggleWorkspaceFeature} />
            <WorkspaceRow label="Screenshot Proof + OCR (foundation)" featureKey="screenshotProof" foundation={workspaceFoundation} onToggle={onToggleWorkspaceFeature} />
            <WorkspaceRow label="AST Symbol Indexing" featureKey="astIndexing" foundation={workspaceFoundation} onToggle={onToggleWorkspaceFeature} />
            <WorkspaceRow label="Editor Awareness" featureKey="editorAwareness" foundation={workspaceFoundation} onToggle={onToggleWorkspaceFeature} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton onClick={onRunWorkspaceProof} label="Collect Workspace Proof" icon={FolderTree} />
            <ActionButton onClick={onCheckOcrCapability} label="Check OCR Engine" icon={Brain} />
            <ActionButton onClick={onBuildSymbolIndex} label="Build Symbol Index" icon={CheckCircle2} />
          </div>
          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
              <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Workspace Proof</div>
              {workspaceProof ? (
                <>
                  <div className="text-[11px] text-zinc-200 mt-1">Files: {workspaceProof.file_count} | Dirs: {workspaceProof.dir_count}</div>
                  <div className="text-[10px] text-zinc-400 mt-1">Bytes: {workspaceProof.total_bytes}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">Trust: {workspaceProof.trust}</div>
                </>
              ) : (
                <div className="text-[10px] text-zinc-500 mt-1">No workspace proof run yet.</div>
              )}
            </div>
            <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
              <div className="text-[11px] text-zinc-500 uppercase tracking-widest">OCR Capability</div>
              {ocrCapability ? (
                <>
                  <div className="text-[11px] text-zinc-200 mt-1">{ocrCapability.available ? 'Available' : 'Unavailable'} ({ocrCapability.engine})</div>
                  <div className="text-[10px] text-zinc-500 mt-1">{ocrCapability.message}</div>
                </>
              ) : (
                <div className="text-[10px] text-zinc-500 mt-1">OCR check not run yet.</div>
              )}
            </div>
            <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
              <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Workspace Symbol Index</div>
              {workspaceSymbolIndex ? (
                <>
                  <div className="text-[11px] text-zinc-200 mt-1">Indexed files: {workspaceSymbolIndex.files_indexed}</div>
                  <div className="text-[10px] text-zinc-400 mt-1">Dependency edges: {workspaceSymbolIndex.dependency_edges}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">Trust: {workspaceSymbolIndex.trust}</div>
                </>
              ) : (
                <div className="text-[10px] text-zinc-500 mt-1">No symbol index built yet.</div>
              )}
            </div>
            <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2 space-y-2">
              <div className="text-[11px] text-zinc-500 uppercase tracking-widest">OCR Adapter Run</div>
              <div className="grid grid-cols-2 gap-2">
                <select value={ocrAdapter} onChange={(event) => setOcrAdapter(event.target.value)} className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px]">
                  <option value="version_check">version_check</option>
                  <option value="tesseract_cli">tesseract_cli</option>
                </select>
                <input value={ocrImagePath} onChange={(event) => setOcrImagePath(event.target.value)} className="bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] font-mono" placeholder="image path (optional)" />
              </div>
              <input value={ocrExtraArgs} onChange={(event) => setOcrExtraArgs(event.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] font-mono" placeholder="extra args (optional)" />
              <ActionButton onClick={runOcr} label="Run OCR Adapter" icon={Brain} />
              {lastOcrAdapterRun && (
                <div className="text-[10px] text-zinc-400">Adapter {lastOcrAdapterRun.adapter} | exit {String(lastOcrAdapterRun.exit_code)}</div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel icon={HardDrive} title="Recovery Systems">
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={onCreateSnapshot} label="Create Restore Point" icon={HardDrive} />
            <ActionButton onClick={onBackupMemory} label="Backup Memory" icon={Brain} />
            <ActionButton onClick={onRunRuntimeRepair} label="Runtime Repair" icon={RefreshCw} />
            <ActionButton onClick={onRunReleasePreflight} label="Release Preflight" icon={CheckCircle2} />
            <ActionButton onClick={() => latestSnapshotId && onRestoreSnapshot(latestSnapshotId)} label="Restore Latest" icon={CheckCircle2} />
          </div>
          <div className="mt-3 space-y-2 max-h-36 overflow-y-auto pr-1">
            {snapshots.length === 0 && <p className="text-[11px] text-zinc-500">No snapshots yet.</p>}
            {[...snapshots].reverse().slice(0, 6).map((snapshot) => (
              <div key={snapshot.id} className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2 text-[11px] text-zinc-400">
                <div className="flex items-center justify-between">
                  <span>{snapshot.id}</span>
                  <Badge color={trustColor(snapshot.trust)}>{snapshot.trust}</Badge>
                </div>
                <div>{new Date(snapshot.timestampMs).toLocaleString()}</div>
                <button
                  onClick={() => onRestoreSnapshot(snapshot.id)}
                  className="mt-2 rounded bg-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-200 hover:bg-zinc-700"
                >
                  Restore This
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel icon={Activity} title="Verification Logs">
          <div className="mb-2">
            <ActionButton onClick={onExportDiagnostics} label="Export Diagnostics" icon={TerminalSquare} />
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {latestLogs.length === 0 && <p className="text-[11px] text-zinc-500">No verification logs yet.</p>}
            {latestLogs.map((log) => (
              <div key={log.id} className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-300">{log.type}</span>
                  <Badge color={trustColor(log.trust)}>{log.trust}</Badge>
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">{new Date(log.timestampMs).toLocaleTimeString()} - {log.source}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] text-zinc-500 uppercase tracking-widest">Durable Audit (Backend)</div>
                <div className="text-[10px] text-zinc-300 mt-0.5">{Array.isArray(durableAuditLogs) ? durableAuditLogs.length : 0} entries</div>
              </div>
              <button
                onClick={() => {
                  const payload = {
                    exportedAt: new Date().toISOString(),
                    entryCount: Array.isArray(durableAuditLogs) ? durableAuditLogs.length : 0,
                    entries: durableAuditLogs || []
                  };
                  const body = JSON.stringify(payload, null, 2);
                  // Simple HMAC-style fingerprint using SubtleCrypto
                  const encoder = new TextEncoder();
                  crypto.subtle.importKey('raw', encoder.encode('alphonso-audit-v1'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
                    .then((key) => crypto.subtle.sign('HMAC', key, encoder.encode(body)))
                    .then((sig) => {
                      const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
                      const signed = JSON.stringify({ signature: hex, payload }, null, 2);
                      const blob = new Blob([signed], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `alphonso-audit-${Date.now()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    });
                }}
                className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-300 hover:bg-zinc-700"
              >
                <Download className="w-3 h-3" /> Export
              </button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Panel icon={Shield} title="Trust Receipt Browser">
          <Suspense fallback={null}>
            <TrustReceiptBrowser />
          </Suspense>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-bold mb-2">
        <Icon className="w-4 h-4 text-indigo-400" /> {title}
      </div>
      {children}
    </section>
  );
}

function ActionButton({ onClick, label, icon: Icon }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[10px] uppercase tracking-widest font-bold text-zinc-200 hover:bg-zinc-700">
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function WorkspaceRow({ label, featureKey, foundation, onToggle }) {
  const feature = foundation?.[featureKey];
  return (
    <div className="flex items-center justify-between rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
      <span className="text-[11px] text-zinc-300">{label}</span>
      <button onClick={() => onToggle(featureKey, !feature.enabled)} className={`px-2.5 py-1 rounded text-[10px] font-bold ${feature.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-300'}`}>
        {feature.enabled ? 'On' : 'Off'}
      </button>
    </div>
  );
}

function ToggleTile({ label, enabled, onToggle }) {
  return (
    <div className="rounded-lg bg-zinc-900/60 border border-white/10 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-zinc-300">{label}</span>
        <button onClick={onToggle} className={`px-2 py-1 rounded text-[10px] font-bold ${enabled ? 'bg-emerald-500/20 text-emerald-200' : 'bg-zinc-700 text-zinc-300'}`}>
          {enabled ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
}

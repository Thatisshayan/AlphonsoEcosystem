import React, { useRef, useState, useCallback } from 'react';
import { Activity, ChevronDown, ClipboardCopy, Compass, Download, Folder, Monitor, Palette, RefreshCw, Terminal, Cpu, UserRound, Trash2 } from 'lucide-react';
import { Badge, SectionHeader, StatusDot, statusColors } from './ui/Badge';
import { formatModelSize, normalizeEndpoint as _normalizeEndpoint } from '../lib/ollama';
import { getCustomAvatarDataUrl, removeCustomAvatar, setCustomAvatar } from '../services/agentAvatarService';
import { getAgentMascotPath } from '../services/agentVisualService';

function ModelSelector({ models, selectedModel, selectedModelMissing, onSelectModel }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-zinc-300">Active Inference Model</label>
        <span className="text-[11px] text-zinc-500">{models.length} installed model{models.length === 1 ? '' : 's'}</span>
      </div>
      {models.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          No installed models were returned by Ollama. Pull a model in Ollama, then run Check Ollama again.
        </div>
      ) : (
        <div className="relative">
          <select
            value={models.some((model) => model.name === selectedModel) ? selectedModel : ''}
            onChange={(event) => onSelectModel(event.target.value)}
            className="w-full appearance-none bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 pr-10 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          >
            {selectedModelMissing && <option value="">Model not found: {selectedModel}</option>}
            {models.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name} - {formatModelSize(model.size)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        </div>
      )}
      {selectedModelMissing && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
          Model not found: <span className="font-mono">{selectedModel}</span>. Suggested installed models: {models.map((model) => model.name).join(', ')}.
        </div>
      )}
    </div>
  );
}

const SUGGESTED_MODELS = ['llama3.2', 'llama3.1:8b', 'mistral', 'phi3.5', 'codellama', 'deepseek-r1:7b'];

function ModelPullHelper({ onRefresh }) {
  const [modelName, setModelName] = useState('');
  const [copied, setCopied] = useState(false);
  const cmd = `ollama pull ${modelName.trim() || '<model-name>'}`;

  const copy = () => {
    if (!modelName.trim()) return;
    navigator.clipboard.writeText(cmd).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-4 space-y-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Pull a New Model</div>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_MODELS.map((m) => (
          <button key={m} onClick={() => setModelName(m)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${modelName === m ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'border-white/5 bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder="or type a model name..."
          className="flex-1 bg-zinc-800 border border-white/10 rounded-xl px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50"
        />
        <button
          onClick={copy}
          disabled={!modelName.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-zinc-800 border-white/10 text-zinc-300 hover:bg-zinc-700"
        >
          {copied ? <><ClipboardCopy className="w-3.5 h-3.5" /> Copied</> : <><Download className="w-3.5 h-3.5" /> Copy Command</>}
        </button>
      </div>
      {modelName.trim() && (
        <div className="font-mono text-[11px] bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-emerald-400 select-all">{cmd}</div>
      )}
      <p className="text-[11px] text-zinc-600">Paste this in a terminal. When the download finishes, click <button onClick={onRefresh} className="text-indigo-400 hover:text-indigo-300 underline">Refresh Models</button> to load it.</p>
    </div>
  );
}

const AVATAR_AGENTS = [
  { id: 'alphonso', label: 'Alphonso' },
  { id: 'jose',     label: 'Jose' },
  { id: 'miya',     label: 'Miya' },
  { id: 'hector',   label: 'Hector' },
  { id: 'marcus',   label: 'Marcus' },
  { id: 'maria',    label: 'Maria' },
  { id: 'echo',     label: 'Echo' },
  { id: 'sentinel', label: 'Sentinel' },
  { id: 'nova',     label: 'Nova' }
];

function AgentAvatarCard({ agentId, label }) {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(() => getAgentMascotPath(agentId));
  const [hasCustom, setHasCustom] = useState(() => Boolean(getCustomAvatarDataUrl(agentId)));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const dataUrl = await setCustomAvatar(agentId, file);
      setPreview(dataUrl);
      setHasCustom(true);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setUploading(false);
    }
  }, [agentId]);

  const handleRemove = useCallback(() => {
    removeCustomAvatar(agentId);
    setPreview(getAgentMascotPath(agentId));
    setHasCustom(false);
    setError('');
  }, [agentId]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-zinc-900/50 p-3">
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        title={`Upload custom avatar for ${label}`}
        className="relative w-16 h-16 rounded-full overflow-hidden border border-white/10 group shrink-0 hover:border-indigo-500/40 transition-colors disabled:opacity-60"
      >
        {preview ? (
          <img src={preview} alt={label} className="w-full h-full object-cover object-center" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-800">
            <UserRound className="w-6 h-6 text-zinc-500" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-[9px] font-bold uppercase tracking-widest text-white">Change</span>
        </div>
      </button>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      <span className="text-[11px] font-semibold text-zinc-300">{label}</span>
      {hasCustom && (
        <button
          onClick={handleRemove}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Reset
        </button>
      )}
      {!hasCustom && <span className="text-[10px] text-zinc-600">Default</span>}
      {error && <span className="text-[10px] text-red-400 text-center">{error}</span>}
    </div>
  );
}

export function SettingsView({
  settings,
  setSettings,
  ollamaStatus,
  installedModels,
  selectedModelMissing,
  onCheckOllama,
  onCopyTroubleshootingCommand,
  copyState,
  updateCheckState,
  onCheckUpdates,
  normalizeEndpoint,
  ollamaTroubleshootingCommand,
  braveSearchConfigured = false
}) {
  const resolvedNormalizeEndpoint = normalizeEndpoint || _normalizeEndpoint;
  const folderPickerRef = useRef(null);

  const handleFolderPick = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const path = files[0].path || files[0].webkitRelativePath?.split('/')[0] || '';
    if (path) setSettings({ ...settings, workspaceRoot: path });
    e.target.value = '';
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-8 space-y-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">System Settings</h1>
        <p className="text-sm text-zinc-500">Configure local Ollama inference and native runtime behavior.</p>
      </div>

      <section className="space-y-4">
        <SectionHeader icon={Cpu} label="Ollama Runtime" />
        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300">Ollama API Endpoint</label>
            <input
              type="text"
              value={settings.endpoint}
              onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })}
              className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300">Workspace Root (for supervised proofs)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.workspaceRoot || ''}
                onChange={(event) => setSettings({ ...settings, workspaceRoot: event.target.value })}
                className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              <input ref={folderPickerRef} type="file" webkitdirectory="" onChange={handleFolderPick} className="hidden" />
              <button
                onClick={() => folderPickerRef.current?.click()}
                className="px-3 py-2 rounded-xl border border-white/10 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                title="Browse for folder"
              >
                <Folder className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] text-zinc-500">Set this to the approved Alphonso workspace root before running native proof.</div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300">OCR Engine Path (optional)</label>
            <input
              type="text"
              value={settings.ocrEnginePath || ''}
              onChange={(event) => setSettings({ ...settings, ocrEnginePath: event.target.value })}
              className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
            <div className="text-[11px] text-zinc-500">Leave blank until an OCR engine is actually configured and verified.</div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={onCheckOllama}
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-950 hover:bg-indigo-300"
            >
              <Activity className="h-3.5 w-3.5" /> Check Installed Models
            </button>
            <button
              onClick={onCheckOllama}
              className="flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-300 border border-white/10 hover:bg-zinc-800"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry Ollama Connection
            </button>
            <button
              onClick={onCopyTroubleshootingCommand}
              className="flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-300 border border-white/10 hover:bg-zinc-800"
            >
              <Terminal className="h-3.5 w-3.5" /> {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy Failed' : 'Copy Command'}
            </button>
          </div>

          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <StatusDot state={ollamaStatus.state} />
                <span className="text-sm font-semibold text-white">{ollamaStatus.label}</span>
                <Badge color={statusColors[ollamaStatus.state]}>{ollamaStatus.state}</Badge>
              </div>
              <span className="text-[11px] text-zinc-500">{resolvedNormalizeEndpoint(settings.endpoint)}/api/tags</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">{ollamaStatus.message}</p>
            <div className="mt-4 rounded-xl bg-black/30 border border-white/5 px-3 py-2 font-mono text-[11px] text-zinc-400 whitespace-pre-wrap">
              {ollamaTroubleshootingCommand}
            </div>
          </div>

          <ModelSelector
            models={installedModels}
            selectedModel={settings.selectedModel}
            selectedModelMissing={selectedModelMissing}
            onSelectModel={(selectedModel) => setSettings({ ...settings, selectedModel })}
          />

          <ModelPullHelper onRefresh={onCheckOllama} />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Compass} label="Hector Web Search" />
        <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${braveSearchConfigured ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-semibold text-white">
                {braveSearchConfigured ? 'Brave Search API — active' : 'Brave Search API — not configured'}
              </div>
              <div className="text-[11px] text-zinc-500">
                {braveSearchConfigured
                  ? 'BRAVE_SEARCH_API_KEY is set. Hector will use the Brave Search JSON API as the primary search provider.'
                  : 'Set BRAVE_SEARCH_API_KEY in your environment to enable Brave Search. Hector falls back to DuckDuckGo HTML scraping when the key is absent.'}
              </div>
              {!braveSearchConfigured && (
                <div className="mt-2 rounded-xl bg-black/30 border border-white/5 px-3 py-2 font-mono text-[11px] text-zinc-400">
                  {'# Free tier: 2,000 queries/month — signup at search.brave.com/register\nBRAVE_SEARCH_API_KEY=your_key_here'}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Monitor} label="Desktop & UI" />
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/5 bg-zinc-900/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Auto Update Checks</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Check update endpoint periodically and notify when a new version is available.</div>
              </div>
              <button
                onClick={() => setSettings({ ...settings, autoUpdateEnabled: !settings.autoUpdateEnabled })}
                className={`w-10 h-5 rounded-full transition-colors relative ${settings.autoUpdateEnabled ? 'bg-emerald-500' : 'bg-zinc-800'}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.autoUpdateEnabled ? 'right-1' : 'left-1'}`} />
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300">Updater Endpoint</label>
              <input
                type="text"
                value={settings.updaterEndpoint || ''}
                onChange={(event) => setSettings({ ...settings, updaterEndpoint: event.target.value })}
                className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              <div className="text-[11px] text-zinc-500">Enter the hosted updater endpoint only when the release manifest is actually published.</div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300">Updater Public Key</label>
              <textarea
                value={settings.updaterPubkey || ''}
                onChange={(event) => setSettings({ ...settings, updaterPubkey: event.target.value })}
                rows={3}
                className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-xs font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              <div className="text-[11px] text-zinc-500">Paste the public key only after the signing setup is complete.</div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300">Custom Target (optional)</label>
              <input
                type="text"
                value={settings.updaterTarget || ''}
                onChange={(event) => setSettings({ ...settings, updaterTarget: event.target.value })}
                className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              <div className="text-[11px] text-zinc-500">Use the actual target only when the updater release path is configured.</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onCheckUpdates}
                className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-100 hover:bg-zinc-700"
              >
                {updateCheckState?.checking ? 'Checking...' : 'Check Updates Now'}
              </button>
              {updateCheckState?.available && <Badge color="green">update available</Badge>}
              {updateCheckState?.configured && !updateCheckState?.available && <Badge color="blue">up to date / no update</Badge>}
              {!updateCheckState?.configured && <Badge color="amber">not configured</Badge>}
            </div>
            <div className="rounded-xl border border-white/10 bg-zinc-900/45 p-3 text-[11px] text-zinc-300">
              <div>Current: {updateCheckState?.currentVersion || 'n/a'} | Latest: {updateCheckState?.latestVersion || 'none'}</div>
              <div className="mt-1">Status: {updateCheckState?.error ? updateCheckState.error : (updateCheckState?.available ? 'New version detected.' : 'No update available.')}</div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Native Desktop Mode</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Tauri v2 desktop runtime is the intended target.</div>
              <div className="text-[11px] text-amber-200/80 mt-1">On Windows, verify:desktop needs WiX 3.14 binaries locally or a permitted wix314-binaries.zip download.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, desktopMode: !settings.desktopMode })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.desktopMode ? 'bg-indigo-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.desktopMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Local-Only Runtime</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Show explicit local-only identity and disable cloud assumptions.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, localOnlyMode: !settings.localOnlyMode })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.localOnlyMode ? 'bg-indigo-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.localOnlyMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Zero-Cost Mode (Default)</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Prefer local/free connectors first. Paid or metered connector routes are held for explicit approval.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, zeroCostMode: !settings.zeroCostMode })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.zeroCostMode ? 'bg-emerald-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.zeroCostMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Approval Mode</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Require explicit confirmation for supervised actions.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, approvalMode: !settings.approvalMode })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.approvalMode ? 'bg-amber-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.approvalMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Safe Mode</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Conservative runtime behavior with repair-first posture.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, safeMode: !settings.safeMode })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.safeMode ? 'bg-emerald-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.safeMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Privacy Shield Indicator</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Show Alphonso in privacy-shield mode for local-only work.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, privacyShieldActive: !settings.privacyShieldActive })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.privacyShieldActive ? 'bg-emerald-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.privacyShieldActive ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Miya Creative Companion</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Show Miya pinned creative assistant widget.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, miyaCompanionPinned: !settings.miyaCompanionPinned })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.miyaCompanionPinned ? 'bg-fuchsia-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.miyaCompanionPinned ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div>
              <div className="text-sm font-semibold text-white">Jose Orchestrator Companion</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Show Jose pinned governance and routing assistant widget.</div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, joseCompanionPinned: !settings.joseCompanionPinned })}
              className={`w-10 h-5 rounded-full transition-colors relative ${settings.joseCompanionPinned ? 'bg-amber-500' : 'bg-zinc-800'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.joseCompanionPinned ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader icon={Palette} label="Appearance" />
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'minimal_runtime', label: 'Minimal Runtime', preview: 'bg-zinc-900' },
            { id: 'deep_space', label: 'Deep Space', preview: 'bg-indigo-950' },
            { id: 'orchestrator_gold', label: 'Orchestrator Gold', preview: 'bg-amber-950' }
          ].map((theme) => (
            <button
              key={theme.id}
              onClick={() => setSettings({ ...settings, environmentTheme: theme.id })}
              className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                settings.environmentTheme === theme.id
                  ? 'border-indigo-500/50 bg-indigo-500/10 ring-1 ring-indigo-500/20'
                  : 'border-white/5 bg-zinc-900/50 hover:border-white/10'
              }`}
            >
              <div className={`w-full h-10 rounded-lg ${theme.preview} border border-white/10`} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{theme.label}</span>
              {settings.environmentTheme === theme.id && (
                <span className="text-[9px] text-indigo-400 font-bold">Active</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader icon={UserRound} label="Agent Avatars" />
        <p className="text-[11px] text-zinc-500">
          Click an avatar to upload a custom mascot image (PNG, JPG, WebP). Images are resized to 256 × 256 and stored locally.
          Click <strong className="text-zinc-400">Reset</strong> to restore the default.
        </p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-9">
          {AVATAR_AGENTS.map((agent) => (
            <AgentAvatarCard key={agent.id} agentId={agent.id} label={agent.label} />
          ))}
        </div>
      </section>
    </div>
  );
}

import React, { Suspense, lazy, startTransition, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Mic } from 'lucide-react';
import { getName, getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useVoiceInput } from './hooks/useVoiceInput';
import { openCoachWindow, closeCoachWindow } from './services/coachModeService';
import { checkAppUpdate, notifyUpdateAvailable } from './services/appUpdateService';
import { hydrateMemoryFromDurable, listMemoryItems, pushMemoryItem } from './services/memoryService';
import { appendPluginAuditEntry, discoverDiskPluginManifests, executePluginToolRun, listPluginAudit, listPlugins, togglePlugin, validatePluginManifestDisk } from './services/pluginRegistryService';
import { listSnapshots, createSnapshot, restoreSnapshotById, backupMemoryLedger } from './services/recoveryService';
import { VOICE_STATES } from './services/voiceService';
import { TRUST_STATES, timestampMs } from './services/trustModel';
import { appendVerificationLog, getVerificationLogs, readDurableAuditLog, verifyCommandExecution, verifyDurableAuditChain, verifyOllamaRuntimeProof, verifyPathProof, verifyProcessProof } from './services/verificationService';
import { buildWorkspaceSymbolIndex, checkOcrCapability, collectWorkspaceProof, getWorkspaceFoundation, runOcrAdapter, updateWorkspaceFoundation } from './services/workspaceIntelligenceService';
import { evaluatePluginExecutionPolicy, getPluginSandboxPolicy, updatePluginSandboxPolicy } from './services/pluginSandboxService';
import {
  getScreenObserverLogs,
  getScreenObserverState,
  requestScreenNotificationPermission,
  startScreenObserver,
  stopScreenObserver,
  updateScreenObserverState
} from './services/screenIntelligenceService';
import { appendSessionEvent } from './services/sessionIntelligenceService';
import { sendNativeNotification } from './services/notificationService';
import { bootstrapRuntimeLedgerHydration } from './services/runtimeLedgerService';
import { isConnectorAuthenticated, pollWhatsAppConnector } from './services/connectorRegistryService';
import { runSelfDevelopmentCycle } from './services/selfDevelopmentService';
import {
  DEV_PACKET_SCOPE,
  GOVERNANCE_SCOPE,
  JOSE_COMMAND_SCOPE,
  MIYA_MEMORY_SCOPE,
  ORCHESTRATION_QUEUE_SCOPE,
  ORCHESTRATION_RECEIPT_SCOPE,
  PACKET_SCOPE,
  PLUGIN_AUDIT_SCOPE,
  PLUGINS_SCOPE,
  PRODUCTION_READINESS_SCOPE,
  PROOF_AUTHORITY,
  REPO_AUDIT_SCOPE,
  SELF_DEVELOPMENT_SCOPE,
  SESSION_EVENT_SCOPE,
  TOOL_CONNECTION_AUDIT_SCOPE,
  TOOL_CONNECTION_SCOPE,
  CONNECTOR_SCOPE,
  CONNECTOR_AUDIT_SCOPE,
  CONNECTOR_AUTH_SCOPE,
  VERIFICATION_SCOPE,
  WORKFLOW_OPS_SCOPE,
  WORKFLOW_RECEIPT_SCOPE,
  WORKFLOW_RUN_SCOPE,
  WORKFLOW_TELEMETRY_SCOPE
} from './services/serviceScopes';
import { getDefaultWorkspaceRoot } from './services/workspaceRootService';
import { isBraveSearchConfigured } from './services/hectorResearchService';
import { listAgentProfiles } from './agents/agentRegistry';
import { createWorkflow, listWorkflows } from './services/workflowBuilderService';
import { listWorkflowRuns } from './services/workflowExecutionService';
import { listWorkflowOperations } from './services/workflowOperationsRegistryService';
import {
  DEFAULT_OLLAMA_ENDPOINT,
  OLLAMA_TROUBLESHOOTING_COMMAND,
  checkOllama,
  chooseDefaultModel,
  normalizeEndpoint
} from './lib/ollama';
import { getStorage, setStorage } from './lib/appStorage';
import { needsHighRiskApproval } from './lib/chatUtils';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import { useToast } from './components/ToastProvider';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ChatView } from './components/ChatView';

const ApprovalModal = lazy(() => import('./components/ApprovalModal').then((mod) => ({ default: mod.ApprovalModal })));
const OnboardingWizard = lazy(() => import('./components/OnboardingWizard').then((mod) => ({ default: mod.OnboardingWizard })));
const ConnectorHealthPanel = lazy(() => import('./components/ConnectorHealthPanel').then((mod) => ({ default: mod.ConnectorHealthPanel })));

const AutomationView = lazy(() => import('./components/AutomationView').then((mod) => ({ default: mod.AutomationView })));
const FilesView = lazy(() => import('./components/FilesView').then((mod) => ({ default: mod.FilesView })));

const EcosystemHub = lazy(() => import('./components/EcosystemHub').then((mod) => ({ default: mod.EcosystemHub })));
const HectorResearchDesk = lazy(() => import('./components/dashboard/HectorResearchDesk').then((mod) => ({ default: mod.HectorResearchDesk })));
const MiyaStudio = lazy(() => import('./components/MiyaStudio').then((mod) => ({ default: mod.MiyaStudio })));
const ContentCatalystWorkspace = lazy(() => import('./features/content-catalyst').then((mod) => ({ default: mod.ContentCatalystWorkspace })));
const OperatorDashboard = lazy(() => import('./components/OperatorDashboard').then((mod) => ({ default: mod.OperatorDashboard })));
const OrchestratorView = lazy(() => import('./components/OrchestratorView').then((mod) => ({ default: mod.OrchestratorView })));
const ProjectExecutionMode = lazy(() => import('./components/projectExecution/ProjectExecutionMode').then((mod) => ({ default: mod.ProjectExecutionMode })));
const CommandRib = lazy(() => import('./components/CommandRib').then((mod) => ({ default: mod.CommandRib })));
const AgentDock = lazy(() => import('./components/AgentDock').then((mod) => ({ default: mod.AgentDock })));
const MicrophoneStatus = lazy(() => import('./components/MicrophoneStatus').then((mod) => ({ default: mod.MicrophoneStatus })));
const SettingsView = lazy(() => import('./components/SettingsView').then((mod) => ({ default: mod.SettingsView })));
const RightPanel = lazy(() => import('./components/RightPanel').then((mod) => ({ default: mod.RightPanel })));
const AgentActivityLog = lazy(() => import('./components/AgentActivityLog').then((mod) => ({ default: mod.AgentActivityLog })));

const INITIAL_CONVERSATION_ID = 'default-session';
const COACH_LAYOUT_KEY = 'alphonso_coach_layout_v1';
const COACH_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

const themeClassFromSettings = (settings) => {
  if (settings.environmentTheme === 'orchestrator_gold') return 'theme-orchestrator-gold';
  if (settings.environmentTheme === 'neon_studio') return 'theme-neon-studio';
  if (settings.environmentTheme === 'minimal_runtime') return 'theme-minimal-runtime';
  return 'theme-deep-space';
};

function getCompanionState({
  ollamaStatus,
  voiceStatus,
  isGeneratingResponse,
  lastTaskCompletedAt,
  selectedModelMissing,
  privacyModeActive,
  approvalModeActive,
  approvalRequiredNotice
}) {
  if (approvalModeActive && approvalRequiredNotice) {
    return { state: 'approval_required', message: 'Approval required before action.' };
  }

  if (voiceStatus.state === VOICE_STATES.LISTENING) {
    return { state: 'listening', message: 'Listening...' };
  }

  if ([
    VOICE_STATES.PERMISSION_DENIED,
    VOICE_STATES.NO_MICROPHONE,
    VOICE_STATES.UNSUPPORTED,
    VOICE_STATES.ERROR
  ].includes(voiceStatus.state)) {
    return { state: 'warning', message: voiceStatus.message };
  }

  if (voiceStatus.state === VOICE_STATES.REQUESTING_PERMISSION) {
    return { state: 'thinking', message: 'Checking microphone permission.' };
  }

  if (selectedModelMissing) {
    return { state: 'warning', message: 'Selected model is missing.' };
  }

  if (['not_running', 'cors', 'timeout', 'disconnected'].includes(ollamaStatus.state)) {
    return { state: 'warning', message: 'Ollama is disconnected.' };
  }

  if (ollamaStatus.state === 'connecting') {
    return { state: 'thinking', message: 'Checking Ollama.' };
  }

  if (isGeneratingResponse) {
    return { state: 'thinking', message: 'Thinking...' };
  }

  if (lastTaskCompletedAt && Date.now() - lastTaskCompletedAt < 5000) {
    return { state: 'task_complete', message: 'Task complete.' };
  }

  if (privacyModeActive) {
    return { state: 'privacy_shield_active', message: 'Privacy shield active.' };
  }

  if (ollamaStatus.state === 'connected') {
    return { state: 'idle', message: 'Ollama connected. Alphonso is idle.' };
  }

  return { state: 'sleeping', message: 'Mic is off.' };
}

function companionStateFromVoice(voiceStatus) {
  if (voiceStatus.state === VOICE_STATES.LISTENING) return 'listening';
  if (voiceStatus.state === VOICE_STATES.REQUESTING_PERMISSION) return 'thinking';
  if ([VOICE_STATES.PERMISSION_DENIED, VOICE_STATES.NO_MICROPHONE, VOICE_STATES.UNSUPPORTED, VOICE_STATES.ERROR].includes(voiceStatus.state)) return 'warning';
  return 'idle';
}

function coachMessageFromVoice(voiceStatus) {
  if (voiceStatus.state === VOICE_STATES.LISTENING) return 'Listening...';
  if (voiceStatus.state === VOICE_STATES.REQUESTING_PERMISSION) return 'Checking microphone permission.';
  if ([VOICE_STATES.PERMISSION_DENIED, VOICE_STATES.NO_MICROPHONE, VOICE_STATES.UNSUPPORTED, VOICE_STATES.ERROR].includes(voiceStatus.state)) return voiceStatus.message;
  return 'Mic is off.';
}

function nextCoachCorner(current) {
  const index = COACH_CORNERS.indexOf(current);
  if (index < 0) return COACH_CORNERS[0];
  return COACH_CORNERS[(index + 1) % COACH_CORNERS.length];
}

function CoachMissionBadge({ agent, state, message }) {
  const label = agent === 'miya' ? 'Miya' : agent === 'jose' ? 'Jose' : agent === 'hector' ? 'Hector' : 'Alphonso';
  const tone = state === 'warning' || state === 'approval_required'
    ? 'text-amber-100 border-amber-300/20 bg-amber-500/10'
    : state === 'task_complete'
      ? 'text-emerald-100 border-emerald-300/20 bg-emerald-500/10'
      : state === 'listening'
        ? 'text-red-100 border-red-300/20 bg-red-500/10'
        : 'text-cyan-100 border-cyan-300/20 bg-cyan-500/10';

  return (
    <div className={`rounded-xl border px-3 py-2 ${tone}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest">{label} mission</div>
      <div className="mt-1 text-xs font-semibold">{state || 'idle'}</div>
      <div className="mt-1 text-[11px] text-zinc-200/85 truncate">{message || 'Standing by'}</div>
    </div>
  );
}

function ViewLoadingState({ activeTab }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="rounded-2xl border border-white/10 bg-zinc-950/75 px-5 py-4 text-sm text-zinc-400">
        Loading {activeTab}...
      </div>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    let cancelled = false;
    let rafTwo = 0;
    const rafOne = window.requestAnimationFrame(() => {
      rafTwo = window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (document.querySelector('[data-alphonso-shell-ready="true"]')) {
          window.__ALPHONSO_BOOT_READY__?.()
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafOne);
      if (rafTwo) window.cancelAnimationFrame(rafTwo);
    };
  }, [])

  const searchParams = new URLSearchParams(window.location.search);
  const isCoachWindow = searchParams.get('coach') === '1';
  const coachAgentFromQuery = searchParams.get('coachAgent');
  const [activeTab, setActiveTab] = useState('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [settings, setSettings] = useState(() => getStorage('alphonso_settings', {
    endpoint: DEFAULT_OLLAMA_ENDPOINT,
    selectedModel: '',
    workspaceRoot: getDefaultWorkspaceRoot(),
    ocrEnginePath: '',
    miyaCompanionPinned: true,
    joseCompanionPinned: true,
    hectorCompanionPinned: true,
    focusMode: 'mission_control',
    environmentTheme: 'minimal_runtime',
    desktopMode: true,
    localOnlyMode: true,
    zeroCostMode: true,
    approvalMode: true,
    safeMode: true,
    privacyShieldActive: false,
    autoScroll: true,
    coachAgent: 'alphonso',
    autoUpdateEnabled: true,
    updaterEndpoint: '',
    updaterPubkey: '',
    updaterTarget: ''
  }));
  const [conversations, setConversations] = useState(() => getStorage('alphonso_conversations', [
    { id: INITIAL_CONVERSATION_ID, title: 'New Chat Session', timestamp: Date.now() }
  ]));
  const [activeChatId, setActiveChatId] = useState(conversations[0]?.id || INITIAL_CONVERSATION_ID);
  const [ollamaStatus, setOllamaStatus] = useState({
    state: 'connecting',
    label: 'Connecting',
    message: 'Checking Ollama...',
    models: [],
    trust: TRUST_STATES.TEMPORARY
  });
  const [desktopBridge, setDesktopBridge] = useState({
    state: 'checking',
    label: 'Checking',
    message: 'Checking Tauri runtime bridge...'
  });
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [copyState, setCopyState] = useState('idle');
  const [updateCheckState, setUpdateCheckState] = useState({
    checking: false,
    configured: false,
    available: false,
    latestVersion: null,
    currentVersion: '',
    notes: null,
    pubDate: null,
    downloadUrl: null,
    checkedAtMs: null,
    trust: TRUST_STATES.UNVERIFIED,
    error: null,
    notificationSent: false
  });
  const [braveSearchConfigured, setBraveSearchConfigured] = useState(false);
  const [nativeSelfDevProof, setNativeSelfDevProof] = useState(() => {
    const stored = getStorage('alphonso_native_selfdev_proof', null);
    return stored && typeof stored === 'object' ? stored : null;
  });
  const [isGeneratingResponse, setIsGeneratingResponse] = useState(false);
  const [lastTaskCompletedAt, setLastTaskCompletedAt] = useState(null);
  const [operatorMode, setOperatorMode] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isLocked, setIsLocked] = useState(false);
  const idleTimerRef = useRef(null);
  const [verificationLogs, setVerificationLogs] = useState(() => getVerificationLogs());
  const [durableAuditLogs, setDurableAuditLogs] = useState([]);
  const [auditChainProof, setAuditChainProof] = useState(null);
  const [pluginSandboxPolicy, setPluginSandboxPolicy] = useState(() => getPluginSandboxPolicy());
  const [memoryItems, setMemoryItems] = useState(() => listMemoryItems());
  const [plugins, setPlugins] = useState(() => listPlugins());
  const [pluginAudit, setPluginAudit] = useState(() => listPluginAudit());
  const [diskPluginManifests, setDiskPluginManifests] = useState([]);
  const [workspaceFoundation, setWorkspaceFoundation] = useState(() => getWorkspaceFoundation());
  const [workspaceProof, setWorkspaceProof] = useState(null);
  const [ocrCapability, setOcrCapability] = useState(null);
  const [workspaceSymbolIndex, setWorkspaceSymbolIndex] = useState(null);
  const [screenObserverState, setScreenObserverState] = useState(() => getScreenObserverState());
  const [screenObserverLogs, setScreenObserverLogs] = useState(() => getScreenObserverLogs());
  const [lastPluginToolRun, setLastPluginToolRun] = useState(null);
  const [lastManifestValidation, setLastManifestValidation] = useState(null);
  const [lastOcrAdapterRun, setLastOcrAdapterRun] = useState(null);
  const [miyaCompanionState, setMiyaCompanionState] = useState({
    state: 'idle',
    message: 'Miya is ready.'
  });
  const [joseCompanionState, setJoseCompanionState] = useState({
    state: 'idle',
    message: 'Jose is coordinating quietly.'
  });
  const [hectorCompanionState, setHectorCompanionState] = useState({
    state: 'idle',
    message: 'Hector is standing by.',
    currentSourceUrl: null,
    lastRunSummary: ''
  });
  const [snapshots, setSnapshots] = useState(() => listSnapshots());
  const [coachMode, setCoachMode] = useState(false);
  const [coachAlwaysOnTop, setCoachAlwaysOnTop] = useState(true);
  const [coachMiniMode, setCoachMiniMode] = useState(() => {
    const layout = getStorage(COACH_LAYOUT_KEY, { mini: false, corner: 'bottom-right' });
    return Boolean(layout?.mini);
  });
  const [coachSnapCorner, setCoachSnapCorner] = useState(() => {
    const layout = getStorage(COACH_LAYOUT_KEY, { mini: false, corner: 'bottom-right' });
    return COACH_CORNERS.includes(layout?.corner) ? layout.corner : 'bottom-right';
  });
  const [approvalRequiredNotice, setApprovalRequiredNotice] = useState(false);
  const [approvalPending, setApprovalPending] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem('alphonso_onboarding_complete')
  );
  const approvalResolveRef = useRef(null);
  const ollamaCheckRunRef = useRef(0);
  const screenObserverRunRef = useRef(false);
  const workspaceRootBootstrapRef = useRef(false);
  const nativeSelfDevAutorunRef = useRef(false);
  const voice = useVoiceInput();
  const toast = useToast();
  const [, startTabTransition] = useTransition();
  const switchTab = useCallback((tab) => startTabTransition(() => setActiveTab(tab)), []);
  const mergedAgentDockCompanions = useMemo(() => {
    const activeStates = {
      alphonso: {
        state: companionStateFromVoice(voice.voiceStatus),
        message: coachMessageFromVoice(voice.voiceStatus)
      },
      hector: hectorCompanionState,
      jose: joseCompanionState,
      miya: miyaCompanionState
    };
    return listAgentProfiles().map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      state: activeStates[agent.id]?.state || 'idle',
      message: activeStates[agent.id]?.message || agent.title || agent.role
    }));
  }, [hectorCompanionState, joseCompanionState, miyaCompanionState, voice.voiceStatus]);

  const writeNativeProofStage = useCallback(async (stageFileName, payload = {}) => {
    const proofWorkspaceRoot = String(payload.workspaceRoot || settings.workspaceRoot || getDefaultWorkspaceRoot() || '').trim();
    if (!proofWorkspaceRoot) return null;

    const stage = String(stageFileName || '').replace(/\.json$/i, '');
    const content = {
      timestamp: new Date().toISOString(),
      stage,
      status: payload.status || 'recorded',
      processId: payload.processId ?? null,
      workspaceRoot: proofWorkspaceRoot,
      error: payload.error ?? null,
      durationMs: payload.durationMs ?? null,
      ...payload
    };

    try {
      void emit('alphonso-native-proof-stage', {
        fileName: stageFileName,
        ...content
      }).catch(() => {});
      void invoke('write_workspace_text_file', {
        workspaceRoot: proofWorkspaceRoot,
        relativePath: `release/rc0/proof/${stageFileName}`,
        content: JSON.stringify(content, null, 2)
      }).catch(() => {});
      return content;
    } catch {
      return null;
    }
  }, [settings.workspaceRoot]);

  const nativeProofHooks = useMemo(() => ({
    writeStage: writeNativeProofStage
  }), [writeNativeProofStage]);

  useEffect(() => {
    setStorage('alphonso_settings', settings);
    invoke('save_settings', { settingsJson: JSON.stringify(settings) }).catch(() => {});
  }, [settings]);
  useEffect(() => setStorage('alphonso_conversations', conversations), [conversations]);
  useEffect(() => setStorage('alphonso_native_selfdev_proof', nativeSelfDevProof), [nativeSelfDevProof]);
  useEffect(() => setStorage(COACH_LAYOUT_KEY, { mini: coachMiniMode, corner: coachSnapCorner }), [coachMiniMode, coachSnapCorner]);

  // Hydrate settings from SQLite on first boot (takes precedence over localStorage so settings survive reinstalls).
  const settingsHydratedRef = useRef(false);
  useEffect(() => {
    if (settingsHydratedRef.current) return;
    settingsHydratedRef.current = true;
    invoke('load_settings').then((json) => {
      if (!json) return;
      try {
        const saved = JSON.parse(json);
        if (saved && typeof saved === 'object') setSettings((current) => ({ ...current, ...saved }));
      } catch { /* ignore corrupt data */ }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (workspaceRootBootstrapRef.current) return;
    workspaceRootBootstrapRef.current = true;
    if (!settings.workspaceRoot) {
      setSettings((current) => (
        current.workspaceRoot
          ? current
          : { ...current, workspaceRoot: getDefaultWorkspaceRoot() }
      ));
    }
  }, [settings.workspaceRoot, setSettings]);

  useEffect(() => {
    if (typeof settings.zeroCostMode !== 'boolean') {
      setSettings((current) => ({ ...current, zeroCostMode: true }));
    }
  }, [settings.zeroCostMode]);

  useEffect(() => {
    if (settings.environmentTheme === 'neon_studio') {
      setSettings((current) => ({
        ...current,
        environmentTheme: 'minimal_runtime'
      }));
    }
  }, [settings.environmentTheme]);

  useEffect(() => {
    void writeNativeProofStage('04_frontend_loaded.json', {
      status: 'running',
      processId: null,
      workspaceRoot: settings.workspaceRoot || getDefaultWorkspaceRoot(),
      note: 'React frontend mounted in the native runtime.'
    });
  }, [settings.workspaceRoot, writeNativeProofStage]);

  useEffect(() => {
    let cancelled = false;

    if (window.__ALPHONSO_NATIVE_SELFDEV_AUTORUN_RUNNING__) {
      return () => {
        cancelled = true;
      };
    }

    async function runNativeSelfDevelopmentProof() {
      if (nativeSelfDevAutorunRef.current) return;

      const proofWorkspaceRoot = settings.workspaceRoot || getDefaultWorkspaceRoot();
      let rc0ProofValue = null;
      try {
        const rc0Proof = await invoke('read_runtime_env_value', { name: 'ALPHONSO_RC0_PROOF' });
        rc0ProofValue = String(rc0Proof?.value || '').trim();
      } catch {
        rc0ProofValue = null;
      }
      if (rc0ProofValue === '1') {
        nativeSelfDevAutorunRef.current = true;
        window.__ALPHONSO_NATIVE_SELFDEV_AUTORUN_RUNNING__ = true;
        if (!cancelled) {
          setNativeSelfDevProof({
            runtime: 'native_tauri',
            proofAuthority: PROOF_AUTHORITY.RUST_ENGINE,
            proofMode: 'native_rc0_rust',
            autorun: false,
            state: 'partial',
            workspaceRoot: proofWorkspaceRoot,
            workspaceRootValid: null,
            filesScanned: 0,
            p0Count: 0,
            p1Count: 0,
            p2Count: 0,
            exportPath: null,
            proofReceiptsWritten: false,
            timestampMs: timestampMs(),
            note: 'Rust RC0 engine is proof authority. Verify release/rc0/proof/*.json on disk; React display is not proof.'
          });
        }
        return;
      }

      nativeSelfDevAutorunRef.current = true;
      window.__ALPHONSO_NATIVE_SELFDEV_AUTORUN_RUNNING__ = true;
      await writeNativeProofStage('05_autorun_observer_started.json', {
        status: 'running',
        workspaceRoot: proofWorkspaceRoot,
        note: 'Native autorun observer entered before env reads; React is not proof authority.'
      });

      let autorunValue = null;
      let exitValue = null;
      try {
        const autorunProof = await invoke('read_runtime_env_value', { name: 'ALPHONSO_SELFDEV_AUTORUN' });
        autorunValue = String(autorunProof?.value || '').trim();
      } catch {
        autorunValue = null;
      }
      try {
        const exitProof = await invoke('read_runtime_env_value', { name: 'ALPHONSO_SELFDEV_EXIT_ON_COMPLETE' });
        exitValue = String(exitProof?.value || '').trim();
      } catch {
        exitValue = null;
      }
      await writeNativeProofStage('05_autorun_observer_env_checked.json', {
        status: autorunValue === '1' ? 'ready' : 'setup_required',
        workspaceRoot: proofWorkspaceRoot,
        note: autorunValue === '1'
          ? 'Autorun env detected by the native proof observer.'
          : 'Autorun env not enabled or not readable in the native proof observer.',
        autorunValue: autorunValue === '1',
        exitValue: exitValue === '1'
      });

      if (autorunValue !== '1') {
        if (!cancelled) {
          setNativeSelfDevProof({
            runtime: 'native_tauri',
            proofMode: 'automated_native',
            autorun: false,
            state: 'setup_required',
            workspaceRoot: proofWorkspaceRoot,
            workspaceRootValid: null,
            filesScanned: 0,
            p0Count: 0,
            p1Count: 0,
            p2Count: 0,
            exportPath: null,
            proofReceiptsWritten: false,
            timestampMs: timestampMs(),
            note: 'ALPHONSO_SELFDEV_AUTORUN is not enabled in this native runtime.'
          });
          await invoke('write_workspace_text_file', {
            workspaceRoot: proofWorkspaceRoot,
            relativePath: 'release/rc0/native-selfdev-skipped.json',
            content: JSON.stringify({
              runtime: 'native_tauri',
              proofMode: 'automated_native',
              state: 'setup_required',
              autorun: false,
              workspaceRoot: proofWorkspaceRoot,
              timestampMs: timestampMs(),
              note: 'ALPHONSO_SELFDEV_AUTORUN is not enabled in this native runtime.'
            }, null, 2)
          }).catch(() => {});
        }
        return;
      }

      if (!cancelled) {
        setNativeSelfDevProof({
          runtime: 'native_tauri',
          proofMode: 'automated_native',
          autorun: true,
          state: 'running',
          workspaceRoot: settings.workspaceRoot || getDefaultWorkspaceRoot(),
          workspaceRootValid: null,
          filesScanned: 0,
          p0Count: 0,
          p1Count: 0,
          p2Count: 0,
          exportPath: null,
          proofReceiptsWritten: false,
          timestampMs: timestampMs(),
          note: exitValue === '1' ? 'Native proof will exit after completion if safe.' : 'Native proof will leave the app open after completion.'
        });
        await invoke('write_workspace_text_file', {
          workspaceRoot: proofWorkspaceRoot,
          relativePath: 'release/rc0/native-selfdev-started.json',
          content: JSON.stringify({
            runtime: 'native_tauri',
            state: 'running',
            autorun: true,
            workspaceRoot: proofWorkspaceRoot,
            timestampMs: timestampMs(),
            exitOnComplete: exitValue === '1'
          }, null, 2)
        }).catch(() => {});
      }

      try {
        await writeNativeProofStage('05_autorun_observer_triggered.json', {
          status: 'running',
          workspaceRoot: proofWorkspaceRoot,
          note: 'Native autorun observer branch reached before workspace validation.'
        });
        const cycle = await runSelfDevelopmentCycle({
          root: proofWorkspaceRoot,
          settings,
          updateCheckState,
          verificationLogs,
          workspaceFoundation,
          proofHooks: nativeProofHooks
        });
        if (cancelled) return;
        const nextProof = {
          runtime: 'native_tauri',
          proofAuthority: PROOF_AUTHORITY.JS_BRIDGE,
          proofMode: 'automated_native',
          autorun: true,
          state: 'partial',
          workspaceRoot: cycle?.root || settings.workspaceRoot || getDefaultWorkspaceRoot(),
          workspaceRootValid: Boolean(cycle?.validation?.ok),
          filesScanned: Number(cycle?.auditSummary?.filesScanned || 0),
          p0Count: Number(cycle?.auditSummary?.blockerCount || 0),
          p1Count: Number(cycle?.readinessSummary?.partialCount || 0),
          p2Count: Number(cycle?.readinessSummary?.needsSetupCount || 0),
          topPackets: Array.isArray(cycle?.packets) ? cycle.packets.slice(0, 10).map((packet) => ({
            id: packet.id,
            title: packet.title,
            priority: packet.priority,
            riskLevel: packet.riskLevel
          })) : [],
          exportPath: cycle?.exportProof?.file_path || cycle?.exportProof?.filePath || null,
          proofReceiptsWritten: false,
          rc0Proof: cycle?.rc0Proof || null,
          timestampMs: cycle?.generatedAtMs || timestampMs(),
          note: cycle?.rc0Error
            ? `JS bridge RC0 export error: ${cycle.rc0Error}`
            : 'JS bridge scan recorded. Rust RC0 engine and release/rc0/proof/*.json remain proof authority.'
        };
        setNativeSelfDevProof(nextProof);
        await invoke('write_workspace_text_file', {
          workspaceRoot: proofWorkspaceRoot,
          relativePath: 'release/rc0/native-selfdev-complete.json',
          content: JSON.stringify(nextProof, null, 2)
        }).catch(() => {});
      } catch (error) {
        if (!cancelled) {
          const failedProof = {
            runtime: 'native_tauri',
            proofMode: 'automated_native',
            autorun: true,
            state: 'failed',
            workspaceRoot: proofWorkspaceRoot,
            workspaceRootValid: false,
            filesScanned: 0,
            p0Count: 0,
            p1Count: 0,
            p2Count: 0,
            exportPath: null,
            proofReceiptsWritten: false,
            timestampMs: timestampMs(),
            error: String(error)
          };
          setNativeSelfDevProof(failedProof);
          await invoke('write_workspace_text_file', {
            workspaceRoot: proofWorkspaceRoot,
            relativePath: 'release/rc0/native-selfdev-error.json',
            content: JSON.stringify(failedProof, null, 2)
          }).catch(() => {});
        }
      }
    }

    void runNativeSelfDevelopmentProof();
    return () => {
      cancelled = true;
    };
  }, [desktopBridge.state, nativeProofHooks, settings.workspaceRoot, updateCheckState, verificationLogs, workspaceFoundation]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        switchTab('settings');
      }
      if (event.key === 'Escape' && approvalPending) {
        setApprovalPending(null);
        setApprovalRequiredNotice(true);
        approvalResolveRef.current?.(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [approvalPending]);

  useEffect(() => {
    const go  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online',  go);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', go); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    const IDLE_MS = (settings.idleTimeoutMinutes || 10) * 60 * 1000;
    const reset = () => {
      setIsLocked(false);
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setIsLocked(true), IDLE_MS);
    };
    const events = ['mousedown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(idleTimerRef.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [settings.idleTimeoutMinutes]);

  useEffect(() => {
    appendSessionEvent({
      category: 'app_lifecycle',
      title: 'Alphonso app session started',
      details: { runtime: isCoachWindow ? 'coach_window' : 'main_window' },
      agent: 'alphonso',
      confidence: TRUST_STATES.TEMPORARY,
      verificationState: TRUST_STATES.UNVERIFIED
    });

    const onBeforeUnload = () => {
      appendSessionEvent({
        category: 'app_lifecycle',
        title: 'Alphonso app window closing',
        details: { runtime: isCoachWindow ? 'coach_window' : 'main_window' },
        agent: 'alphonso',
        confidence: TRUST_STATES.TEMPORARY,
        verificationState: TRUST_STATES.UNVERIFIED
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isCoachWindow]);

  useEffect(() => {
    appendSessionEvent({
      category: 'agent_switch',
      title: `Active workspace switched to ${activeTab}`,
      details: { activeTab },
      agent: activeTab === 'miya' ? 'miya' : activeTab === 'orchestrator' ? 'jose' : activeTab === 'hector' ? 'hector' : 'alphonso',
      confidence: TRUST_STATES.TEMPORARY,
      verificationState: TRUST_STATES.UNVERIFIED
    });
  }, [activeTab]);

  useEffect(() => {
    appendSessionEvent({
      category: 'runtime',
      title: `Ollama runtime state: ${ollamaStatus.state}`,
      details: { state: ollamaStatus.state, label: ollamaStatus.label },
      agent: 'alphonso',
      confidence: ollamaStatus.trust || TRUST_STATES.TEMPORARY,
      verificationState: ollamaStatus.trust || TRUST_STATES.UNVERIFIED
    });
  }, [ollamaStatus.state]);

  const prevOllamaStateRef = useRef(ollamaStatus.state);
  useEffect(() => {
    const prev = prevOllamaStateRef.current;
    const curr = ollamaStatus.state;
    prevOllamaStateRef.current = curr;
    const wasConnected = prev === 'connected';
    const isDisconnected = ['not_running', 'cors', 'timeout', 'disconnected', 'error'].includes(curr);
    const isNowConnected = curr === 'connected';
    if (wasConnected && isDisconnected) {
      toast.error('Ollama disconnected', 'Retrying automatically. Check that Ollama is running.');
    } else if (!wasConnected && isNowConnected && prev !== 'connecting') {
      toast.success('Ollama reconnected', `Connected to ${ollamaStatus.models?.length ?? 0} model(s).`);
    }
  }, [ollamaStatus.state]);

  useEffect(() => {
    if (updateCheckState.available && updateCheckState.latestVersion) {
      toast.info('Update available', `Alphonso ${updateCheckState.latestVersion} is ready — open Settings to install.`);
    }
  }, [updateCheckState.available, updateCheckState.latestVersion]);

  useEffect(() => {
    if (ollamaStatus.state !== 'connected' && ollamaStatus.state !== 'connecting') {
      setJoseCompanionState({ state: 'warning', message: 'Runtime attention required.' });
      return;
    }
    if (approvalRequiredNotice) {
      setJoseCompanionState({ state: 'approving', message: 'Approval queue needs review.' });
      return;
    }
    if (activeTab === 'orchestrator') {
      setJoseCompanionState({ state: 'thinking', message: 'Jose is reviewing the ecosystem.' });
      return;
    }
    setJoseCompanionState({ state: 'idle', message: 'Jose is coordinating quietly.' });
  }, [activeTab, approvalRequiredNotice, ollamaStatus.state]);

  useEffect(() => {
    let cancelled = false;

    async function inspectDesktopBridge() {
      try {
        const [name, version] = await Promise.all([getName(), getVersion()]);
        if (!cancelled) {
          setDesktopBridge({
            state: 'connected',
            label: 'Connected',
            message: `${name || 'Alphonso'} ${version || ''}`.trim()
          });
        }
      } catch (error) {
        if (!cancelled) {
          setDesktopBridge({
            state: 'disconnected',
            label: 'Browser preview',
            message: 'Tauri app APIs are not available in this runtime.'
          });
        }
      }
    }

    inspectDesktopBridge();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSupervisedState = async () => {
      const [audit, manifests] = await Promise.all([
        readDurableAuditLog(200),
        discoverDiskPluginManifests(settings.workspaceRoot)
      ]);

      if (cancelled) return;
      setDurableAuditLogs(Array.isArray(audit) ? audit : []);
      setDiskPluginManifests(Array.isArray(manifests) ? manifests : []);
    };

    loadSupervisedState();
    return () => {
      cancelled = true;
    };
  }, [settings.workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    if (isCoachWindow) return undefined;

    const hydrate = async () => {
      const durableRows = await hydrateMemoryFromDurable();
      if (!cancelled && Array.isArray(durableRows) && durableRows.length) {
        setMemoryItems(durableRows);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [desktopBridge.state, isCoachWindow]);

  useEffect(() => {
    let cancelled = false;
    if (isCoachWindow) return undefined;

    const hydrateRuntimeLedgers = async () => {
      const proof = await bootstrapRuntimeLedgerHydration([
        { scope: PACKET_SCOPE, storageKey: 'alphonso_agent_bus_packets_v1' },
        { scope: JOSE_COMMAND_SCOPE, storageKey: 'alphonso_jose_command_routes_v2' },
        { scope: SESSION_EVENT_SCOPE, storageKey: 'alphonso_session_events_v1' },
        { scope: GOVERNANCE_SCOPE, storageKey: 'alphonso_jose_governance_decisions_v1' },
        { scope: ORCHESTRATION_RECEIPT_SCOPE, storageKey: 'alphonso_orchestration_receipts_v1' },
        { scope: ORCHESTRATION_QUEUE_SCOPE, storageKey: 'alphonso_orchestration_queue_transitions_v1' },
        { scope: VERIFICATION_SCOPE, storageKey: 'alphonso_verification_logs_v1' },
        { scope: CONNECTOR_SCOPE, storageKey: 'alphonso_connector_registry_v2' },
        { scope: CONNECTOR_AUDIT_SCOPE, storageKey: 'alphonso_connector_audit_v2' },
        { scope: CONNECTOR_AUTH_SCOPE, storageKey: 'alphonso_connector_auth_profiles_v1' },
        { scope: TOOL_CONNECTION_SCOPE, storageKey: 'alphonso_tool_connections_v1' },
        { scope: TOOL_CONNECTION_AUDIT_SCOPE, storageKey: 'alphonso_tool_connection_audit_v1' },
        { scope: MIYA_MEMORY_SCOPE, storageKey: 'alphonso_miya_memory_v1' },
        { scope: PLUGINS_SCOPE, storageKey: 'alphonso_plugins_v1' },
        { scope: PLUGIN_AUDIT_SCOPE, storageKey: 'alphonso_plugin_audit_v1' },
        { scope: REPO_AUDIT_SCOPE, storageKey: 'alphonso_repo_audits_v1' },
        { scope: PRODUCTION_READINESS_SCOPE, storageKey: 'alphonso_production_readiness_v1' },
        { scope: DEV_PACKET_SCOPE, storageKey: 'alphonso_dev_packets_v1' },
        { scope: SELF_DEVELOPMENT_SCOPE, storageKey: 'alphonso_self_development_cycles_v1' },
        { scope: WORKFLOW_OPS_SCOPE, storageKey: 'alphonso_workflow_operations_registry_v1' },
        { scope: WORKFLOW_RUN_SCOPE, storageKey: 'alphonso_workflow_runs_v1' },
        { scope: WORKFLOW_RECEIPT_SCOPE, storageKey: 'alphonso_workflow_receipts_v1' },
        { scope: WORKFLOW_TELEMETRY_SCOPE, storageKey: 'alphonso_workflow_telemetry_v1' }
      ]);
      if (cancelled || !proof?.available) return;
      setVerificationLogs(getVerificationLogs());
      setPlugins(listPlugins());
      setPluginAudit(listPluginAudit());
      setMemoryItems(listMemoryItems());
    };

    hydrateRuntimeLedgers();
    return () => {
      cancelled = true;
    };
  }, [desktopBridge.state, isCoachWindow]);

  const runOllamaCheck = useCallback(async () => {
    const runId = ollamaCheckRunRef.current + 1;
    ollamaCheckRunRef.current = runId;

    setOllamaStatus((current) => ({
      ...current,
      state: 'connecting',
      label: 'Connecting',
      message: 'Checking Ollama /api/tags...'
    }));

    let result = await checkOllama(settings.endpoint, settings.selectedModel);
    let trust = result.state === 'connected' ? TRUST_STATES.VERIFIED : TRUST_STATES.FAILED;

    if (
      desktopBridge.state === 'connected' &&
      ['not_running', 'disconnected', 'timeout', 'cors'].includes(result.state)
    ) {
      const proof = await verifyOllamaRuntimeProof(settings.endpoint);
      setVerificationLogs((current) => [...current, proof].slice(-250));

      const runtimeProof = proof?.payload || {};
      const proofModels = Array.isArray(runtimeProof.models)
        ? runtimeProof.models
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => ({ name }))
        : [];

      if (runtimeProof.reachable) {
        const selectedFromProof = chooseDefaultModel(proofModels, settings.selectedModel);
        const mergedModels = proofModels.length > 0 ? proofModels : result.models;
        const hasModels = Array.isArray(mergedModels) && mergedModels.length > 0;
        result = {
          state: hasModels ? 'connected' : 'no_models',
          label: hasModels ? 'Connected (Desktop Bridge)' : 'No model available',
          message: hasModels
            ? 'Ollama is reachable from the desktop runtime bridge. Frontend CORS path is bypassed safely.'
            : 'Ollama is reachable from the desktop runtime bridge, but no local model was returned.',
          models: mergedModels,
          selectedModel: selectedFromProof || result.selectedModel,
          transport: 'desktop_bridge'
        };
        trust = TRUST_STATES.VERIFIED;
      } else if (runtimeProof.reason) {
        const normalizedReason = String(runtimeProof.reason).toLowerCase();
        if (normalizedReason.includes('timeout')) {
          result = {
            ...result,
            state: 'timeout',
            label: 'Request timeout',
            message: 'Ollama did not respond before timeout from desktop runtime proof.'
          };
        } else if (normalizedReason.includes('connection') || normalizedReason.includes('refused')) {
          result = {
            ...result,
            state: 'not_running',
            label: 'Ollama not running',
            message: 'Ollama is not reachable from frontend or desktop runtime proof.'
          };
        }
      }
    }

    if (ollamaCheckRunRef.current !== runId) return;

    setOllamaStatus({ ...result, trust });
    setLastCheckedAt(new Date());

    const log = appendVerificationLog({
      type: 'ollama_health_check',
      source: 'frontend-fetch',
      trust,
      payload: {
        endpoint: settings.endpoint,
        state: result.state,
        label: result.label,
        modelCount: result.models?.length || 0
      }
    });
    setVerificationLogs((current) => [...current, log].slice(-250));

    const memory = pushMemoryItem({
      category: 'runtime_memory',
      confidence: trust,
      source: 'ollama-health-check',
      verificationState: trust,
      expiresAt: timestampMs() + 5 * 60 * 1000,
      content: `Ollama check: ${result.label} (${result.state})`
    });
    setMemoryItems((current) => [...current, memory].slice(-500));

    if ((!settings.selectedModel || result.state === 'model_missing') && result.selectedModel) {
      setSettings((current) => ({
        ...current,
        selectedModel: result.selectedModel
      }));
    }
  }, [desktopBridge.state, settings.endpoint, settings.selectedModel]);

  useEffect(() => {
    runOllamaCheck();
  }, [runOllamaCheck]);

  const runUpdateCheck = useCallback(async ({ manual = false } = {}) => {
    if (!settings.autoUpdateEnabled && !manual) return;
    if (isCoachWindow) return;
    if (desktopBridge.state !== 'connected') return;

    setUpdateCheckState((current) => ({
      ...current,
      checking: true
    }));

    const proof = await checkAppUpdate({
      endpoint: settings.updaterEndpoint,
      pubkey: settings.updaterPubkey,
      target: settings.updaterTarget
    });

    const notificationSent = proof.available ? await notifyUpdateAvailable(proof) : false;
    setUpdateCheckState({
      checking: false,
      configured: Boolean(proof.configured),
      available: Boolean(proof.available),
      latestVersion: proof.latestVersion || null,
      currentVersion: proof.currentVersion || '',
      notes: proof.notes || null,
      pubDate: proof.pubDate || null,
      downloadUrl: proof.downloadUrl || null,
      checkedAtMs: proof.checkedAtMs || Date.now(),
      trust: proof.trust || TRUST_STATES.UNVERIFIED,
      error: proof.error || null,
      notificationSent
    });

    const trust = proof.available ? TRUST_STATES.VERIFIED : (proof.configured ? TRUST_STATES.INFERRED : TRUST_STATES.UNVERIFIED);
    const log = appendVerificationLog({
      type: 'app_update_check',
      source: 'tauri-updater-runtime',
      trust,
      payload: {
        configured: Boolean(proof.configured),
        available: Boolean(proof.available),
        latestVersion: proof.latestVersion || null,
        error: proof.error || null
      }
    });
    setVerificationLogs((current) => [...current, log].slice(-250));
  }, [desktopBridge.state, isCoachWindow, settings.autoUpdateEnabled, settings.updaterEndpoint, settings.updaterPubkey, settings.updaterTarget]);

  useEffect(() => {
    if (!settings.autoUpdateEnabled || isCoachWindow || desktopBridge.state !== 'connected') return undefined;
    runUpdateCheck({ manual: false });
    const intervalMs = 1000 * 60 * 30;
    const timer = window.setInterval(() => runUpdateCheck({ manual: false }), intervalMs);
    return () => window.clearInterval(timer);
  }, [desktopBridge.state, isCoachWindow, runUpdateCheck, settings.autoUpdateEnabled]);

  useEffect(() => () => {
    if (screenObserverRunRef.current) {
      stopScreenObserver();
    }
  }, []);

  useEffect(() => {
    const BACKOFF = [5000, 10000, 15000, 30000];
    const CONNECTED_INTERVAL = 30000;
    let timeoutId = null;
    let attempt = 0;
    let lastState = ollamaStatus.state;

    const schedule = (ms) => {
      timeoutId = window.setTimeout(async () => {
        await runOllamaCheck();
        const state = ollamaStatus.state;
        const disconnected = ['not_running', 'cors', 'timeout', 'disconnected', 'error'].includes(state);
        if (disconnected) {
          attempt = Math.min(attempt + 1, BACKOFF.length - 1);
          schedule(BACKOFF[attempt]);
        } else {
          attempt = 0;
          schedule(CONNECTED_INTERVAL);
        }
        lastState = state;
      }, ms);
    };

    schedule(ollamaStatus.state === 'connected' ? CONNECTED_INTERVAL : BACKOFF[0]);
    return () => window.clearTimeout(timeoutId);
  }, [runOllamaCheck]);

  useEffect(() => {
    if (isCoachWindow) return;
    isBraveSearchConfigured().then((configured) => setBraveSearchConfigured(configured)).catch(() => {});
  }, [isCoachWindow]);

  useEffect(() => {
    if (isCoachWindow) return;
    let cancelled = false;
    let timeoutId = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        if (isConnectorAuthenticated('whatsapp')) {
          const result = await pollWhatsAppConnector(12);
          if (!cancelled && result?.routed > 0) {
            toast.info(
              `WhatsApp — ${result.routed} message${result.routed > 1 ? 's' : ''} routed to Jose`,
              `${result.rejected > 0 ? `${result.rejected} rejected (not on allowlist). ` : ''}Check Orchestrator for approvals.`
            );
          }
        }
      } catch { /* best-effort */ }
      if (!cancelled) {
        timeoutId = window.setTimeout(poll, 30000);
      }
    };

    timeoutId = window.setTimeout(poll, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isCoachWindow]);

  useEffect(() => {
    if (!operatorMode) return undefined;
    let cancelled = false;

    const refreshAudit = async () => {
      const logs = await readDurableAuditLog(200);
      if (!cancelled) {
        setDurableAuditLogs(Array.isArray(logs) ? logs : []);
      }
    };

    refreshAudit();
    const timer = window.setInterval(refreshAudit, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [operatorMode]);

  const installedModels = ollamaStatus.models || [];
  const selectedModelMissing = Boolean(
    settings.selectedModel &&
    installedModels.length > 0 &&
    !installedModels.some((model) => model.name === settings.selectedModel)
  );
  const companion = getCompanionState({
    ollamaStatus,
    voiceStatus: voice.voiceStatus,
    isGeneratingResponse,
    lastTaskCompletedAt,
    selectedModelMissing,
    privacyModeActive: settings.privacyShieldActive,
    approvalModeActive: settings.approvalMode,
    approvalRequiredNotice
  });

  useEffect(() => {
    if (!lastTaskCompletedAt) return undefined;
    const timeoutId = window.setTimeout(() => setLastTaskCompletedAt(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [lastTaskCompletedAt]);

  useEffect(() => {
    if (!approvalRequiredNotice) return undefined;
    const timeoutId = window.setTimeout(() => setApprovalRequiredNotice(false), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [approvalRequiredNotice]);

  const requestApproval = useCallback((actionLabel) => {
    if (!settings.approvalMode) return Promise.resolve(true);
    if (!needsHighRiskApproval(actionLabel)) return Promise.resolve(true);
    return new Promise((resolve) => {
      approvalResolveRef.current = resolve;
      setApprovalPending(actionLabel);
    });
  }, [settings.approvalMode]);

  const createNewChat = () => {
    const newId = `chat-${Date.now()}`;
    const newChat = { id: newId, title: 'Unsaved Chat', timestamp: Date.now() };
    setConversations((current) => [newChat, ...current]);
    setActiveChatId(newId);
    switchTab('chat');
  };

  const deleteChat = (id, event) => {
    event.stopPropagation();
    const filtered = conversations.filter((conversation) => conversation.id !== id);

    if (filtered.length === 0) {
      const resetId = INITIAL_CONVERSATION_ID;
      setConversations([{ id: resetId, title: 'New Chat Session', timestamp: Date.now() }]);
      setActiveChatId(resetId);
    } else {
      setConversations(filtered);
      if (activeChatId === id) setActiveChatId(filtered[0].id);
    }

    localStorage.removeItem(`alphonso_messages_${id}`);
  };

  const copyTroubleshootingCommand = async () => {
    try {
      await navigator.clipboard.writeText(OLLAMA_TROUBLESHOOTING_COMMAND);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1600);
    }
  };

  const verifyOllamaWithProof = async () => {
    if (!await requestApproval('Run Ollama runtime verification')) return;
    await runOllamaCheck();
    const proof = await verifyOllamaRuntimeProof(settings.endpoint);
    setVerificationLogs((current) => [...current, proof].slice(-250));
  };

  const verifyProcesses = async (names) => {
    if (!await requestApproval(`Check process state: ${names.join(', ')}`)) return;
    const proof = await verifyProcessProof(names);
    setVerificationLogs((current) => [...current, proof].slice(-250));
  };

  const verifyPaths = async (paths) => {
    if (!await requestApproval(`Verify filesystem paths: ${paths.join(', ')}`)) return;
    const proof = await verifyPathProof(paths);
    setVerificationLogs((current) => [...current, proof].slice(-250));
  };

  const verifyAuditChain = async () => {
    if (!await requestApproval('Verify durable audit chain integrity')) return;
    const proof = await verifyDurableAuditChain();
    setAuditChainProof(proof?.payload || null);
    setVerificationLogs((current) => [...current, proof].slice(-250));
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const verifyCommand = async (program, args) => {
    if (!program) return;
    if (settings.safeMode) {
      const safePrograms = ['ollama', 'where', 'where.exe', 'tasklist', 'npm', 'npm.cmd'];
      if (!safePrograms.includes(program.toLowerCase())) {
        const log = appendVerificationLog({
          type: 'command_blocked_safe_mode',
          source: 'frontend-policy',
          trust: TRUST_STATES.VERIFIED,
          payload: {
            program,
            reason: 'Blocked by safe mode policy'
          }
        });
        setVerificationLogs((current) => [...current, log].slice(-250));
        setApprovalRequiredNotice(true);
        return;
      }
    }
    if (!await requestApproval(`Execute command: ${program} ${args.join(' ')}`)) return;
    const proof = await verifyCommandExecution(program, args, null);
    setVerificationLogs((current) => [...current, proof].slice(-250));
  };

  const handleTogglePlugin = async (pluginId, enabled) => {
    if (!await requestApproval(`${enabled ? 'Enable' : 'Disable'} plugin: ${pluginId}`)) return;
    setPlugins(togglePlugin(pluginId, enabled));
    setPluginAudit(listPluginAudit());
  };

  const handleToggleWorkspaceFeature = (featureKey, enabled) => {
    const feature = workspaceFoundation[featureKey] || {};
    setWorkspaceFoundation(updateWorkspaceFoundation({
      [featureKey]: {
        ...feature,
        enabled,
        verificationState: enabled ? TRUST_STATES.TEMPORARY : TRUST_STATES.UNVERIFIED
      }
    }));
  };

  const handleDiscoverPlugins = async () => {
    if (!await requestApproval('Discover plugin manifests from disk')) return;
    const manifests = await discoverDiskPluginManifests(settings.workspaceRoot);
    setDiskPluginManifests(manifests);
    const log = appendVerificationLog({
      type: 'plugin_manifest_scan',
      source: 'tauri-command',
      trust: TRUST_STATES.VERIFIED,
      payload: {
        workspaceRoot: settings.workspaceRoot || null,
        count: manifests.length
      }
    });
    setVerificationLogs((current) => [...current, log].slice(-250));
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const handleRunWorkspaceProof = async () => {
    if (!settings.workspaceRoot) {
      const log = appendVerificationLog({
        type: 'workspace_proof',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: 'Workspace root is not set.'
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      return;
    }
    if (!await requestApproval(`Collect workspace proof for ${settings.workspaceRoot}`)) return;
    try {
      const proof = await collectWorkspaceProof(settings.workspaceRoot, 1200);
      setWorkspaceProof(proof);
      const log = appendVerificationLog({
        type: 'workspace_proof',
        source: 'tauri-command',
        trust: proof?.trust || TRUST_STATES.TEMPORARY,
        payload: proof
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      setWorkspaceFoundation(updateWorkspaceFoundation({
        workspaceProof: {
          lastRunAt: Date.now(),
          trust: proof?.trust || TRUST_STATES.UNVERIFIED
        }
      }));
    } catch (error) {
      const log = appendVerificationLog({
        type: 'workspace_proof',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: String(error)
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
    }
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const handleCheckOcrCapability = async () => {
    if (!await requestApproval('Check OCR engine capability')) return;
    try {
      const proof = await checkOcrCapability(settings.ocrEnginePath);
      setOcrCapability(proof);
      const log = appendVerificationLog({
        type: 'ocr_capability_check',
        source: 'tauri-command',
        trust: proof?.trust || TRUST_STATES.UNVERIFIED,
        payload: proof
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      setWorkspaceFoundation(updateWorkspaceFoundation({
        ocrCapability: {
          available: Boolean(proof?.available),
          engine: proof?.engine || 'unconfigured',
          message: proof?.message || '',
          checkedAtMs: proof?.checked_at_ms || Date.now(),
          verificationState: proof?.trust || TRUST_STATES.UNVERIFIED
        }
      }));
    } catch (error) {
      const log = appendVerificationLog({
        type: 'ocr_capability_check',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: String(error)
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
    }
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const handleBuildSymbolIndex = async () => {
    if (!settings.workspaceRoot) {
      const log = appendVerificationLog({
        type: 'symbol_index_build',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: 'Workspace root is not set.'
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      return;
    }
    if (!await requestApproval(`Build workspace symbol index for ${settings.workspaceRoot}`)) return;
    try {
      const index = await buildWorkspaceSymbolIndex(settings.workspaceRoot, 500);
      setWorkspaceSymbolIndex(index);
      const log = appendVerificationLog({
        type: 'symbol_index_build',
        source: 'tauri-command',
        trust: index?.trust || TRUST_STATES.TEMPORARY,
        payload: {
          root: index?.root,
          filesIndexed: index?.files_indexed,
          totals: index?.totals
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
    } catch (error) {
      const log = appendVerificationLog({
        type: 'symbol_index_build',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: String(error)
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
    }
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const handleExecutePluginTool = async ({ manifestPath, pluginId, toolId, extraArgs }) => {
    const policyCheck = evaluatePluginExecutionPolicy({
      manifestPath,
      pluginId,
      toolId,
      extraArgs
    });
    if (!policyCheck.allowed) {
      const log = appendVerificationLog({
        type: 'plugin_tool_execution_blocked',
        source: 'plugin-sandbox-policy',
        trust: TRUST_STATES.FAILED,
        payload: policyCheck
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      appendPluginAuditEntry({
        pluginId: pluginId || 'unknown',
        action: 'tool_execution_blocked_local_policy',
        trust: TRUST_STATES.FAILED,
        details: {
          toolId: toolId || '',
          violations: policyCheck?.violations || []
        }
      });
      setPluginAudit(listPluginAudit());
      setApprovalRequiredNotice(true);
      return;
    }

    if (pluginSandboxPolicy.requireManifestValidation) {
      try {
        const validation = await validatePluginManifestDisk(manifestPath);
        setLastManifestValidation(validation);
        if (!validation.valid) {
          const log = appendVerificationLog({
            type: 'plugin_manifest_validation_blocked',
            source: 'plugin-sandbox-policy',
            trust: TRUST_STATES.FAILED,
            payload: validation
          });
          setVerificationLogs((current) => [...current, log].slice(-250));
          appendPluginAuditEntry({
            pluginId: pluginId || 'unknown',
            action: 'manifest_validation_blocked',
            trust: TRUST_STATES.FAILED,
            details: {
              toolId: toolId || '',
              errors: validation?.errors || [],
              warnings: validation?.warnings || []
            }
          });
          setPluginAudit(listPluginAudit());
          setApprovalRequiredNotice(true);
          return;
        }
      } catch (error) {
        const log = appendVerificationLog({
          type: 'plugin_manifest_validation_blocked',
          source: 'plugin-sandbox-policy',
          trust: TRUST_STATES.FAILED,
          payload: { error: String(error) }
        });
        setVerificationLogs((current) => [...current, log].slice(-250));
        appendPluginAuditEntry({
          pluginId: pluginId || 'unknown',
          action: 'manifest_validation_failed',
          trust: TRUST_STATES.FAILED,
          details: {
            toolId: toolId || '',
            error: String(error)
          }
        });
        setPluginAudit(listPluginAudit());
        setApprovalRequiredNotice(true);
        return;
      }
    }

    if (!await requestApproval(`Execute plugin tool ${pluginId}:${toolId}`)) return;
    try {
      const proof = await executePluginToolRun({
        manifestPath,
        pluginId,
        toolId,
        extraArgs,
        workspaceRoot: settings.workspaceRoot
      });
      setLastPluginToolRun(proof);
      const log = appendVerificationLog({
        type: 'plugin_tool_execution',
        source: 'tauri-command',
        trust: proof?.trust || TRUST_STATES.TEMPORARY,
        payload: {
          pluginId: proof?.plugin_id,
          toolId: proof?.tool_id,
          success: proof?.success,
          exitCode: proof?.exit_code
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      appendPluginAuditEntry({
        pluginId: proof?.plugin_id || pluginId || 'unknown',
        action: proof?.success ? 'tool_execution_success' : 'tool_execution_failed',
        trust: proof?.trust || TRUST_STATES.TEMPORARY,
        details: {
          toolId: proof?.tool_id || toolId || '',
          exitCode: proof?.exit_code ?? null
        }
      });
      setPluginAudit(listPluginAudit());
    } catch (error) {
      const log = appendVerificationLog({
        type: 'plugin_tool_execution',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: String(error)
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      appendPluginAuditEntry({
        pluginId: pluginId || 'unknown',
        action: 'tool_execution_error',
        trust: TRUST_STATES.FAILED,
        details: {
          toolId: toolId || '',
          error: String(error)
        }
      });
      setPluginAudit(listPluginAudit());
    }
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const handleUpdatePluginSandboxPolicy = (patch) => {
    const next = updatePluginSandboxPolicy(patch);
    setPluginSandboxPolicy(next);
    const log = appendVerificationLog({
      type: 'plugin_sandbox_policy_update',
      source: 'operator-dashboard',
      trust: TRUST_STATES.VERIFIED,
      payload: next
    });
    setVerificationLogs((current) => [...current, log].slice(-250));
  };

  const handleValidatePluginManifest = async (manifestPath) => {
    if (!manifestPath) return;
    if (!await requestApproval(`Validate plugin manifest ${manifestPath}`)) return;
    try {
      const validation = await validatePluginManifestDisk(manifestPath);
      setLastManifestValidation(validation);
      const log = appendVerificationLog({
        type: 'plugin_manifest_validation',
        source: 'tauri-command',
        trust: validation?.trust || TRUST_STATES.TEMPORARY,
        payload: validation
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      appendPluginAuditEntry({
        pluginId: 'manifest_validation',
        action: validation?.valid ? 'manifest_valid' : 'manifest_invalid',
        trust: validation?.trust || TRUST_STATES.TEMPORARY,
        details: {
          manifestPath,
          errors: validation?.errors || [],
          warnings: validation?.warnings || []
        }
      });
      setPluginAudit(listPluginAudit());
    } catch (error) {
      const log = appendVerificationLog({
        type: 'plugin_manifest_validation',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: String(error)
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      appendPluginAuditEntry({
        pluginId: 'manifest_validation',
        action: 'manifest_validation_error',
        trust: TRUST_STATES.FAILED,
        details: {
          manifestPath,
          error: String(error)
        }
      });
      setPluginAudit(listPluginAudit());
    }
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const handleRunOcrAdapter = async ({ adapter, imagePath, extraArgs }) => {
    if (!settings.ocrEnginePath) {
      const log = appendVerificationLog({
        type: 'ocr_adapter_run',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: 'OCR engine path is not set.'
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
      return;
    }
    if (!await requestApproval(`Run OCR adapter ${adapter}`)) return;
    try {
      const proof = await runOcrAdapter({
        adapter,
        enginePath: settings.ocrEnginePath,
        imagePath: imagePath || null,
        extraArgs
      });
      setLastOcrAdapterRun(proof);
      const log = appendVerificationLog({
        type: 'ocr_adapter_run',
        source: 'tauri-command',
        trust: proof?.trust || TRUST_STATES.TEMPORARY,
        payload: {
          adapter: proof?.adapter,
          success: proof?.success,
          exitCode: proof?.exit_code
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
    } catch (error) {
      const log = appendVerificationLog({
        type: 'ocr_adapter_run',
        source: 'tauri-command',
        trust: TRUST_STATES.FAILED,
        payload: {
          error: String(error)
        }
      });
      setVerificationLogs((current) => [...current, log].slice(-250));
    }
    setDurableAuditLogs(await readDurableAuditLog(200));
  };

  const handleCreateSnapshot = async () => {
    if (!await requestApproval('Create restore point snapshot')) return;
    const snapshot = await createSnapshot({
      settings,
      ollamaStatus,
      activeChatId,
      verificationLogCount: verificationLogs.length,
      memoryCount: memoryItems.length
    });
    setSnapshots((current) => [...current, snapshot].slice(-40));
  };

  const handleRestoreSnapshot = async (snapshotId) => {
    if (!await requestApproval(`Restore snapshot: ${snapshotId}`)) return;
    const payload = restoreSnapshotById(snapshotId);
    if (!payload) return;

    if (payload.settings) {
      setSettings(payload.settings);
    }
    if (payload.activeChatId) {
      setActiveChatId(payload.activeChatId);
    }
    if (payload.ollamaStatus) {
      setOllamaStatus(payload.ollamaStatus);
    }

    const log = appendVerificationLog({
      type: 'restore_snapshot',
      source: 'local-recovery',
      trust: TRUST_STATES.VERIFIED,
      payload: { snapshotId }
    });
    setVerificationLogs((current) => [...current, log].slice(-250));
    setLastTaskCompletedAt(Date.now());
  };

  const handleBackupMemory = async () => {
    if (!await requestApproval('Create memory backup')) return;
    const backup = backupMemoryLedger(memoryItems);
    const log = appendVerificationLog({
      type: 'memory_backup',
      source: 'local-recovery',
      trust: TRUST_STATES.VERIFIED,
      payload: { backupId: backup.id, count: backup.items.length }
    });
    setVerificationLogs((current) => [...current, log].slice(-250));
  };

  const handleRunReleasePreflight = async () => {
    if (!await requestApproval('Run release preflight: test + build + tauri build')) return;
    await verifyCommand('npm.cmd', ['run', 'verify:desktop']);
  };

  const handleRequestScreenObserverPermission = async () => {
    if (!await requestApproval('Request desktop notification permission for screen alerts')) return;
    const permission = await requestScreenNotificationPermission();
    const next = updateScreenObserverState({
      currentSummary: permission === 'granted'
        ? 'Notification permission granted.'
        : permission === 'unsupported'
          ? 'Notifications are unsupported in this runtime.'
          : 'Notification permission not granted.'
    });
    setScreenObserverState(next);
  };

  const handleStartScreenObserver = async () => {
    if (!await requestApproval('Start visible screen observer (manual permission prompt)')) return;
    const current = getScreenObserverState();
    const result = await startScreenObserver({
      sampleEveryMs: current.sampleEveryMs || 5000,
      notificationsEnabled: current.notificationsEnabled !== false,
      audioAlertEnabled: current.audioAlertEnabled === true,
      onUpdate: (nextState, event) => {
        setScreenObserverState(nextState);
        if (event) {
          setScreenObserverLogs(getScreenObserverLogs());
          pushMemoryItem({
            title: `Screen observer: ${event.status}`,
            category: 'workspace_memory',
            content: `${event.summary} (change ${event.changeLevel})`,
            source: 'screen-observer',
            sourceAgent: 'alphonso',
            confidence: TRUST_STATES.INFERRED,
            verificationState: TRUST_STATES.INFERRED,
            expiresAt: timestampMs() + 7 * 24 * 60 * 60 * 1000,
            expiryRule: 'visual_pattern_7d'
          });
          if (event.status === 'high_change_detected' || event.status === 'pattern_repeated') {
            setHectorCompanionState({
              state: 'warning',
              message: event.summary,
              currentSourceUrl: null,
              lastRunSummary: event.summary
            });
          }
        }
      }
    });
    screenObserverRunRef.current = Boolean(result?.ok);
    if (result?.ok) {
      setWorkspaceFoundation(updateWorkspaceFoundation({
        screenCapture: {
          ...(workspaceFoundation.screenCapture || {}),
          enabled: true,
          verificationState: TRUST_STATES.INFERRED
        }
      }));
    }
    setScreenObserverLogs(getScreenObserverLogs());
  };

  const handleStopScreenObserver = () => {
    const next = stopScreenObserver();
    screenObserverRunRef.current = false;
    setWorkspaceFoundation(updateWorkspaceFoundation({
      screenCapture: {
        ...(workspaceFoundation.screenCapture || {}),
        enabled: false,
        verificationState: TRUST_STATES.TEMPORARY
      }
    }));
    setScreenObserverState(next);
    setScreenObserverLogs(getScreenObserverLogs());
  };

  const handleUpdateScreenObserverSettings = (patch) => {
    const next = updateScreenObserverState(patch);
    setScreenObserverState(next);
  };

  const handleExportDiagnostics = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      modes: {
        operatorMode,
        localOnlyMode: settings.localOnlyMode,
        zeroCostMode: settings.zeroCostMode,
        approvalMode: settings.approvalMode,
        safeMode: settings.safeMode,
        privacyShieldActive: settings.privacyShieldActive
      },
      runtime: {
        ollamaStatus,
        desktopBridge,
        selectedModel: settings.selectedModel,
        endpoint: settings.endpoint,
        lastCheckedAt: lastCheckedAt ? new Date(lastCheckedAt).toISOString() : null
      },
      counts: {
        verificationLogs: verificationLogs.length,
        memoryItems: memoryItems.length,
        plugins: plugins.length,
        snapshots: snapshots.length
      },
      verificationLogs,
      durableAuditLogs,
      memoryItems,
      plugins,
      diskPluginManifests,
      pluginAudit,
      snapshots,
      workspaceFoundation,
      workspaceProof,
      ocrCapability,
      workspaceSymbolIndex,
      lastPluginToolRun,
      lastManifestValidation,
      lastOcrAdapterRun,
      auditChainProof,
      pluginSandboxPolicy
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `alphonso-diagnostics-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    const log = appendVerificationLog({
      type: 'diagnostics_export',
      source: 'operator-dashboard',
      trust: TRUST_STATES.VERIFIED,
      payload: { bytes: blob.size }
    });
    setVerificationLogs((current) => [...current, log].slice(-250));
  };

  const handleRuntimeRepair = async () => {
    if (!await requestApproval('Run supervised runtime repair checks')) return;
    await runOllamaCheck();
    await verifyProcesses(['ollama']);
    const log = appendVerificationLog({
      type: 'runtime_repair',
      source: 'supervised-repair',
      trust: TRUST_STATES.TEMPORARY,
      payload: { status: 'repair checks completed' }
    });
    setVerificationLogs((current) => [...current, log].slice(-250));
  };

  const handleToggleCoachMode = async () => {
    if (!await requestApproval(`${coachMode ? 'Close' : 'Open'} coach mode window`)) return;
    if (coachMode) {
      await closeCoachWindow();
      setCoachMode(false);
      return;
    }
    await openCoachWindow(coachAlwaysOnTop, settings.coachAgent || 'alphonso');
    setCoachMode(true);
  };

  const handleToggleCoachTop = async () => {
    const next = !coachAlwaysOnTop;
    setCoachAlwaysOnTop(next);
    if (coachMode) {
      await openCoachWindow(next, settings.coachAgent || 'alphonso');
    }
  };

  const minimizeToCoach = async () => {
    if (!await requestApproval('Minimize to coach mode')) return;
    try {
      await openCoachWindow(coachAlwaysOnTop, settings.coachAgent || 'alphonso');
      setCoachMode(true);
      await getCurrentWindow().minimize();
    } catch {
      // Ignore when not in Tauri runtime.
    }
  };

  const openAlphonsoDesktopCard = async () => {
    if (!await requestApproval('Open Alphonso desktop card')) return;
    try {
      await openCoachWindow(coachAlwaysOnTop, 'alphonso');
      setCoachMode(true);
    } catch {
      // Ignore when not in Tauri runtime.
    }
  };

  useEffect(() => {
    let unlistenTrayMenu;
    let unlistenCoachToggle;
    let disposed = false;

    const bindListeners = async () => {
      try {
        unlistenTrayMenu = await listen('alphonso://tray_menu', (event) => {
          const action = String(event.payload || 'unknown');
          const log = appendVerificationLog({
            type: 'tray_menu_event',
            source: 'tauri-tray',
            trust: TRUST_STATES.VERIFIED,
            payload: { action }
          });
          setVerificationLogs((current) => [...current, log].slice(-250));
        });

        await listen('alphonso://new_chat',    () => { if (!disposed) createNewChat(); });
        await listen('alphonso://voice_start', () => { if (!disposed) voice.toggleListening(); });

        unlistenCoachToggle = await listen('alphonso://coach_toggle', async () => {
          if (disposed) return;
          if (coachMode) {
            await closeCoachWindow();
            setCoachMode(false);
            return;
          }
          await openCoachWindow(coachAlwaysOnTop, settings.coachAgent || 'alphonso');
          setCoachMode(true);
        });
      } catch {
        // ignore outside Tauri runtime
      }
    };

    bindListeners();

    return () => {
      disposed = true;
      if (unlistenTrayMenu) unlistenTrayMenu();
      if (unlistenCoachToggle) unlistenCoachToggle();
    };
  }, [coachMode, coachAlwaysOnTop, settings.coachAgent]);

  if (isCoachWindow) {
    const coachAgent = coachAgentFromQuery || settings.coachAgent || 'alphonso';
    const coachState = coachAgent === 'miya'
      ? miyaCompanionState
      : coachAgent === 'jose'
        ? joseCompanionState
        : coachAgent === 'hector'
          ? hectorCompanionState
          : {
            state: companionStateFromVoice(voice.voiceStatus),
            message: coachMessageFromVoice(voice.voiceStatus)
          };
    const cornerClass = {
      'bottom-right': 'items-end justify-end',
      'bottom-left': 'items-end justify-start',
      'top-right': 'items-start justify-end',
      'top-left': 'items-start justify-start'
    }[coachSnapCorner] || 'items-end justify-end';

    return (
      <div data-alphonso-shell-ready="true" className={`h-screen w-screen bg-zinc-950 text-zinc-100 flex p-4 ${coachMiniMode ? cornerClass : 'items-center justify-center'}`}>
        <div className={`${coachMiniMode ? 'w-[22rem] rounded-2xl border border-cyan-300/20 bg-zinc-900/85 p-3' : 'w-full h-full rounded-2xl border border-white/10 bg-zinc-900/70 p-4'}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500 font-bold">Coach Mode</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCoachMiniMode((current) => !current)}
                className="rounded-lg border border-white/10 bg-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-200 hover:bg-zinc-700"
              >
                {coachMiniMode ? 'Full' : 'Mini'}
              </button>
              <button
                onClick={() => setCoachSnapCorner((current) => nextCoachCorner(current))}
                className="rounded-lg border border-white/10 bg-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-200 hover:bg-zinc-700"
              >
                Snap: {coachSnapCorner}
              </button>
            </div>
          </div>

          {coachMiniMode ? (
            <div className="space-y-3">
              <CoachMissionBadge agent={coachAgent} state={coachState.state} message={coachState.message} />
              <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-2">
                <Suspense fallback={null}>
                  <MicrophoneStatus voiceStatus={voice.voiceStatus} />
                </Suspense>
              </div>
            </div>
          ) : (
            <Suspense fallback={<div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3 text-xs text-zinc-400">Loading agent dock...</div>}>
              <AgentDock
                companions={[
                  { agentId: 'alphonso', name: 'Alphonso', state: companionStateFromVoice(voice.voiceStatus), message: coachMessageFromVoice(voice.voiceStatus) },
                  { agentId: 'hector', name: 'Hector', state: hectorCompanionState.state, message: hectorCompanionState.message },
                  { agentId: 'jose', name: 'Jose', state: joseCompanionState.state, message: joseCompanionState.message },
                  { agentId: 'miya', name: 'Miya', state: miyaCompanionState.state, message: miyaCompanionState.message }
                ]}
              />
            </Suspense>
          )}
          {coachMiniMode && (
            <div className="mt-2 text-[10px] text-zinc-500">
              Mini mode is always-on-top friendly and corner-snapped for fast glance monitoring.
            </div>
          )}
          <div className="mt-2 text-[10px] text-zinc-600">
            Desktop coach card is local-only and supervised.
          </div>
        </div>
      </div>
    );
  }

  if (showOnboarding && !isCoachWindow) {
    return (
      <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-zinc-500 text-sm">Loading...</div>}>
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      </Suspense>
    );
  }

  return (
    <div data-alphonso-shell-ready="true" className={`flex h-screen w-full bg-zinc-950 text-zinc-100 font-sans overflow-hidden selection:bg-indigo-500/30 ${themeClassFromSettings(settings)}`}>
      {approvalPending && (
        <Suspense fallback={null}>
          <ApprovalModal
            label={approvalPending}
            onConfirm={() => {
              sendNativeNotification('Alphonso', `Approved: ${approvalPending}`);
              setApprovalPending(null);
              approvalResolveRef.current?.(true);
            }}
            onCancel={() => {
              sendNativeNotification('Alphonso', `Denied: ${approvalPending}`);
              setApprovalPending(null);
              setApprovalRequiredNotice(true);
              approvalResolveRef.current?.(false);
            }}
          />
        </Suspense>
      )}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={switchTab}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((v) => !v)}
        conversations={conversations}
        activeChatId={activeChatId}
        setActiveChatId={setActiveChatId}
        onCreateChat={createNewChat}
        onDeleteChat={deleteChat}
        settings={settings}
      />

      <div className="flex flex-col flex-1 relative min-w-0 border-x border-white/[0.05]">
        <TopBar
          settings={settings}
          ollamaStatus={ollamaStatus}
          selectedModelMissing={selectedModelMissing}
          operatorMode={operatorMode}
          activeTab={activeTab}
          updateAvailable={updateCheckState.available}
          updateVersion={updateCheckState.latestVersion}
          isOnline={isOnline}
          onOpenSettings={() => switchTab('settings')}
        />
        <Suspense fallback={null}>
          <CommandRib
            activeTab={activeTab}
            setActiveTab={switchTab}
            settings={settings}
            setSettings={setSettings}
            ollamaStatus={ollamaStatus}
            operatorMode={operatorMode}
          />
        </Suspense>

        <main className="flex-1 overflow-y-auto relative bg-zinc-950/50">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-[500px] bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute left-4 top-4 z-20">
            <Suspense fallback={<div className="rounded-xl border border-white/10 bg-zinc-950/70 p-3 text-xs text-zinc-400">Loading agent dock...</div>}>
              <AgentDock companions={mergedAgentDockCompanions} />
            </Suspense>
          </div>

          <div className="h-full relative z-10">
            <ViewErrorBoundary label={activeTab} key={activeTab}>
            <Suspense fallback={<ViewLoadingState activeTab={activeTab} />}>
              {activeTab === 'chat' && (
                <ChatView
                  activeChatId={activeChatId}
                  settings={settings}
                  setConversations={setConversations}
                  ollamaStatus={ollamaStatus}
                  installedModels={installedModels}
                  selectedModelMissing={selectedModelMissing}
                  voice={voice}
                  onGenerationChange={setIsGeneratingResponse}
                  onTaskComplete={() => setLastTaskCompletedAt(Date.now())}
                  onRetryOllama={runOllamaCheck}
                  onJoseExecutionState={(state, message) => setJoseCompanionState({ state, message })}
                  onOpenSettings={() => switchTab('settings')}
                  onModelChange={(modelName) => setSettings((current) => ({ ...current, selectedModel: modelName }))}
                />
              )}
              {activeTab === 'miya' && (
                <MiyaStudio
                  settings={settings}
                  ollamaStatus={ollamaStatus}
                  onStudioStateChange={(state, message) => setMiyaCompanionState({ state, message })}
                  onPacketCreated={() => {
                    const log = appendVerificationLog({
                      type: 'miya_handoff_packet_created',
                      source: 'miya-studio',
                      trust: TRUST_STATES.TEMPORARY,
                      payload: {
                        selectedModel: settings.selectedModel || null
                      }
                    });
                    setVerificationLogs((current) => [...current, log].slice(-250));
                  }}
                />
              )}
              {activeTab === 'content' && (
                <ContentCatalystWorkspace
                  settings={settings}
                  onJobChange={(job) => {
                    if (!job) return;
                    const log = appendVerificationLog({
                      type: 'content_catalyst_job_update',
                      source: 'content-catalyst',
                      trust: TRUST_STATES.TEMPORARY,
                      payload: {
                        jobId: job.id,
                        status: job.status,
                        currentStep: job.currentStep
                      }
                    });
                    setVerificationLogs((current) => [...current, log].slice(-250));
                  }}
                  onApprovalRequest={(approval) => {
                    if (!approval) return;
                    const log = appendVerificationLog({
                      type: 'content_catalyst_publish_approval',
                      source: 'content-catalyst',
                      trust: TRUST_STATES.TEMPORARY,
                      payload: approval
                    });
                    setVerificationLogs((current) => [...current, log].slice(-250));
                  }}
                />
              )}
              {activeTab === 'hector' && (
                <HectorResearchDesk
                  onHectorStateChange={(payload) => {
                    if (!payload) return;
                    setHectorCompanionState((current) => ({
                      ...current,
                      ...payload
                    }));
                  }}
                />
              )}
              {activeTab === 'automation' && <AutomationView />}
              {activeTab === 'files' && <FilesView memoryItems={memoryItems} />}
              {activeTab === 'ecosystem' && (
                <EcosystemHub
                  settings={settings}
                  setSettings={setSettings}
                  ollamaStatus={ollamaStatus}
                  verificationLogs={verificationLogs}
                  memoryItems={memoryItems}
                  voiceStatus={voice.voiceStatus}
                  workspaceFoundation={workspaceFoundation}
                  updateCheckState={updateCheckState}
                  nativeSelfDevProof={nativeSelfDevProof}
                  setNativeSelfDevProof={setNativeSelfDevProof}
                  nativeProofHooks={nativeProofHooks}
                />
              )}
              {activeTab === 'project_execution' && <ProjectExecutionMode />}
              {activeTab === 'orchestrator' && (
                <OrchestratorView
                  settings={settings}
                  ollamaStatus={ollamaStatus}
                  onJoseStateChange={(state, message) => setJoseCompanionState({ state, message })}
                />
              )}
              {activeTab === 'operator' && (
                <OperatorDashboard
                  operatorMode={operatorMode}
                  setOperatorMode={setOperatorMode}
                  ollamaStatus={ollamaStatus}
                  lastCheckedAt={lastCheckedAt}
                  verificationLogs={verificationLogs}
                  onVerifyOllama={verifyOllamaWithProof}
                  onVerifyAuditChain={verifyAuditChain}
                  onVerifyProcess={verifyProcesses}
                  onVerifyPaths={verifyPaths}
                  onVerifyCommand={verifyCommand}
                  memoryItems={memoryItems}
                  plugins={plugins}
                  diskPluginManifests={diskPluginManifests}
                  pluginAudit={pluginAudit}
                  onTogglePlugin={handleTogglePlugin}
                  onDiscoverPlugins={handleDiscoverPlugins}
                  workspaceFoundation={workspaceFoundation}
                  onToggleWorkspaceFeature={handleToggleWorkspaceFeature}
                  workspaceProof={workspaceProof}
                  ocrCapability={ocrCapability}
                  onRunWorkspaceProof={handleRunWorkspaceProof}
                  onCheckOcrCapability={handleCheckOcrCapability}
                  workspaceSymbolIndex={workspaceSymbolIndex}
                  onBuildSymbolIndex={handleBuildSymbolIndex}
                  onExecutePluginTool={handleExecutePluginTool}
                  onValidatePluginManifest={handleValidatePluginManifest}
                  lastPluginToolRun={lastPluginToolRun}
                  lastManifestValidation={lastManifestValidation}
                  pluginSandboxPolicy={pluginSandboxPolicy}
                  onUpdatePluginSandboxPolicy={handleUpdatePluginSandboxPolicy}
                  auditChainProof={auditChainProof}
                  onRunOcrAdapter={handleRunOcrAdapter}
                  lastOcrAdapterRun={lastOcrAdapterRun}
                  snapshots={snapshots}
                  onCreateSnapshot={handleCreateSnapshot}
                  onRestoreSnapshot={handleRestoreSnapshot}
                  onBackupMemory={handleBackupMemory}
                  onRunRuntimeRepair={handleRuntimeRepair}
                  onRunReleasePreflight={handleRunReleasePreflight}
                  onExportDiagnostics={handleExportDiagnostics}
                  durableAuditLogs={durableAuditLogs}
                  coachMode={coachMode}
                  coachAlwaysOnTop={coachAlwaysOnTop}
                  onToggleCoachMode={handleToggleCoachMode}
                  onToggleCoachTop={handleToggleCoachTop}
                  screenObserverState={screenObserverState}
                  screenObserverLogs={screenObserverLogs}
                  onRequestScreenObserverPermission={handleRequestScreenObserverPermission}
                  onStartScreenObserver={handleStartScreenObserver}
                  onStopScreenObserver={handleStopScreenObserver}
                  onUpdateScreenObserverSettings={handleUpdateScreenObserverSettings}
                  modes={settings}
                />
              )}
              {activeTab === 'settings' && (
                <Suspense fallback={null}>
                  <SettingsView
                    settings={settings}
                    setSettings={setSettings}
                    ollamaStatus={ollamaStatus}
                    installedModels={installedModels}
                    selectedModelMissing={selectedModelMissing}
                    onCheckOllama={runOllamaCheck}
                    onCopyTroubleshootingCommand={copyTroubleshootingCommand}
                    copyState={copyState}
                    updateCheckState={updateCheckState}
                    onCheckUpdates={() => runUpdateCheck({ manual: true })}
                    normalizeEndpoint={normalizeEndpoint}
                    ollamaTroubleshootingCommand={OLLAMA_TROUBLESHOOTING_COMMAND}
                    braveSearchConfigured={braveSearchConfigured}
                  />
                </Suspense>
              )}
              {activeTab === 'connectors' && (
                <div className="p-6">
                  <React.Suspense fallback={<div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading...</div>}>
                    <ConnectorHealthPanel zeroCostMode={settings.zeroCostMode} />
                  </React.Suspense>
                </div>
              )}
              {activeTab === 'activity' && (
                <Suspense fallback={null}>
                  <AgentActivityLog />
                </Suspense>
              )}
            </Suspense>
            </ViewErrorBoundary>
          </div>
        </main>
      </div>

      <Suspense fallback={null}>
        <RightPanel
          settings={settings}
          ollamaStatus={ollamaStatus}
          installedModels={installedModels}
          desktopBridge={desktopBridge}
          voiceStatus={voice.voiceStatus}
          selectedModelMissing={selectedModelMissing}
          lastCheckedAt={lastCheckedAt}
          onCheckOllama={runOllamaCheck}
          onCopyTroubleshootingCommand={copyTroubleshootingCommand}
          copyState={copyState}
          onMinimizeToCoach={minimizeToCoach}
          operatorMode={operatorMode}
          approvalRequiredNotice={approvalRequiredNotice}
          miyaCompanionState={miyaCompanionState}
          joseCompanionState={joseCompanionState}
          hectorCompanionState={hectorCompanionState}
          screenObserverState={screenObserverState}
          updateCheckState={updateCheckState}
          onCheckUpdates={() => runUpdateCheck({ manual: true })}
        />
      </Suspense>
    </div>
  );
}


import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { requireApproval } from '../../../services/approval/approvalService';
import {
  getAccBridgeConfig,
  getAccBridgeStatus,
  listAccBridgePackets,
  resetAccBridgeConfig,
  refreshAccBridgeStatus,
  syncContentCatalystJob,
  updateAccBridgeConfig
} from '../../../services/agentWorkshop/accBridgeService';
import {
  createContentBridgeRequest,
  createContentBridgeResponse,
  generateContentDraft,
  generateContentImage,
  generateContentNarration,
  generateContentPreview,
  generateContentVideo,
  listContentJobs,
  publishContent,
  publishContentPreview,
  runContentCatalystJob,
  upsertContentJob
} from '../services/contentCatalystService';
import {
  assignDraftSchedule,
  getBrandProfile,
  getContentAnalyticsSnapshot,
  getTrendResearchSuggestions,
  listDraftHistory,
  saveBrandProfile
} from '../state/contentCatalystState';
import { createDefaultContentRequest } from '../types/contentCatalystTypes';
import { AnalyticsDashboard } from '../workspace/AnalyticsDashboard';
import { BrandHeader } from '../workspace/BrandHeader';
import { BrandSettings } from '../workspace/BrandSettings';
import { ContentCalendar } from '../workspace/ContentCalendar';
import { hydrateContentJobsFromSqlite, persistContentJobsToSqlite } from '../services/contentPersistenceService';
import { DraftList } from '../workspace/DraftList';
import { DraftPreview } from '../workspace/DraftPreview';
import { GeneratorForm } from '../workspace/GeneratorForm';
import { TrendResearch } from '../workspace/TrendResearch';

const DEFAULT_FORM = createDefaultContentRequest();

export function ContentCatalystWorkspace({ settings, onJobChange, onApprovalRequest }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [jobs, setJobs] = useState(() => listContentJobs());
  const contentHydratedRef = useRef(false);
  const [brandProfile, setBrandProfile] = useState(() => getBrandProfile());
  const [activeJobId, setActiveJobId] = useState(() => listContentJobs()[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [injectedIdea, setInjectedIdea] = useState('');
  const [bridgeConfig, setBridgeConfig] = useState(() => getAccBridgeConfig());
  const [bridgeStatus, setBridgeStatus] = useState(() => getAccBridgeStatus());
  const [bridgePackets, setBridgePackets] = useState(() => listAccBridgePackets(8));
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeNotice, setBridgeNotice] = useState('');

  useEffect(() => {
    setJobs(listContentJobs());
    if (contentHydratedRef.current) return;
    contentHydratedRef.current = true;
    hydrateContentJobsFromSqlite().then((sqliteJobs) => {
      if (!sqliteJobs || sqliteJobs.length === 0) return;
      // Merge SQLite jobs with any already in localStorage (SQLite wins on conflict)
      const localIds = new Set(listContentJobs().map((j) => j.id));
      const newOnes = sqliteJobs.filter((j) => !localIds.has(j.id));
      if (newOnes.length > 0) setJobs((current) => [...newOnes, ...current]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (jobs.length > 0) persistContentJobsToSqlite(jobs).catch(() => {});
  }, [jobs]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const runtimeStatus = await refreshAccBridgeStatus();
      if (!mounted) return;
      setBridgeConfig(getAccBridgeConfig());
      setBridgeStatus(runtimeStatus);
      setBridgePackets(listAccBridgePackets(8));
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const activeJob = useMemo(() => jobs.find((job) => job.id === activeJobId) || jobs[0] || null, [jobs, activeJobId]);
  const drafts = useMemo(() => listDraftHistory(), [jobs]);
  const analytics = useMemo(() => getContentAnalyticsSnapshot(), [jobs]);
  const trendSuggestions = useMemo(() => getTrendResearchSuggestions(brandProfile, drafts), [brandProfile, drafts]);
  const bridgeResponse = activeJob ? createContentBridgeResponse(activeJob) : null;

  const refresh = (nextActiveId = activeJobId) => {
    const nextJobs = listContentJobs();
    setJobs(nextJobs);
    if (nextActiveId) setActiveJobId(nextActiveId);
    onJobChange?.(nextJobs.find((job) => job.id === nextActiveId) || nextJobs[0] || null);
  };

  const createJob = async () => {
    setBusy(true);
    try {
      const request = createContentBridgeRequest({
        ...form,
        needs: {
          image: form.needs.image,
          video: form.needs.video,
          narration: form.needs.narration,
          publish: form.needs.publish
        }
      });
      const launched = await runContentCatalystJob(request, {
        workspaceRoot: settings.workspaceRoot,
        brandProfile
      });
      setJobs(listContentJobs());
      setActiveJobId(launched.id);
      onJobChange?.(launched);
      return launched;
    } finally {
      setBusy(false);
    }
  };

  const runStep = async (step) => {
    if (!activeJob) return;
    setBusy(true);
    try {
      let next = activeJob;
      if (step === 'draft') next = await generateContentDraft(activeJob);
      if (step === 'image') next = await generateContentImage(activeJob);
      if (step === 'video') next = await generateContentVideo(activeJob);
      if (step === 'narration') next = await generateContentNarration(activeJob);
      if (step === 'preview') next = await generateContentPreview(activeJob);
      if (step === 'publish-preview') next = await publishContentPreview(activeJob);
      if (step === 'publish') next = await publishContent(activeJob, { approved: true });
      if (next?.id) {
        upsertContentJob(next);
        refresh(next.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    const approval = await requireApproval({
      actionType: 'external_posting_uploading',
      summary: activeJob?.request?.idea || 'Content publish request',
      requestedBy: 'jose',
      workflowId: 'content_catalyst_publish'
    });
    onApprovalRequest?.(approval);
    if (!approval.ok) return;
    runStep('publish');
  };

  const handleBrandSave = (nextBrandProfile) => {
    const saved = saveBrandProfile(nextBrandProfile);
    setBrandProfile(saved);
  };

  const refreshBridge = () => {
    (async () => {
      const runtimeStatus = await refreshAccBridgeStatus();
      setBridgeConfig(getAccBridgeConfig());
      setBridgeStatus(runtimeStatus);
      setBridgePackets(listAccBridgePackets(8));
    })();
  };

  const handleBridgeSave = async () => {
    setBridgeBusy(true);
    setBridgeNotice('');
    try {
      updateAccBridgeConfig(bridgeConfig);
      refreshBridge();
      setBridgeNotice('Bridge settings saved.');
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleBridgeReset = async () => {
    setBridgeBusy(true);
    setBridgeNotice('');
    try {
      const next = resetAccBridgeConfig();
      setBridgeConfig(next);
      refreshBridge();
      setBridgeNotice('Bridge settings reset.');
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleBridgeSyncActiveJob = async () => {
    if (!activeJob) return;
    setBridgeBusy(true);
    setBridgeNotice('');
    try {
      const result = await syncContentCatalystJob(activeJob, {
        workspaceRoot: settings.workspaceRoot,
        eventType: 'manual_sync'
      });
      refreshBridge();
      setBridgeNotice(result?.ok ? 'Active job synced to ACC.' : result?.error || 'Bridge sync failed.');
    } finally {
      setBridgeBusy(false);
    }
  };

  const handleAssignDay = async (draftId, dateString) => {
    assignDraftSchedule(draftId, dateString);
    refresh(activeJobId);
  };

  return (
    <div className="space-y-6 p-6">
      <BrandHeader
        brandProfile={brandProfile}
        analytics={analytics}
        onToggleSettings={() => {
          setShowSettings((value) => !value);
          setShowTrends(false);
          setShowAnalytics(false);
        }}
        onToggleTrends={() => {
          setShowTrends((value) => !value);
          setShowSettings(false);
          setShowAnalytics(false);
        }}
        onToggleAnalytics={() => {
          setShowAnalytics((value) => !value);
          setShowSettings(false);
          setShowTrends(false);
        }}
        showSettings={showSettings}
        showTrends={showTrends}
        showAnalytics={showAnalytics}
      />

      {(showSettings || showTrends || showAnalytics) && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {showSettings ? <BrandSettings brandProfile={brandProfile} onSave={handleBrandSave} /> : null}
          {showTrends ? (
            <TrendResearch
              suggestions={trendSuggestions}
              onUseIdea={(idea) => {
                setInjectedIdea(idea);
                setShowTrends(false);
              }}
            />
          ) : null}
          {showAnalytics ? <AnalyticsDashboard analytics={analytics} /> : null}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <GeneratorForm
            form={form}
            setForm={setForm}
            brandProfile={brandProfile}
            injectedIdea={injectedIdea}
            onIdeaUsed={() => {
              setForm((current) => ({ ...current, idea: injectedIdea }));
              setInjectedIdea('');
            }}
            onGenerate={createJob}
            isLoading={busy}
          />

          <ContentCalendar
            drafts={drafts}
            onAssignDay={handleAssignDay}
            onSelectDraft={setActiveJobId}
            onPublish={(draft, type) => {
              const selected = drafts.find((item) => item.id === draft.id);
              if (selected) setActiveJobId(selected.id);
              if (type === 'video' && activeJob?.id === draft.id) runStep('video');
              if (type === 'image' && activeJob?.id === draft.id) runStep('image');
            }}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-[3rem] border border-cyan-400/20 bg-zinc-950/90 p-6 shadow-[0_0_0_1px_rgba(34,211,238,0.06)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                  <CheckCircle2 className="h-3.5 w-3.5 text-cyan-300" />
                  ACC Bridge
                </div>
                <div className="text-sm text-zinc-300">
                  Status: <span className="font-semibold text-cyan-200">{bridgeStatus.status}</span>
                  {' '}
                  {bridgeStatus.configured ? 'connected' : 'not configured yet'}
                </div>
              </div>
              <button
                type="button"
                onClick={refreshBridge}
                className="rounded-full border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition hover:border-cyan-400/40 hover:text-white"
              >
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Bridge URL</span>
                <input
                  value={bridgeConfig.baseUrl || ''}
                  onChange={(event) => setBridgeConfig((current) => ({ ...current, baseUrl: event.target.value }))}
                  placeholder="http://localhost:4000"
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Path Prefix</span>
                <input
                  value={bridgeConfig.pathPrefix || ''}
                  onChange={(event) => setBridgeConfig((current) => ({ ...current, pathPrefix: event.target.value }))}
                  placeholder="/api/alphonso-bridge"
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Token</span>
                <input
                  type="password"
                  value={bridgeConfig.token || ''}
                  onChange={(event) => setBridgeConfig((current) => ({ ...current, token: event.target.value }))}
                  placeholder="bridge token"
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Timeout ms</span>
                <input
                  type="number"
                  min="1000"
                  step="500"
                  value={bridgeConfig.timeoutMs || 15000}
                  onChange={(event) => setBridgeConfig((current) => ({ ...current, timeoutMs: Number(event.target.value) || 15000 }))}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/40"
                />
              </label>
            </div>

            <label className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={Boolean(bridgeConfig.enabled)}
                onChange={(event) => setBridgeConfig((current) => ({ ...current, enabled: event.target.checked }))}
                className="h-4 w-4 rounded border-white/20 bg-zinc-950 text-cyan-400"
              />
              Enable live ACC sync from Alphonso
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bridgeBusy}
                onClick={handleBridgeSave}
                className="rounded-full bg-cyan-400 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save Bridge
              </button>
              <button
                type="button"
                disabled={bridgeBusy}
                onClick={handleBridgeReset}
                className="rounded-full border border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-200 transition hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                disabled={bridgeBusy || !activeJob}
                onClick={handleBridgeSyncActiveJob}
                className="rounded-full border border-cyan-400/30 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200 transition hover:border-cyan-300 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sync Active Job to ACC
              </button>
            </div>

            {bridgeNotice ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-300">
                {bridgeNotice}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-zinc-300">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Packets</div>
                <div className="mt-1 text-lg font-semibold text-white">{bridgeStatus.packetCount || 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Last Sync</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {bridgeStatus.lastSyncStatus || 'none'}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Recent bridge packets</div>
              <div className="max-h-48 space-y-2 overflow-auto pr-1">
                {bridgePackets.length ? bridgePackets.map((packet) => (
                  <div key={packet.id} className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-zinc-300">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-white">{packet.kind}</span>
                      <span className="text-zinc-500">{packet.status}</span>
                    </div>
                    <div className="mt-1 text-zinc-400">{packet.jobId || packet.requestId || packet.id}</div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-3 text-xs text-zinc-500">
                    No bridge packets yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-[3rem] border border-primary/20 bg-zinc-950/90 p-6">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              <CheckCircle2 className="h-3.5 w-3.5 text-cyan-300" />
              Bridge Response
            </div>
            {bridgeResponse ? (
              <pre className="max-h-[30rem] overflow-auto rounded-2xl border border-white/10 bg-zinc-950/90 p-3 text-[11px] leading-relaxed text-zinc-200">
                {JSON.stringify(bridgeResponse, null, 2)}
              </pre>
            ) : (
              <div className="text-sm text-zinc-500">Create a job to see the bridge contract response.</div>
            )}
          </div>

          <DraftPreview activeJob={activeJob} busy={busy} onRunStep={runStep} onApprovePublish={handlePublish} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <DraftList drafts={drafts} onSelect={setActiveJobId} />
        <div className="rounded-[3rem] border border-primary/20 bg-zinc-950/90 p-6">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
            <ArrowRight className="h-3.5 w-3.5 text-cyan-300" />
            Job detail
          </div>
          {activeJob ? (
            <pre className="max-h-[30rem] overflow-auto rounded-2xl border border-white/10 bg-zinc-950/90 p-3 text-[11px] leading-relaxed text-zinc-200">
              {JSON.stringify(activeJob, null, 2)}
            </pre>
          ) : (
            <div className="text-sm text-zinc-500">Select a draft to inspect the full job payload.</div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { Cloud, Compass, Download, RadioTower, ShieldCheck } from 'lucide-react';
import { HECTOR_PROFILE } from '../../agents/hector/hectorProfile';
import { HECTOR_ALLOWED_ACTIONS, HECTOR_BLOCKED_ACTIONS } from '../../agents/hector/hectorPermissions';
import { HECTOR_SOURCE_TYPES } from '../../agents/hector/hectorResearchSchema';
import {
  createHectorApprovalPacket,
  createResearchDraft,
  fetchSuppliedSourcesForReport,
  listHectorActivity,
  listHectorReports
} from '../../services/hectorResearchService';
import { SourceBoard } from '../hector/SourceBoard';
import { CitationPanel } from '../hector/CitationPanel';
import { ResearchReportPanel } from '../hector/ResearchReportPanel';
import { HectorActivityLog } from '../hector/HectorActivityLog';
import { HectorApprovalHandoff } from '../hector/HectorApprovalHandoff';

export function HectorResearchDesk({ onHectorStateChange }) {
  const [question, setQuestion] = useState('Find the latest official Tauri v2 setup docs');
  const [sourceType, setSourceType] = useState('official_docs');
  const [sourceUrls, setSourceUrls] = useState('');
  const [reports, setReports] = useState(() => listHectorReports());
  const [activity, setActivity] = useState(() => listHectorActivity());
  const [selectedId, setSelectedId] = useState(() => listHectorReports()[0]?.id || '');
  const [fetchError, setFetchError] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedId) || reports[0] || null,
    [reports, selectedId]
  );

  const patchReportInState = (reportPatch) => {
    if (!reportPatch?.id) return;
    setReports((current) => {
      const hasExisting = current.some((row) => row.id === reportPatch.id);
      if (!hasExisting) return [...current, reportPatch];
      return current.map((row) => (row.id === reportPatch.id ? reportPatch : row));
    });
  };

  const syncHectorCompanion = (report, status = 'idle') => {
    if (!onHectorStateChange) return;
    const state = status === 'running'
      ? 'researching'
      : status === 'error'
        ? 'warning'
        : status === 'complete'
          ? 'task_complete'
          : 'idle';
    const message = status === 'running'
      ? (report?.currentSourceUrl ? `Scanning ${report.currentSourceUrl}` : 'Running live research...')
      : status === 'error'
        ? (report?.lastRunSummary || report?.summary || 'Research run failed.')
        : status === 'complete'
          ? (report?.lastRunSummary || 'Research run complete.')
          : 'Hector is standing by.';

    onHectorStateChange({
      state,
      message,
      currentSourceUrl: report?.currentSourceUrl || null,
      lastRunSummary: report?.lastRunSummary || report?.summary || ''
    });
  };

  const exportReport = () => {
    if (!selectedReport) return;
    const r = selectedReport;
    const sources = Array.isArray(r.sources) ? r.sources : [];
    const lines = [
      `# Hector Research Report`,
      ``,
      `**Question:** ${r.researchQuestion || 'Untitled'}`,
      `**Status:** ${r.status || 'unknown'} | **Confidence:** ${r.confidenceLevel || 'unknown'}`,
      `**Exported:** ${new Date().toISOString()}`,
      ``,
      `## Summary`,
      ``,
      r.lastRunSummary || r.summary || '_No summary yet._',
      ``,
      `## Sources (${sources.length})`,
      ``,
      ...sources.map((s, i) => [
        `### ${i + 1}. ${s.title || s.url || 'Untitled'}`,
        s.url ? `**URL:** ${s.url}` : '',
        s.summary ? `\n${s.summary}` : '',
        s.publishedAt ? `\n_Published: ${s.publishedAt}_` : '',
        ``
      ].filter(Boolean).join('\n')),
      r.runLog?.length ? `## Run Log\n\n${r.runLog.map((e) => `- ${e}`).join('\n')}` : ''
    ].filter((l) => l !== undefined).join('\n');

    const blob = new Blob([lines], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hector-report-${(r.researchQuestion || 'report').slice(0, 40).replace(/[^a-z0-9]/gi, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const refresh = () => {
    const nextReports = listHectorReports();
    setReports(nextReports);
    setActivity(listHectorActivity());
    if (!selectedId && nextReports[0]) setSelectedId(nextReports[0].id);
  };

  const createDraft = () => {
    const report = createResearchDraft({
      researchQuestion: question,
      sourceType,
      sourceUrls: sourceUrls.split(/\r?\n/),
      riskLevel: 'medium'
    });
    setSelectedId(report.id);
    refresh();
    syncHectorCompanion(report, 'idle');
  };

  const createHandoff = (reportId) => {
    createHectorApprovalPacket(reportId);
    refresh();
  };

  const fetchSources = async () => {
    if (!selectedReport?.id || isFetching) return;
    setFetchError('');
    setIsFetching(true);
    syncHectorCompanion(selectedReport, 'running');
    try {
      const updated = await fetchSuppliedSourcesForReport(selectedReport.id, (liveReport) => {
        patchReportInState(liveReport);
        syncHectorCompanion(liveReport, 'running');
      });
      if (updated?.id) setSelectedId(updated.id);
      patchReportInState(updated);
      refresh();
      syncHectorCompanion(updated, updated?.runState === 'failed' ? 'error' : 'complete');
    } catch (error) {
      setFetchError(String(error));
      syncHectorCompanion(selectedReport, 'error');
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-8 py-8">
      <header className="rounded-2xl border border-teal-300/20 bg-gradient-to-br from-zinc-950 via-teal-950/25 to-zinc-950 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-teal-200/75">
              <Compass className="h-4 w-4" />
              Hector Research Desk
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">Cloud Scout, source board, and Jose handoff</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
              Hector is the online research boundary. It can discover public sources from live web search, fetch them, and attach proof-backed citations.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:min-w-[28rem]">
            <StatusTile icon={Cloud} label="Research Backend" value="Live discovery + fetch proof" tone="teal" />
            <StatusTile icon={ShieldCheck} label="Execution Permission" value="Blocked" tone="green" />
            <StatusTile icon={RadioTower} label="Source Reports" value={reports.length} tone="teal" />
            <StatusTile icon={Compass} label="Jose Handoff" value="Approval gated" tone="teal" />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-teal-300/15 bg-zinc-950/72 p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200/75">Research Draft Builder</div>
          <div className="space-y-3">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value)} className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
              {HECTOR_SOURCE_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
            </select>
            <textarea
              value={sourceUrls}
              onChange={(event) => setSourceUrls(event.target.value)}
              rows={4}
              className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
              placeholder="Source URLs, one per line. Hector will not invent URLs or citations."
            />
            <button onClick={createDraft} className="rounded-xl bg-teal-300 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-950 hover:bg-teal-200">Create Research Draft</button>
            <div className="rounded-xl border border-teal-300/15 bg-teal-500/10 p-3 text-[11px] text-teal-100/75">
              Leave URLs blank to let Hector discover sources first, or provide explicit URLs to constrain the run.
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-teal-300/15 bg-zinc-950/72 p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200/75">Hector Permissions</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <PermissionList title="Allowed" rows={HECTOR_ALLOWED_ACTIONS} tone="green" />
            <PermissionList title="Blocked" rows={HECTOR_BLOCKED_ACTIONS} tone="red" />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-teal-300/15 bg-zinc-950/72 p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200/75">Report Index</div>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {reports.length === 0 && <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 text-sm text-zinc-500">No research reports yet.</div>}
            {reports.slice().reverse().map((report) => (
              <button key={report.id} onClick={() => setSelectedId(report.id)} className={`w-full rounded-xl border p-3 text-left ${selectedReport?.id === report.id ? 'border-teal-300/30 bg-teal-500/15' : 'border-white/10 bg-zinc-900/55'}`}>
                <div className="text-sm font-semibold text-zinc-100">{report.researchQuestion}</div>
                <div className="mt-1 text-[11px] text-zinc-500">{report.status} | {report.confidenceLevel}</div>
              </button>
            ))}
          </div>
        </section>
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={fetchSources}
              disabled={!selectedReport?.id || isFetching}
              className="flex-1 rounded-xl border border-teal-300/20 bg-teal-400/15 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-teal-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-zinc-900/60 disabled:text-zinc-600"
            >
              {isFetching ? 'Running Live Research...' : 'Run Live Research'}
            </button>
            <button
              onClick={exportReport}
              disabled={!selectedReport}
              title="Export report as Markdown"
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              .md
            </button>
          </div>
          {fetchError && <div className="rounded-xl border border-red-300/15 bg-red-500/10 p-3 text-[11px] text-red-100">{fetchError}</div>}
          <SourceBoard report={selectedReport} />
        </div>
        <CitationPanel report={selectedReport} />
      </div>

      <section className="rounded-2xl border border-teal-300/15 bg-zinc-950/72 p-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200/75">Live Research Run</div>
        {!selectedReport ? (
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-4 text-sm text-zinc-500">
            Select a report to view live source-run telemetry.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              <InfoCell label="Run State" value={selectedReport.runState || 'idle'} />
              <InfoCell label="Current URL" value={selectedReport.currentSourceUrl || 'none'} mono />
              <InfoCell label="Last Summary" value={selectedReport.lastRunSummary || 'no run summary yet'} />
            </div>
            <div className="rounded-xl border border-white/10 bg-zinc-900/55 p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Run Log</div>
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {!selectedReport.runLog?.length && (
                  <div className="rounded-lg border border-white/10 bg-zinc-900/45 px-3 py-2 text-[11px] text-zinc-500">
                    No run logs yet. Start "Run Live Research" to stream website-level actions.
                  </div>
                )}
                {selectedReport.runLog?.slice().reverse().map((entry, index) => (
                  <div key={`${entry.timestampMs || 'n'}-${index}`} className="rounded-lg border border-white/10 bg-zinc-900/45 px-3 py-2 text-[11px]">
                    <div className="font-semibold text-zinc-200">{entry.message}</div>
                    <div className="mt-0.5 text-zinc-500">
                      {(entry.level || 'info').toUpperCase()} | {entry.timestampMs ? new Date(entry.timestampMs).toLocaleTimeString() : 'time n/a'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <ResearchReportPanel report={selectedReport} />
        <div className="space-y-4">
          <HectorApprovalHandoff report={selectedReport} onCreateHandoff={createHandoff} />
          <HectorActivityLog rows={activity} />
        </div>
      </div>

      <div className="rounded-xl border border-teal-300/15 bg-teal-500/10 p-4 text-[11px] text-teal-100/75">
        {HECTOR_PROFILE.name}: {HECTOR_PROFILE.allowedSummary} {HECTOR_PROFILE.blockedSummary}
      </div>
    </div>
  );
}

function InfoCell({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/55 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`mt-1 text-xs text-zinc-200 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

function StatusTile({ icon: Icon, label, value, tone }) {
  const cls = tone === 'amber'
    ? 'border-amber-300/15 bg-amber-500/10 text-amber-100'
    : tone === 'green'
      ? 'border-emerald-300/15 bg-emerald-500/10 text-emerald-100'
      : 'border-teal-300/15 bg-teal-500/10 text-teal-100';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-70">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-bold">{value}</div>
    </div>
  );
}

function PermissionList({ title, rows, tone }) {
  const cls = tone === 'green' ? 'text-emerald-200' : 'text-red-200';
  return (
    <div>
      <div className={`text-[10px] font-bold uppercase tracking-widest ${cls}`}>{title}</div>
      <div className="mt-2 space-y-1">
        {rows.map((row) => (
          <div key={row} className="rounded-lg border border-white/10 bg-zinc-900/50 px-3 py-2 text-[11px] text-zinc-300">{row.replace(/_/g, ' ')}</div>
        ))}
      </div>
    </div>
  );
}

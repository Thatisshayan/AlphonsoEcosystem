import { invoke } from '@tauri-apps/api/core';
import { HECTOR_RESEARCH_SCHEMA } from '../agents/hector/hectorResearchSchema';
import { HECTOR_ALLOWED_ACTIONS, HECTOR_BLOCKED_ACTIONS } from '../agents/hector/hectorPermissions';
import { createAgentPacket, AGENTS } from './agentBusService';
import { pushMemoryItem } from './memoryService';
import { appendSessionEvent } from './sessionIntelligenceService';
import { TRUST_STATES, timestampMs } from './trustModel';
import { scoreSourceConfidence, sourceExpiryForType } from './sourceConfidenceService';

const REPORT_KEY = 'alphonso_hector_reports_v1';
const ACTIVITY_KEY = 'alphonso_hector_activity_v1';

function readRows(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRows(key, rows, limit = 500) {
  localStorage.setItem(key, JSON.stringify(rows.slice(-limit)));
}

function updateReport(reportId, patch) {
  const rows = readRows(REPORT_KEY);
  const nextRows = rows.map((report) => (report.id === reportId ? { ...report, ...patch } : report));
  writeRows(REPORT_KEY, nextRows);
  return nextRows.find((report) => report.id === reportId) || null;
}

function appendRunLog(report, entry) {
  const current = Array.isArray(report.runLog) ? report.runLog : [];
  return [...current, { ...entry, timestampMs: timestampMs() }].slice(-120);
}

function normalizeSourceUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function mergeSources(existing = [], discovered = []) {
  const byUrl = new Map();
  [...existing, ...discovered].forEach((source) => {
    const key = normalizeSourceUrl(source.url);
    if (!key) return;
    const previous = byUrl.get(key);
    byUrl.set(key, previous ? {
      ...previous,
      ...source,
      confidence: source.confidence || previous.confidence,
      confidenceReason: source.confidenceReason || previous.confidenceReason,
      expiresAt: source.expiresAt || previous.expiresAt
    } : source);
  });
  return [...byUrl.values()];
}

async function discoverResearchSources({
  researchQuestion,
  sourceType,
  limit = 8,
  providerLabel = 'duckduckgo_html',
  queryLabel = null
}) {
  const results = await invoke('search_research_sources', {
    request: {
      query: queryLabel || researchQuestion,
      sourceType,
      limit
    }
  });

  if (!Array.isArray(results)) return [];
  return results
    .map((row) => {
      const url = String(row.url || '').trim();
      if (!url) return null;
      const source = {
        url,
        type: row.sourceType || sourceType || 'official_docs',
        official: row.sourceType === 'official_docs' || /docs|developer|github|tauri|ollama/i.test(url),
        title: row.title || null,
        snippet: row.snippet || null
      };
      const score = scoreSourceConfidence(source);
      return {
        ...source,
        confidence: row.confidence || score.confidence,
        confidenceReason: row.verificationState
          ? `Search provider state: ${row.verificationState}.`
          : score.reason,
        verificationState: row.verificationState || TRUST_STATES.INFERRED,
        riskLevel: row.riskLevel || 'medium',
        expiresAt: sourceExpiryForType(source.type),
        dateChecked: row.dateChecked || new Date().toISOString(),
        provider: row.provider || providerLabel
      };
    })
    .filter(Boolean);
}

function extractJsonArray(text) {
  const clean = String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  if (!clean) return [];
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return clean
      .split(/\r?\n|;/)
      .map((item) => item.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);
  }
}

async function chooseHectorOllamaModel() {
  try {
    const proof = await invoke('ollama_list_models', { endpoint: null });
    const model = Array.isArray(proof?.models) && proof.models.length > 0
      ? proof.models[0]?.name || null
      : null;
    return {
      ok: Boolean(model),
      model,
      proof
    };
  } catch (error) {
    return {
      ok: false,
      model: null,
      proof: {
        error: String(error)
      }
    };
  }
}

async function buildResearchQueryRefinements(researchQuestion, sourceType, existingSources = []) {
  const modelChoice = await chooseHectorOllamaModel();
  if (!modelChoice.ok || !modelChoice.model) {
    return {
      ok: false,
      model: null,
      queries: [],
      error: modelChoice.proof?.error || 'No Ollama model available.'
    };
  }

  const prompt = [
    'You are Hector, a research assistant that produces concise web search refinements.',
    `Question: ${researchQuestion}`,
    `Preferred source type: ${sourceType}`,
    existingSources.length
      ? `Already seen sources: ${existingSources.map((source) => source.url).join(' | ')}`
      : 'Already seen sources: none',
    'Return JSON array only. Generate up to 3 short search queries that are more specific and more likely to find official or authoritative sources.'
  ].join('\n');

  const proof = await invoke('ollama_generate', {
    endpoint: null,
    model: modelChoice.model,
    prompt
  }).catch((error) => ({
    endpoint: 'http://localhost:11434',
    httpStatus: null,
    model: modelChoice.model,
    response: '',
    done: false,
    trust: 'failed',
    error: String(error)
  }));

  const queries = extractJsonArray(proof?.response)
    .map((query) => query.trim())
    .filter(Boolean)
    .filter((query, index, array) => array.indexOf(query) === index)
    .slice(0, 3);

  return {
    ok: queries.length > 0,
    model: modelChoice.model,
    proof,
    queries
  };
}

async function synthesizeHectorFallbackReport(researchQuestion, sourceType, providerChain, refinements = []) {
  const modelChoice = await chooseHectorOllamaModel();
  if (!modelChoice.ok || !modelChoice.model) {
    return {
      ok: false,
      provider: 'ollama_synthesis',
      summary: 'Live source discovery failed and no Ollama model was available for a synthesis fallback.',
      inferredPoints: [],
      recommendedNextStep: 'Retry source discovery or supply URLs manually.',
      providerChain,
      refinements,
      model: null,
      trust: TRUST_STATES.FAILED,
      error: modelChoice.proof?.error || 'No Ollama model available.'
    };
  }

  const prompt = [
    'You are Hector. The live web search provider failed or returned no verified sources.',
    `Research question: ${researchQuestion}`,
    `Source type target: ${sourceType}`,
    refinements.length ? `Tried query refinements: ${refinements.join(' | ')}` : 'Tried query refinements: none',
    `Provider chain: ${providerChain.join(' -> ')}`,
    'Return JSON object only with keys summary, inferredPoints, and recommendedNextStep.',
    'Keep the summary cautious and honest. Do not claim verification without sources.',
    'inferredPoints must be an array of short strings.'
  ].join('\n');

  const proof = await invoke('ollama_generate', {
    endpoint: null,
    model: modelChoice.model,
    prompt
  }).catch((error) => ({
    endpoint: 'http://localhost:11434',
    httpStatus: null,
    model: modelChoice.model,
    response: '',
    done: false,
    trust: 'failed',
    error: String(error)
  }));

  const clean = String(proof?.response || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  let parsed = null;
  try {
    parsed = clean ? JSON.parse(clean) : null;
  } catch {
    parsed = null;
  }

  return {
    ok: Boolean(parsed || clean),
    provider: 'ollama_synthesis',
    summary: parsed?.summary || clean || 'Hector synthesized a cautious fallback summary from local Ollama.',
    inferredPoints: Array.isArray(parsed?.inferredPoints)
      ? parsed.inferredPoints
      : clean
        ? [clean.slice(0, 220)]
        : [],
    recommendedNextStep: parsed?.recommendedNextStep || 'Review the fallback summary, then retry discovery with more specific terms or supply URLs.',
    providerChain,
    refinements,
    model: modelChoice.model,
    proof,
    trust: proof?.trust || TRUST_STATES.TEMPORARY
  };
}

export async function isBraveSearchConfigured() {
  try {
    const presence = await invoke('check_env_vars_presence', { names: ['BRAVE_SEARCH_API_KEY'] });
    return Boolean(presence?.['BRAVE_SEARCH_API_KEY']);
  } catch {
    return false;
  }
}

/**
 * Frontend-only Brave Search — uses VITE_BRAVE_SEARCH_API_KEY from the Vite env.
 * Returns a structured result the UI can display directly, or an error object.
 * Use this when the Rust backend path is unavailable or for direct UI calls.
 */
export async function searchBrave(query, count = 10) {
  const apiKey = import.meta.env.VITE_BRAVE_SEARCH_API_KEY || '';
  if (!apiKey) {
    return { success: false, error: 'BRAVE_SEARCH_API_KEY not configured', results: [] };
  }
  try {
    const resp = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey
        }
      }
    );
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return {
        success: false,
        error: `Brave Search HTTP ${resp.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`,
        httpStatus: resp.status,
        results: []
      };
    }
    const data = await resp.json();
    const results = (data.web?.results || []).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
      source: 'brave'
    }));
    return { success: true, results };
  } catch (error) {
    return { success: false, error: `Brave Search fetch failed: ${String(error)}`, results: [] };
  }
}

async function discoverResearchSourcesBrave({ researchQuestion, sourceType, limit = 8 }) {
  // Try the Rust backend path first (uses server-side BRAVE_SEARCH_API_KEY)
  let results = null;
  try {
    results = await invoke('search_brave_sources', {
      query: researchQuestion,
      limit,
      sourceType
    });
  } catch {
    // Rust path failed — fall through to frontend path below
  }

  // If the Rust path returned nothing or failed, try the frontend VITE_ key path
  if (!Array.isArray(results) || results.length === 0) {
    const frontendResult = await searchBrave(researchQuestion, limit);
    if (frontendResult.success && frontendResult.results.length > 0) {
      return frontendResult.results.map((r) => {
        const source = {
          url: r.url,
          type: sourceType || 'official_docs',
          official: /docs|developer|github|tauri|ollama/i.test(r.url),
          title: r.title || null,
          snippet: r.snippet || null
        };
        const score = scoreSourceConfidence(source);
        return {
          ...source,
          confidence: score.confidence,
          confidenceReason: score.reason,
          verificationState: TRUST_STATES.INFERRED,
          riskLevel: 'medium',
          expiresAt: sourceExpiryForType(source.type),
          dateChecked: new Date().toISOString(),
          provider: 'brave_search_frontend'
        };
      });
    }
    return [];
  }

  return results
    .map((row) => {
      const url = String(row.url || '').trim();
      if (!url) return null;
      const source = {
        url,
        type: row.sourceType || sourceType || 'official_docs',
        official: /docs|developer|github|tauri|ollama/i.test(url),
        title: row.title || null,
        snippet: row.snippet || null
      };
      const score = scoreSourceConfidence(source);
      return {
        ...source,
        confidence: row.confidence || score.confidence,
        confidenceReason: score.reason,
        verificationState: TRUST_STATES.INFERRED,
        riskLevel: row.riskLevel || 'medium',
        expiresAt: sourceExpiryForType(source.type),
        dateChecked: row.dateChecked || new Date().toISOString(),
        provider: 'brave_search'
      };
    })
    .filter(Boolean);
}

async function discoverResearchSourcesWithFailover({
  researchQuestion,
  sourceType,
  limit = 8
}) {
  const primaryQuery = researchQuestion;

  // Try Brave Search first (if API key is configured)
  try {
    const braveSources = await discoverResearchSourcesBrave({ researchQuestion, sourceType, limit });
    if (braveSources.length) {
      return {
        ok: true,
        sources: braveSources,
        provider: 'brave_search',
        providerChain: ['brave_search'],
        queryUsed: primaryQuery,
        refinements: [],
        synthesis: null
      };
    }
  } catch { /* key not set or API error — fall through to DDG */ }

  const providerChain = ['duckduckgo_html'];

  try {
    const primarySources = await discoverResearchSources({
      researchQuestion,
      sourceType,
      limit,
      providerLabel: 'duckduckgo_html',
      queryLabel: primaryQuery
    });
    if (primarySources.length) {
      return {
        ok: true,
        sources: primarySources,
        provider: 'duckduckgo_html',
        providerChain,
        queryUsed: primaryQuery,
        refinements: [],
        synthesis: null
      };
    }
  } catch (error) {
    providerChain.push('duckduckgo_html_error');
    return await continueWithRefinements({
      researchQuestion,
      sourceType,
      limit,
      providerChain,
      primaryQuery,
      primaryError: String(error)
    });
  }

  return continueWithRefinements({
    researchQuestion,
    sourceType,
    limit,
    providerChain,
    primaryQuery
  });
}

async function continueWithRefinements({
  researchQuestion,
  sourceType,
  limit,
  providerChain,
  primaryQuery,
  primaryError = null
}) {
  const refinementsProof = await buildResearchQueryRefinements(researchQuestion, sourceType, []);
  const refinements = refinementsProof.queries || [];
  if (refinementsProof.ok && refinements.length) {
    providerChain.push('ollama_query_refinement');
    for (const refinedQuery of refinements) {
      try {
        const refinedSources = await discoverResearchSources({
          researchQuestion,
          sourceType,
          limit,
          providerLabel: 'duckduckgo_html_refined',
          queryLabel: refinedQuery
        });
        if (refinedSources.length) {
          return {
            ok: true,
            sources: refinedSources,
            provider: 'duckduckgo_html_refined',
            providerChain: [...providerChain, 'duckduckgo_html_refined'],
            queryUsed: refinedQuery,
            refinements,
            synthesis: null,
            primaryError
          };
        }
      } catch {
        // Try the next refinement.
      }
    }
  }

  providerChain.push('ollama_synthesis');
  const synthesis = await synthesizeHectorFallbackReport(
    researchQuestion,
    sourceType,
    providerChain,
    refinements
  );

  return {
    ok: Boolean(synthesis.ok),
    sources: [],
    provider: synthesis.provider,
    providerChain,
    queryUsed: primaryQuery,
    refinements,
    synthesis,
    primaryError
  };
}

export function listHectorReports() {
  return readRows(REPORT_KEY);
}

export function listHectorActivity() {
  return readRows(ACTIVITY_KEY);
}

export function recordHectorActivity(type, details = {}) {
  const rows = readRows(ACTIVITY_KEY);
  const activity = {
    id: `hector-activity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    details,
    timestampMs: timestampMs(),
    confidence: TRUST_STATES.TEMPORARY
  };
  rows.push(activity);
  writeRows(ACTIVITY_KEY, rows);
  return activity;
}

export function createResearchDraft({
  researchQuestion,
  sourceUrls = [],
  sourceType = 'official_docs',
  riskLevel = 'medium'
}) {
  const sources = sourceUrls
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => {
      const source = { url, type: sourceType, official: sourceType === 'official_docs' };
      const score = scoreSourceConfidence(source);
      return {
        ...source,
        confidence: score.confidence,
        confidenceReason: score.reason,
        expiresAt: sourceExpiryForType(sourceType)
      };
    });

  const report = {
    ...HECTOR_RESEARCH_SCHEMA,
    id: `hector-report-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    researchQuestion: researchQuestion || 'Untitled research question',
    summary: 'Draft created. Hector can discover public sources, fetch them, and attach proof-backed citations.',
    sources,
    urls: sources.map((source) => source.url),
    dateChecked: new Date().toISOString(),
    confidenceLevel: sources.length ? TRUST_STATES.INFERRED : TRUST_STATES.UNVERIFIED,
    riskLevel,
    verifiedFacts: [],
    inferredPoints: sources.length ? ['Source URLs were recorded. Fetch the sources to verify availability and extract snippets.'] : [],
    joseApprovalNeeded: ['Jose approval required before external account access, posting, uploads, purchases, or file/system actions.'],
    recommendedNextStep: sources.length ? 'Fetch supplied sources, then send the report to Jose for review.' : 'Run source discovery or add public URLs, then fetch and verify.',
    status: sources.length ? 'sources_recorded_fetch_available' : 'awaiting_source_discovery',
    allowedActions: HECTOR_ALLOWED_ACTIONS,
    blockedActions: HECTOR_BLOCKED_ACTIONS,
    createdAtMs: timestampMs()
  };

  const rows = readRows(REPORT_KEY);
  rows.push(report);
  writeRows(REPORT_KEY, rows);
  pushMemoryItem({
    title: `Hector research draft: ${report.researchQuestion}`,
    category: 'research_memory',
    content: {
      reportId: report.id,
      researchQuestion: report.researchQuestion,
      sourceCount: sources.length,
      status: report.status
    },
    source: 'hector-research-desk',
    sourceAgent: AGENTS.HECTOR,
    confidence: report.confidenceLevel,
    verificationState: TRUST_STATES.UNVERIFIED,
    expiresAt: sources[0]?.expiresAt || null,
    expiryRule: sourceType
  });
  recordHectorActivity('research_draft_created', { id: report.id, sourceCount: sources.length });
  appendSessionEvent({
    category: 'research',
    title: 'Hector research draft created',
    details: { id: report.id, sourceCount: sources.length },
    agent: AGENTS.HECTOR,
    confidence: TRUST_STATES.TEMPORARY,
    verificationState: TRUST_STATES.UNVERIFIED
  });
  return report;
}

export async function fetchSuppliedSourcesForReport(reportId, onProgress) {
  return runHectorLiveResearch(reportId, onProgress);
}

export async function runHectorLiveResearch(reportId, onProgress) {
  const report = listHectorReports().find((item) => item.id === reportId);
  if (!report) {
    throw new Error('Hector report not found.');
  }
  let workingReport = report;
  if (!Array.isArray(workingReport.sources) || workingReport.sources.length === 0) {
    const discoveryStart = updateReport(reportId, {
      status: 'source_discovery_running',
      runState: 'running',
      currentSourceUrl: null,
      runLog: appendRunLog(workingReport, {
        level: 'info',
        message: `Discovering live sources for: ${workingReport.researchQuestion}`
      }),
      summary: 'Hector is discovering public sources from the live web...'
    });
    onProgress?.(discoveryStart);
    try {
      const discovery = await discoverResearchSourcesWithFailover({
        researchQuestion: workingReport.researchQuestion,
        sourceType: workingReport.sources?.[0]?.type || 'official_docs',
        limit: 8
      });
      if (!discovery.sources.length) {
        const failedState = discovery.synthesis?.ok
          ? 'source_discovery_synthesized'
          : 'source_discovery_empty';
        const nextSummary = discovery.synthesis?.summary || 'No public sources were discovered for this query.';
        const nextStep = discovery.synthesis?.recommendedNextStep || 'Refine the research question or supply URLs manually, then retry.';
        const noDiscovery = updateReport(reportId, {
          status: failedState,
          runState: discovery.synthesis?.ok ? 'partial' : 'failed',
          currentSourceUrl: null,
          confidenceLevel: discovery.synthesis?.ok ? TRUST_STATES.INFERRED : TRUST_STATES.UNVERIFIED,
          summary: nextSummary,
          inferredPoints: discovery.synthesis?.inferredPoints || [],
          providerUsed: discovery.provider,
          providerChain: discovery.providerChain,
          queryUsed: discovery.queryUsed,
          refinements: discovery.refinements,
          synthesis: discovery.synthesis || null,
          runLog: appendRunLog(discoveryStart || workingReport, {
            level: discovery.synthesis?.ok ? 'warning' : 'warning',
            message: discovery.synthesis?.ok
              ? `No verified sources found. Ollama synthesis fallback used via ${discovery.providerChain.join(' -> ')}.`
              : `Live source discovery returned no results via ${discovery.providerChain.join(' -> ')}.`
          }),
          recommendedNextStep: nextStep
        });
        recordHectorActivity(discovery.synthesis?.ok ? 'source_discovery_synthesized' : 'source_discovery_empty', {
          reportId,
          provider: discovery.provider,
          providerChain: discovery.providerChain,
          queryUsed: discovery.queryUsed,
          refinements: discovery.refinements
        });
        onProgress?.(noDiscovery);
        return noDiscovery;
      }

      const mergedSources = mergeSources(workingReport.sources || [], discovery.sources);
      const discoveredMessage = `Discovered ${discovery.sources.length} source(s) via ${discovery.providerChain.join(' -> ')}.`;
      const discoveredReport = updateReport(reportId, {
        sources: mergedSources,
        status: 'source_discovery_completed',
        runState: 'running',
        currentSourceUrl: null,
        confidenceLevel: TRUST_STATES.INFERRED,
        summary: discoveredMessage,
        providerUsed: discovery.provider,
        providerChain: discovery.providerChain,
        queryUsed: discovery.queryUsed,
        refinements: discovery.refinements,
        runLog: appendRunLog(discoveryStart || workingReport, {
          level: 'success',
          message: discoveredMessage
        }),
        recommendedNextStep: 'Fetching discovered sources for verification...'
      });
      recordHectorActivity('source_discovery_completed', {
        reportId,
        discoveredCount: discovery.sources.length,
        provider: discovery.provider,
        providerChain: discovery.providerChain,
        queryUsed: discovery.queryUsed,
        refinements: discovery.refinements
      });
      workingReport = discoveredReport || workingReport;
      onProgress?.(workingReport);
    } catch (error) {
      const failedDiscovery = updateReport(reportId, {
        status: 'source_discovery_failed',
        runState: 'failed',
        currentSourceUrl: null,
        confidenceLevel: TRUST_STATES.FAILED,
        summary: 'Live source discovery failed.',
        runLog: appendRunLog(discoveryStart || workingReport, {
          level: 'error',
          message: `Source discovery failed: ${String(error)}`
        }),
        recommendedNextStep: 'Check network connectivity or add URLs manually, then retry.',
        providerUsed: 'duckduckgo_html',
        providerChain: ['duckduckgo_html', 'failed']
      });
      recordHectorActivity('source_discovery_failed', { reportId, error: String(error) });
      onProgress?.(failedDiscovery);
      return failedDiscovery;
    }
  }

  let liveReport = updateReport(reportId, {
    status: 'source_fetch_running',
    runState: 'running',
    currentSourceUrl: null,
    runLog: appendRunLog(workingReport, {
      level: 'info',
      message: `Starting live run across ${workingReport.sources.length} source(s).`
    }),
    summary: 'Hector run started. Fetching discovered/supplied sources...'
  });
  onProgress?.(liveReport);

  recordHectorActivity('source_fetch_started', { reportId, sourceCount: workingReport.sources.length });

  const proofs = [];
  for (const source of workingReport.sources) {
    liveReport = updateReport(reportId, {
      currentSourceUrl: source.url,
      runState: 'running',
      runLog: appendRunLog(liveReport || report, {
        level: 'info',
        message: `Visiting ${source.url}`
      })
    });
    onProgress?.(liveReport);

    try {
      const sourceProofs = await invoke('fetch_research_sources', {
        sources: [{
          url: source.url,
          sourceType: source.type || 'public_web',
          official: Boolean(source.official)
        }]
      });
      const proof = Array.isArray(sourceProofs) ? sourceProofs[0] : null;
      if (proof) {
        proofs.push(proof);
      }
      liveReport = updateReport(reportId, {
        runLog: appendRunLog(liveReport || report, {
          level: proof?.ok ? 'success' : 'warning',
          message: proof
            ? `${proof.ok ? 'Fetched' : 'Failed'} ${source.url}${proof.httpStatus ? ` (HTTP ${proof.httpStatus})` : ''}`
            : `No proof payload returned for ${source.url}`
        })
      });
      onProgress?.(liveReport);
    } catch (error) {
      const fallbackProof = {
        url: source.url,
        sourceType: source.type || 'public_web',
        official: Boolean(source.official),
        fetchedAtMs: timestampMs(),
        httpStatus: null,
        ok: false,
        title: null,
        snippet: null,
        dateChecked: new Date().toISOString(),
        confidence: TRUST_STATES.FAILED,
        riskLevel: source.official ? 'low' : 'medium',
        verificationState: TRUST_STATES.FAILED,
        error: String(error)
      };
      proofs.push(fallbackProof);
      liveReport = updateReport(reportId, {
        runLog: appendRunLog(liveReport || report, {
          level: 'error',
          message: `Error fetching ${source.url}: ${String(error)}`
        })
      });
      onProgress?.(liveReport);
    }
  }

  const successProofs = proofs.filter((proof) => proof.ok);
  const failedProofs = proofs.filter((proof) => !proof.ok);
  const sources = workingReport.sources.map((source) => {
    const proof = proofs.find((item) => item.url === source.url || item.url.replace(/\/$/, '') === source.url.replace(/\/$/, ''));
    return proof ? {
      ...source,
      fetched: proof.ok,
      fetchedAtMs: proof.fetchedAtMs,
      httpStatus: proof.httpStatus,
      title: proof.title,
      snippet: proof.snippet,
      confidence: proof.confidence,
      riskLevel: proof.riskLevel,
      verificationState: proof.verificationState,
      error: proof.error || null
    } : source;
  });

  const runSummary = successProofs.length
    ? `Visited ${proofs.length} source(s): ${successProofs.length} verified, ${failedProofs.length} failed.`
    : `Visited ${proofs.length} source(s): none verified.`;
  const updated = updateReport(reportId, {
    sources,
    sourceProofs: proofs,
    urls: proofs.map((proof) => proof.url).filter(Boolean),
    dateChecked: new Date().toISOString(),
    confidenceLevel: failedProofs.length ? (successProofs.length ? TRUST_STATES.INFERRED : TRUST_STATES.FAILED) : TRUST_STATES.VERIFIED,
    verifiedFacts: successProofs.map((proof) => `Fetched ${proof.url} with HTTP ${proof.httpStatus}.`),
    inferredPoints: successProofs
      .filter((proof) => proof.title || proof.snippet)
      .map((proof) => `${proof.title || proof.url}: ${(proof.snippet || '').slice(0, 220)}`),
    summary: successProofs.length
      ? `Fetched ${successProofs.length} of ${proofs.length} source(s) with proof-backed citations.`
      : 'No sources were reachable. No citations were verified.',
    status: failedProofs.length ? (successProofs.length ? 'source_fetch_partial' : 'source_fetch_failed') : 'sources_verified',
    runState: failedProofs.length ? (successProofs.length ? 'partial' : 'failed') : 'completed',
    currentSourceUrl: null,
    providerUsed: workingReport.providerUsed || 'duckduckgo_html',
    providerChain: workingReport.providerChain || ['duckduckgo_html'],
    queryUsed: workingReport.queryUsed || workingReport.researchQuestion,
    refinements: workingReport.refinements || [],
    lastRunSummary: runSummary,
    runLog: appendRunLog(liveReport || workingReport, {
      level: failedProofs.length ? 'warning' : 'success',
      message: runSummary
    }),
    recommendedNextStep: successProofs.length
      ? 'Review extracted snippets and create a Jose approval handoff if the report should enter orchestration.'
      : 'Check URLs/network access, then retry.'
  });
  onProgress?.(updated);

  successProofs.forEach((proof) => {
    pushMemoryItem({
      title: `Hector verified source: ${proof.title || proof.url}`,
      category: 'source_memory',
      content: {
        reportId,
        url: proof.url,
        httpStatus: proof.httpStatus,
        title: proof.title,
        snippet: proof.snippet,
        dateChecked: proof.dateChecked
      },
      source: 'hector-source-fetch',
      sourceAgent: AGENTS.HECTOR,
      confidence: TRUST_STATES.VERIFIED,
      verificationState: TRUST_STATES.VERIFIED,
      expiresAt: sourceExpiryForType(proof.sourceType || 'public_web'),
      expiryRule: proof.sourceType || 'public_web'
    });
  });

  recordHectorActivity('source_fetch_completed', {
    reportId,
    successCount: successProofs.length,
    failedCount: failedProofs.length
  });
  appendSessionEvent({
    category: 'research',
    title: 'Hector live source fetch completed',
    details: { reportId, successCount: successProofs.length, failedCount: failedProofs.length },
    agent: AGENTS.HECTOR,
    confidence: successProofs.length ? TRUST_STATES.VERIFIED : TRUST_STATES.FAILED,
    verificationState: successProofs.length ? TRUST_STATES.VERIFIED : TRUST_STATES.FAILED
  });
  return updated;
}

export function createHectorApprovalPacket(reportId) {
  const report = listHectorReports().find((item) => item.id === reportId);
  if (!report) return null;
  const packet = createAgentPacket({
    fromAgent: AGENTS.HECTOR,
    toAgent: AGENTS.JOSE,
    title: `Research approval: ${report.researchQuestion}`,
    packetType: 'research_approval_handoff',
    payload: report,
    source: 'hector-research-desk',
    confidence: TRUST_STATES.TEMPORARY,
    verificationState: TRUST_STATES.UNVERIFIED,
    requiresApproval: true,
    riskLevel: report.riskLevel || 'medium',
    actionType: 'research_review',
    commandPreview: 'No command execution. Research review only.',
    fileChangePreview: 'No file changes requested.',
    rollbackAvailable: false
  });
  recordHectorActivity('jose_approval_handoff_created', { reportId, packetId: packet.id });
  return packet;
}

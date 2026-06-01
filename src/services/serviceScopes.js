// Single source for all localStorage scope keys and lightweight constants.
// Importing this file does NOT pull in any service implementation code,
// so App.jsx can use these without bundling heavy service modules at startup.

/** Agent bus packet queue — queued action packets pending dispatch. Owned by agentBusService. */
export const PACKET_SCOPE              = 'agent_bus_packets_v1';

/** Session-scoped event log — UI and runtime events recorded per session. Owned by sessionIntelligenceService. */
export const SESSION_EVENT_SCOPE       = 'session_events_v1';

/** Jose command routing table — maps intent labels to executor paths. Owned by joseCommandRouterService. */
export const JOSE_COMMAND_SCOPE        = 'jose_command_routes_v2';

/** Jose governance decisions — approval/denial records for high-risk actions. Owned by orchestrationGovernanceService. */
export const GOVERNANCE_SCOPE          = 'jose_governance_decisions_v1';

/** Orchestration receipts — completion acknowledgements for dispatched orchestration packets. Owned by orchestrationReceiptService. */
export const ORCHESTRATION_RECEIPT_SCOPE = 'orchestration_receipts_v1';

/** Orchestration queue transition log — state-machine transitions for queued orchestration steps. Owned by orchestrationQueueService. */
export const ORCHESTRATION_QUEUE_SCOPE = 'orchestration_queue_transitions_v1';

/** Verification log — per-claim verification results and confidence scores. Owned by verificationService. */
export const VERIFICATION_SCOPE        = 'verification_logs_v1';

/** Connector registry — registered external connector definitions (v2 schema). Owned by connectorRegistryService. */
export const CONNECTOR_SCOPE           = 'connector_registry_v2';

/** Connector audit trail — per-connector invocation and error audit records (v2). Owned by connectorRegistryService. */
export const CONNECTOR_AUDIT_SCOPE     = 'connector_audit_v2';

/** Connector auth profiles — OAuth tokens and API-key credentials per connector. Owned by connectorRegistryService. */
export const CONNECTOR_AUTH_SCOPE      = 'connector_auth_profiles_v1';

/** Miya memory store — Miya agent's private short-term memory items. Owned by miyaMemoryService. */
export const MIYA_MEMORY_SCOPE         = 'miya_memory_v1';

/** Plugin registry — installed plugin manifests and capability declarations. Owned by pluginRegistryService. */
export const PLUGINS_SCOPE             = 'plugins_registry_v1';

/** Plugin audit log — per-plugin invocation, permission, and error events. Owned by pluginRegistryService. */
export const PLUGIN_AUDIT_SCOPE        = 'plugin_audit_v1';

/** Production readiness checks — structured readiness gate results for the current build. Owned by productionReadinessService. */
export const PRODUCTION_READINESS_SCOPE = 'production_readiness_v1';

/** Repo audit records — repository-level code audit findings and scan results. Owned by repoAuditService. */
export const REPO_AUDIT_SCOPE          = 'repo_audits_v1';

/** Self-development cycle log — autonomous self-improvement iteration records. Owned by selfDevelopmentService. */
export const SELF_DEVELOPMENT_SCOPE    = 'self_development_cycles_v1';

/** Dev packet store — development task packets generated during coding sessions. Owned by devPacketService. */
export const DEV_PACKET_SCOPE          = 'dev_packets_v1';

/** Tool connection registry — active and historical external tool connection configs. Owned by toolConnectionService. */
export const TOOL_CONNECTION_SCOPE     = 'tool_connections_v1';

/** Tool connection audit log — per-connection invocation and health audit events. Owned by toolConnectionService. */
export const TOOL_CONNECTION_AUDIT_SCOPE = 'tool_connection_audit_v1';

/** Workflow operations registry — registered workflow operation definitions and handlers. Owned by workflowOperationsRegistryService. */
export const WORKFLOW_OPS_SCOPE        = 'workflow_operations_registry_v1';

/** Workflow run records — execution state and results for each workflow run. Owned by workflowExecutionService. */
export const WORKFLOW_RUN_SCOPE        = 'workflow_runs_v1';

/** Workflow receipts — completion and outcome receipts for finished workflow runs. Owned by workflowReceiptService. */
export const WORKFLOW_RECEIPT_SCOPE    = 'workflow_receipts_v1';

/** Workflow telemetry — per-step timing, resource, and error telemetry for workflow runs. Owned by workflowTelemetryService. */
export const WORKFLOW_TELEMETRY_SCOPE  = 'workflow_telemetry_v1';

/** Proof authority identifiers — discriminate whether a proof was produced by the Rust engine or the JS bridge. */
export const PROOF_AUTHORITY = {
  RUST_ENGINE: 'rust_engine',
  JS_BRIDGE:   'js_bridge'
};

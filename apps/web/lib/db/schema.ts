import type { SandboxState } from "@open-agents/sandbox";
import { sql } from "drizzle-orm";
import type { ModelVariant } from "@/lib/model-variants";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";
import {
  bigint,
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

// users
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
});

// oauth provider accounts
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// better-auth sessions
export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

// better-auth verification tokens
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", {
      enum: ["User", "Organization"],
    }).notNull(),
    repositorySelection: text("repository_selection", {
      enum: ["all", "selected"],
    }).notNull(),
    installationUrl: text("installation_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("github_installations_user_installation_idx").on(
      table.userId,
      table.installationId,
    ),
    uniqueIndex("github_installations_user_account_idx").on(
      table.userId,
      table.accountLogin,
    ),
  ],
);

export const vercelProjectLinks = pgTable(
  "vercel_project_links",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    projectId: text("project_id").notNull(),
    projectName: text("project_name").notNull(),
    teamId: text("team_id"),
    teamSlug: text("team_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.repoOwner, table.repoName],
    }),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "archived"],
    })
      .notNull()
      .default("running"),
    // Repository info
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    branch: text("branch"),
    cloneUrl: text("clone_url"),
    vercelProjectId: text("vercel_project_id"),
    vercelProjectName: text("vercel_project_name"),
    vercelTeamId: text("vercel_team_id"),
    vercelTeamSlug: text("vercel_team_slug"),
    // Whether this session uses a new auto-generated branch
    isNewBranch: boolean("is_new_branch").default(false).notNull(),
    // Optional per-session override for auto commit + push behavior.
    // null means "use the user's default preference".
    autoCommitPushOverride: boolean("auto_commit_push_override"),
    // Optional per-session override for auto PR creation after auto-commit.
    // null means "use the user's default preference".
    autoCreatePrOverride: boolean("auto_create_pr_override"),
    // BUFI bridge: where to POST when this session reaches terminal state.
    // Set only on sessions created via /api/bufi/dispatch with a callback
    // field. A polling workflow (bufi-callback.ts) watches sessions with
    // this column set and fires the POST when status flips to completed/
    // failed/archived. firedAt prevents double-firing.
    bufiCallbackUrl: text("bufi_callback_url"),
    bufiCallbackSecret: text("bufi_callback_secret"),
    bufiCallbackFiredAt: timestamp("bufi_callback_fired_at"),
    // Observability: latest LLM-as-judge eval over this
    // session's traces (0..1), written by the eval pipeline. Rendered
    // as a quality badge in the sessions list + header.
    evalScore: real("eval_score"),
    evalLabel: text("eval_label"),
    globalSkillRefs: jsonb("global_skill_refs")
      .$type<GlobalSkillRef[]>()
      .notNull()
      .default([]),
    // Unified sandbox state
    sandboxState: jsonb("sandbox_state").$type<SandboxState>(),
    // Lifecycle orchestration state for sandbox management
    lifecycleState: text("lifecycle_state", {
      enum: [
        "provisioning",
        "active",
        "hibernating",
        "hibernated",
        "restoring",
        "archived",
        "failed",
      ],
    }),
    lifecycleVersion: integer("lifecycle_version").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    sandboxExpiresAt: timestamp("sandbox_expires_at"),
    hibernateAfter: timestamp("hibernate_after"),
    lifecycleRunId: text("lifecycle_run_id"),
    sandboxProvisioningRunId: text("sandbox_provisioning_run_id"),
    activeHarnessRunId: text("active_harness_run_id"),
    lifecycleError: text("lifecycle_error"),
    // Git stats (for display in session list)
    linesAdded: integer("lines_added").default(0),
    linesRemoved: integer("lines_removed").default(0),
    // PR info if created
    prNumber: integer("pr_number"),
    prStatus: text("pr_status", {
      enum: ["open", "merged", "closed"],
    }),
    // Snapshot info (for cached snapshots feature)
    snapshotUrl: text("snapshot_url"),
    snapshotCreatedAt: timestamp("snapshot_created_at"),
    snapshotSizeBytes: integer("snapshot_size_bytes"),
    // Cached diff for offline viewing
    cachedDiff: jsonb("cached_diff"),
    cachedDiffUpdatedAt: timestamp("cached_diff_updated_at"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    modelId: text("model_id").default("anthropic/claude-haiku-4.5"),
    harnessId: text("harness_id", {
      enum: ["open-agent", "codex", "claude-code", "pi"],
    })
      .notNull()
      .default("open-agent"),
    activeStreamId: text("active_stream_id"),
    lastAssistantMessageAt: timestamp("last_assistant_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("chats_session_id_idx").on(table.sessionId)],
);

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("shares_chat_id_idx").on(table.chatId)],
);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant"],
  }).notNull(),
  // Store the full message parts as JSON for flexibility
  parts: jsonb("parts").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatReads = pgTable(
  "chat_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chatId] }),
    index("chat_reads_chat_id_idx").on(table.chatId),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: text("model_id"),
    status: text("status", {
      enum: ["completed", "aborted", "failed"],
    }).notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    totalDurationMs: integer("total_duration_ms").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_runs_chat_id_idx").on(table.chatId),
    index("workflow_runs_session_id_idx").on(table.sessionId),
    index("workflow_runs_user_id_idx").on(table.userId),
  ],
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    finishReason: text("finish_reason"),
    rawFinishReason: text("raw_finish_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_run_steps_run_id_idx").on(table.workflowRunId),
    uniqueIndex("workflow_run_steps_run_step_idx").on(
      table.workflowRunId,
      table.stepNumber,
    ),
  ],
);

export const operatingPackRuns = pgTable(
  "operating_pack_runs",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id").unique(),
    workspaceId: text("workspace_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packId: text("pack_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    harnessId: text("harness_id", {
      enum: ["codex", "claude-code", "pi"],
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "running",
        "awaiting_approval",
        "approved",
        "rejected",
        "completed",
        "failed",
        "cancelled",
      ],
    })
      .notNull()
      .default("pending"),
    approvalId: text("approval_id"),
    result: jsonb("result").$type<Readonly<Record<string, unknown>>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("operating_pack_runs_workspace_idempotency_idx").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("operating_pack_runs_session_id_idx").on(table.sessionId),
    index("operating_pack_runs_user_id_idx").on(table.userId),
    index("operating_pack_runs_status_idx").on(table.status),
  ],
);

export const operatingPackCredentials = pgTable(
  "operating_pack_credentials",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => operatingPackRuns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("operating_pack_credentials_expiry_idx").on(table.expiresAt),
  ],
);

export const operatingPackTraces = pgTable(
  "operating_pack_traces",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => operatingPackRuns.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    agentId: text("agent_id"),
    summary: text("summary"),
    data: jsonb("data").$type<Readonly<Record<string, unknown>>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("operating_pack_traces_run_sequence_idx").on(
      table.runId,
      table.sequence,
    ),
    index("operating_pack_traces_workspace_run_idx").on(
      table.workspaceId,
      table.runId,
    ),
  ],
);

export const knowledgeEntities = pgTable(
  "knowledge_entities",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    externalKey: text("external_key").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    searchVector: tsvector("search_vector")
      .generatedAlwaysAs(
        sql`to_tsvector('simple', "name" || ' ' || "kind" || ' ' || "external_key")`,
      )
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_entities_workspace_kind_external_idx").on(
      table.workspaceId,
      table.kind,
      table.externalKey,
    ),
    uniqueIndex("knowledge_entities_id_workspace_idx").on(
      table.id,
      table.workspaceId,
    ),
    index("knowledge_entities_workspace_id_idx").on(
      table.workspaceId,
      table.id,
    ),
    index("knowledge_entities_search_idx").using("gin", table.searchVector),
  ],
);

export const knowledgeOutbox = pgTable(
  "knowledge_outbox",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    topic: text("topic").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    payload: jsonb("payload")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    status: text("status", {
      enum: ["pending", "published", "dead"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    publishedAt: timestamp("published_at"),
  },
  (table) => [
    index("knowledge_outbox_workspace_claim_idx").on(
      table.workspaceId,
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    index("knowledge_outbox_lease_expiry_idx").on(table.leaseExpiresAt),
  ],
);

export const knowledgeEmbeddings = pgTable(
  "knowledge_embeddings",
  {
    entityId: text("entity_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    model: text("model").notNull(),
    inputVersion: text("input_version").notNull(),
    inputHash: text("input_hash").notNull(),
    sourceVersion: integer("source_version").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.entityId, table.model, table.inputVersion],
    }),
    foreignKey({
      columns: [table.entityId, table.workspaceId],
      foreignColumns: [knowledgeEntities.id, knowledgeEntities.workspaceId],
      name: "knowledge_embeddings_entity_workspace_fk",
    }).onDelete("cascade"),
    index("knowledge_embeddings_workspace_model_idx").on(
      table.workspaceId,
      table.model,
      table.inputVersion,
    ),
    index("knowledge_embeddings_cosine_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
  ],
);

export const knowledgeEnrichments = pgTable(
  "knowledge_enrichments",
  {
    entityId: text("entity_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    classifierVersion: text("classifier_version").notNull(),
    inputHash: text("input_hash").notNull(),
    sourceVersion: integer("source_version").notNull(),
    classification: text("classification").notNull(),
    confidence: real("confidence").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.classifierVersion] }),
    foreignKey({
      columns: [table.entityId, table.workspaceId],
      foreignColumns: [knowledgeEntities.id, knowledgeEntities.workspaceId],
      name: "knowledge_enrichments_entity_workspace_fk",
    }).onDelete("cascade"),
    index("knowledge_enrichments_workspace_classification_idx").on(
      table.workspaceId,
      table.classification,
    ),
  ],
);

export const knowledgeSearchProjections = pgTable(
  "knowledge_search_projections",
  {
    entityId: text("entity_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
    collection: text("collection").notNull(),
    schemaVersion: text("schema_version").notNull(),
    inputHash: text("input_hash").notNull(),
    sourceVersion: integer("source_version").notNull(),
    providerRevision: text("provider_revision"),
    projectedAt: timestamp("projected_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.entityId, table.provider, table.collection],
    }),
    foreignKey({
      columns: [table.entityId, table.workspaceId],
      foreignColumns: [knowledgeEntities.id, knowledgeEntities.workspaceId],
      name: "knowledge_search_projections_entity_workspace_fk",
    }).onDelete("cascade"),
    index("knowledge_search_projections_workspace_version_idx").on(
      table.workspaceId,
      table.sourceVersion,
    ),
  ],
);

export const knowledgeContextPackets = pgTable(
  "knowledge_context_packets",
  {
    packetHash: text("packet_hash").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    workflowRunId: text("workflow_run_id").notNull(),
    agentRunId: text("agent_run_id").notNull(),
    traceId: text("trace_id").notNull(),
    authorizationScope: text("authorization_scope").notNull(),
    graphWatermark: text("graph_watermark").notNull(),
    projectionWatermark: text("projection_watermark").notNull(),
    ontologyVersion: text("ontology_version").notNull(),
    packet: jsonb("packet")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    generatedAt: timestamp("generated_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("knowledge_context_packets_workspace_run_idx").on(
      table.workspaceId,
      table.workflowRunId,
      table.agentRunId,
      table.generatedAt,
    ),
    index("knowledge_context_packets_workspace_expiry_idx").on(
      table.workspaceId,
      table.expiresAt,
    ),
  ],
);

export const connectorDeployments = pgTable(
  "connector_deployments",
  {
    deploymentId: text("deployment_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    connectionId: text("connection_id").notNull(),
    environment: text("environment", {
      enum: ["development", "staging", "production"],
    }).notNull(),
    manifest: jsonb("manifest")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    manifestHash: text("manifest_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("connector_deployments_workspace_connection_env_idx").on(
      table.workspaceId,
      table.connectionId,
      table.environment,
    ),
    index("connector_deployments_workspace_idx").on(table.workspaceId),
  ],
);

export const connectorEventReceipts = pgTable(
  "connector_event_receipts",
  {
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => connectorDeployments.deploymentId, {
        onDelete: "cascade",
      }),
    eventId: text("event_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    bodyHash: text("body_hash").notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.eventId] }),
    index("connector_event_receipts_workspace_received_idx").on(
      table.workspaceId,
      table.receivedAt,
    ),
  ],
);

export const sourceArtifacts = pgTable(
  "source_artifacts",
  {
    artifactKey: text("artifact_key").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    connectorId: text("connector_id").notNull(),
    provider: text("provider", {
      enum: ["manual", "gmail", "outlook", "pipedream"],
    }).notNull(),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    safeStorageRef: text("safe_storage_ref").notNull(),
    sourceRevision: text("source_revision").notNull(),
    metadata: jsonb("metadata")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    receivedAt: timestamp("received_at").notNull(),
    observedAt: timestamp("observed_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_artifacts_workspace_revision_idx").on(
      table.workspaceId,
      table.sourceRevision,
    ),
    index("source_artifacts_workspace_observed_idx").on(
      table.workspaceId,
      table.observedAt,
    ),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type VercelProjectLink = typeof vercelProjectLinks.$inferSelect;
export type NewVercelProjectLink = typeof vercelProjectLinks.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Share = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatRead = typeof chatReads.$inferSelect;
export type NewChatRead = typeof chatReads.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type WorkflowRunStep = typeof workflowRunSteps.$inferSelect;
export type NewWorkflowRunStep = typeof workflowRunSteps.$inferInsert;
export type OperatingPackRun = typeof operatingPackRuns.$inferSelect;
export type NewOperatingPackRun = typeof operatingPackRuns.$inferInsert;
export type OperatingPackCredential =
  typeof operatingPackCredentials.$inferSelect;
export type OperatingPackTrace = typeof operatingPackTraces.$inferSelect;
export type NewOperatingPackTrace = typeof operatingPackTraces.$inferInsert;
export type KnowledgeEntity = typeof knowledgeEntities.$inferSelect;
export type NewKnowledgeEntity = typeof knowledgeEntities.$inferInsert;
export type KnowledgeOutboxEvent = typeof knowledgeOutbox.$inferSelect;
export type NewKnowledgeOutboxEvent = typeof knowledgeOutbox.$inferInsert;
export type KnowledgeEmbedding = typeof knowledgeEmbeddings.$inferSelect;
export type NewKnowledgeEmbedding = typeof knowledgeEmbeddings.$inferInsert;
export type KnowledgeEnrichment = typeof knowledgeEnrichments.$inferSelect;
export type NewKnowledgeEnrichment = typeof knowledgeEnrichments.$inferInsert;
export type KnowledgeSearchProjection =
  typeof knowledgeSearchProjections.$inferSelect;
export type NewKnowledgeSearchProjection =
  typeof knowledgeSearchProjections.$inferInsert;
export type KnowledgeContextPacket =
  typeof knowledgeContextPackets.$inferSelect;
export type NewKnowledgeContextPacket =
  typeof knowledgeContextPackets.$inferInsert;
export type ConnectorDeployment = typeof connectorDeployments.$inferSelect;
export type NewConnectorDeployment = typeof connectorDeployments.$inferInsert;
export type ConnectorEventReceipt = typeof connectorEventReceipts.$inferSelect;
export type NewConnectorEventReceipt =
  typeof connectorEventReceipts.$inferInsert;
export type SourceArtifactRecord = typeof sourceArtifacts.$inferSelect;
export type NewSourceArtifactRecord = typeof sourceArtifacts.$inferInsert;
export type GitHubInstallation = typeof githubInstallations.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallations.$inferInsert;

// User preferences for settings
export const userPreferences = pgTable("user_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  defaultModelId: text("default_model_id").default(
    "anthropic/claude-haiku-4.5",
  ),
  defaultSubagentModelId: text("default_subagent_model_id"),
  defaultSandboxType: text("default_sandbox_type", {
    enum: ["vercel"],
  }).default("vercel"),
  defaultDiffMode: text("default_diff_mode", {
    enum: ["unified", "split"],
  }).default("unified"),
  autoCommitPush: boolean("auto_commit_push").notNull().default(false),
  autoCreatePr: boolean("auto_create_pr").notNull().default(false),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  alertSoundEnabled: boolean("alert_sound_enabled").notNull().default(true),
  publicUsageEnabled: boolean("public_usage_enabled").notNull().default(false),
  globalSkillRefs: jsonb("global_skill_refs")
    .$type<GlobalSkillRef[]>()
    .notNull()
    .default([]),
  modelVariants: jsonb("model_variants")
    .$type<ModelVariant[]>()
    .notNull()
    .default([]),
  enabledModelIds: jsonb("enabled_model_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

// Usage tracking — one row per assistant turn (append-only)
export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["web"] })
    .notNull()
    .default("web"),
  agentType: text("agent_type", { enum: ["main", "subagent"] })
    .notNull()
    .default("main"),
  provider: text("provider"),
  modelId: text("model_id"),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

import { createHash } from "node:crypto";
import type {
  KnowledgeEmbeddingProvider,
  KnowledgeSearchProjectionProvider,
  PersistentEntity,
  PersistentKnowledgeEnrichment,
} from "@open-agents/knowledge";
import {
  knowledgeEmbeddingInput,
  knowledgeEmbeddingInputHash,
  knowledgeSearchDocument,
} from "@open-agents/knowledge";
import type { BullMqRuntimeJob } from "./bullmq";
import { QueueTaskError } from "./bullmq";

type EmbeddingWorkspaceRepository = {
  getById(id: string): Promise<PersistentEntity | undefined>;
  getByExternalKey(
    kind: string,
    externalKey: string,
  ): Promise<PersistentEntity | undefined>;
  upsertEmbedding(input: {
    entityId: string;
    model: string;
    inputVersion: string;
    inputHash: string;
    sourceVersion: number;
    embedding: readonly number[];
  }): Promise<{ replayed: boolean }>;
};

type KnowledgeStageWorkspaceRepository = EmbeddingWorkspaceRepository & {
  resolve(input: {
    externalKey: string;
    kind: string;
    name: string;
  }): Promise<PersistentEntity>;
  getEnrichment(
    entityId: string,
    classifierVersion: string,
  ): Promise<PersistentKnowledgeEnrichment | undefined>;
  upsertEnrichment(input: {
    entityId: string;
    classifierVersion: string;
    inputHash: string;
    sourceVersion: number;
    classification: string;
    confidence: number;
  }): Promise<{ replayed: boolean }>;
  upsertSearchProjection(input: {
    entityId: string;
    provider: string;
    collection: string;
    schemaVersion: string;
    inputHash: string;
    sourceVersion: number;
    providerRevision?: string;
    projectedAt: string;
  }): Promise<{ replayed: boolean }>;
};

export type KnowledgeProcessorArtifact = Readonly<{
  artifactKey: string;
  workspaceId: string;
  connectorId: string;
  provider: "manual" | "gmail" | "outlook" | "pipedream";
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  sourceRevision: string;
  metadata: Readonly<Record<string, unknown>>;
  observedAt: string;
}>;

export type KnowledgeProcessorArtifactReader = {
  getArtifact(
    workspaceId: string,
    artifactKey: string,
  ): Promise<KnowledgeProcessorArtifact | undefined>;
};

type KnowledgeProcessor = (
  job: BullMqRuntimeJob,
  signal: AbortSignal,
) => Promise<void>;

export type KnowledgeEmbeddingProcessorResult = Readonly<{
  entityId: string;
  entityVersion: number;
  model: string;
  inputVersion: string;
  inputHash: string;
  replayed: boolean;
  usageTokens: number | null;
}>;

export const KNOWLEDGE_ENRICHMENT_CLASSIFIER_VERSION =
  "source-artifact-rules.v1";

export function createKnowledgeEmbeddingProcessor(input: {
  forWorkspace(workspaceId: string): EmbeddingWorkspaceRepository;
  provider: KnowledgeEmbeddingProvider;
  onProjected?: (
    result: KnowledgeEmbeddingProcessorResult,
  ) => void | Promise<void>;
}): KnowledgeProcessor {
  return async (job, signal) => {
    assertRoute(job, "knowledge-ai", "embedding", "EMBEDDING");
    const reference = parseEntityReference(job.payload);
    assertNotAborted(signal, "EMBEDDING_DEADLINE_EXCEEDED");
    const workspace = input.forWorkspace(job.workspaceId);
    const entity = reference.entityId
      ? await workspace.getById(reference.entityId)
      : await workspace.getByExternalKey(
          "SourceArtifact",
          reference.artifactKey!,
        );
    if (!entity)
      throw new QueueTaskError({
        code: "EMBEDDING_ENTITY_NOT_FOUND",
        retryable: !reference.entityId,
        status: reference.entityId ? 404 : 409,
      });
    const normalizedInput = knowledgeEmbeddingInput(entity);
    const batch = await input.provider.embed([normalizedInput]);
    assertNotAborted(signal, "EMBEDDING_DEADLINE_EXCEEDED");
    const projection = batch.embeddings[0];
    if (!projection)
      throw new QueueTaskError({
        code: "EMBEDDING_PROVIDER_EMPTY",
        retryable: true,
        status: 502,
      });
    const inputHash = knowledgeEmbeddingInputHash(normalizedInput);
    const write = await workspace.upsertEmbedding({
      entityId: entity.id,
      model: batch.model,
      inputVersion: batch.inputVersion,
      inputHash,
      sourceVersion: entity.version,
      embedding: projection,
    });
    await input.onProjected?.({
      entityId: entity.id,
      entityVersion: entity.version,
      model: batch.model,
      inputVersion: batch.inputVersion,
      inputHash,
      replayed: write.replayed,
      usageTokens: batch.usageTokens,
    });
  };
}

export function createKnowledgeCanonicalWriteProcessor(input: {
  artifacts: KnowledgeProcessorArtifactReader;
  forWorkspace(workspaceId: string): KnowledgeStageWorkspaceRepository;
  onResolved?: (
    result: Readonly<{
      entityId: string;
      entityVersion: number;
      artifactKey: string;
      replayed: boolean;
    }>,
  ) => void | Promise<void>;
}): KnowledgeProcessor {
  return async (job, signal) => {
    assertRoute(job, "source-connectors", "canonical-write", "CANONICAL");
    const artifact = await readArtifact(job, input.artifacts);
    assertNotAborted(signal, "CANONICAL_DEADLINE_EXCEEDED");
    const workspace = input.forWorkspace(job.workspaceId);
    const before = await workspace.getByExternalKey(
      "SourceArtifact",
      artifact.artifactKey,
    );
    const entity = await workspace.resolve({
      externalKey: artifact.artifactKey,
      kind: "SourceArtifact",
      name: artifactName(artifact),
    });
    await input.onResolved?.({
      entityId: entity.id,
      entityVersion: entity.version,
      artifactKey: artifact.artifactKey,
      replayed: before?.id === entity.id && before.version === entity.version,
    });
  };
}

export function createKnowledgeEnrichmentProcessor(input: {
  artifacts: KnowledgeProcessorArtifactReader;
  forWorkspace(workspaceId: string): KnowledgeStageWorkspaceRepository;
  classifierVersion?: string;
  onEnriched?: (
    result: Readonly<{
      entityId: string;
      entityVersion: number;
      classification: string;
      confidence: number;
      inputHash: string;
      replayed: boolean;
    }>,
  ) => void | Promise<void>;
}): KnowledgeProcessor {
  const classifierVersion =
    input.classifierVersion ?? KNOWLEDGE_ENRICHMENT_CLASSIFIER_VERSION;
  return async (job, signal) => {
    assertRoute(job, "knowledge-ai", "enrichment", "ENRICHMENT");
    const artifact = await readArtifact(job, input.artifacts);
    const workspace = input.forWorkspace(job.workspaceId);
    const entity = await workspace.getByExternalKey(
      "SourceArtifact",
      artifact.artifactKey,
    );
    if (!entity)
      throw new QueueTaskError({
        code: "ENRICHMENT_CANONICAL_PENDING",
        retryable: true,
        status: 409,
      });
    assertNotAborted(signal, "ENRICHMENT_DEADLINE_EXCEEDED");
    const classification = classifyArtifact(artifact);
    const inputHash = artifactProjectionHash(artifact, classifierVersion);
    const write = await workspace.upsertEnrichment({
      entityId: entity.id,
      classifierVersion,
      inputHash,
      sourceVersion: entity.version,
      classification: classification.value,
      confidence: classification.confidence,
    });
    await input.onEnriched?.({
      entityId: entity.id,
      entityVersion: entity.version,
      classification: classification.value,
      confidence: classification.confidence,
      inputHash,
      replayed: write.replayed,
    });
  };
}

export function createKnowledgeSearchProjectionProcessor(input: {
  forWorkspace(workspaceId: string): KnowledgeStageWorkspaceRepository;
  provider: KnowledgeSearchProjectionProvider;
  classifierVersion?: string;
  onProjected?: (
    result: Readonly<{
      entityId: string;
      entityVersion: number;
      provider: string;
      collection: string;
      inputHash: string;
      replayed: boolean;
    }>,
  ) => void | Promise<void>;
}): KnowledgeProcessor {
  const classifierVersion =
    input.classifierVersion ?? KNOWLEDGE_ENRICHMENT_CLASSIFIER_VERSION;
  return async (job, signal) => {
    assertRoute(job, "knowledge-ai", "projection", "PROJECTION");
    const reference = parseEntityReference(job.payload);
    const workspace = input.forWorkspace(job.workspaceId);
    const entity = reference.entityId
      ? await workspace.getById(reference.entityId)
      : await workspace.getByExternalKey(
          "SourceArtifact",
          reference.artifactKey!,
        );
    if (!entity)
      throw new QueueTaskError({
        code: "PROJECTION_CANONICAL_PENDING",
        retryable: !reference.entityId,
        status: reference.entityId ? 404 : 409,
      });
    const enrichment = await workspace.getEnrichment(
      entity.id,
      classifierVersion,
    );
    if (!enrichment)
      throw new QueueTaskError({
        code: "PROJECTION_ENRICHMENT_PENDING",
        retryable: true,
        status: 409,
      });
    assertNotAborted(signal, "PROJECTION_DEADLINE_EXCEEDED");
    const document = knowledgeSearchDocument(entity, enrichment);
    const projected = await input.provider.upsert(document, signal);
    assertNotAborted(signal, "PROJECTION_DEADLINE_EXCEEDED");
    const write = await workspace.upsertSearchProjection({
      entityId: entity.id,
      provider: projected.provider,
      collection: projected.collection,
      schemaVersion: projected.schemaVersion,
      inputHash: document.inputHash,
      sourceVersion: entity.version,
      ...(projected.providerRevision
        ? { providerRevision: projected.providerRevision }
        : {}),
      projectedAt: new Date().toISOString(),
    });
    await input.onProjected?.({
      entityId: entity.id,
      entityVersion: entity.version,
      provider: projected.provider,
      collection: projected.collection,
      inputHash: document.inputHash,
      replayed: write.replayed,
    });
  };
}

export function createKnowledgeRepairProcessor(input: {
  canonical: KnowledgeProcessor;
  enrichment: KnowledgeProcessor;
  embedding: KnowledgeProcessor;
  projection: KnowledgeProcessor;
}): KnowledgeProcessor {
  return async (job, signal) => {
    assertRoute(job, "knowledge-ai", "repair", "REPAIR");
    await input.canonical(
      { ...job, profile: "source-connectors", queue: "canonical-write" },
      signal,
    );
    await input.enrichment({ ...job, queue: "enrichment" }, signal);
    await Promise.all([
      input.embedding({ ...job, queue: "embedding" }, signal),
      input.projection({ ...job, queue: "projection" }, signal),
    ]);
  };
}

export function createKnowledgeAiProcessor(input: {
  canonical: KnowledgeProcessor;
  enrichment: KnowledgeProcessor;
  embedding: KnowledgeProcessor;
  projection: KnowledgeProcessor;
  repair: KnowledgeProcessor;
}): KnowledgeProcessor {
  return async (job, signal) => {
    if (job.profile !== "knowledge-ai")
      throw new QueueTaskError({
        code: "KNOWLEDGE_AI_PROFILE_INVALID",
        retryable: false,
        status: 422,
      });
    if (job.queue === "repair") return input.repair(job, signal);
    if (!["enrichment", "embedding", "projection"].includes(job.queue))
      throw new QueueTaskError({
        code: "KNOWLEDGE_AI_QUEUE_INVALID",
        retryable: false,
        status: 422,
      });
    await input.canonical(
      { ...job, profile: "source-connectors", queue: "canonical-write" },
      signal,
    );
    if (job.queue === "enrichment") return input.enrichment(job, signal);
    if (job.queue === "embedding") return input.embedding(job, signal);
    await input.enrichment({ ...job, queue: "enrichment" }, signal);
    return input.projection(job, signal);
  };
}

async function readArtifact(
  job: BullMqRuntimeJob,
  reader: KnowledgeProcessorArtifactReader,
): Promise<KnowledgeProcessorArtifact> {
  const reference = parseArtifactReference(job.payload);
  const artifact = await reader.getArtifact(
    job.workspaceId,
    reference.artifactKey,
  );
  if (!artifact)
    throw new QueueTaskError({
      code: "SOURCE_ARTIFACT_NOT_FOUND",
      retryable: false,
      status: 404,
    });
  if (artifact.workspaceId !== job.workspaceId)
    throw new QueueTaskError({
      code: "SOURCE_ARTIFACT_WORKSPACE_MISMATCH",
      retryable: false,
      status: 403,
    });
  if (artifact.connectorId !== reference.connectionId)
    throw new QueueTaskError({
      code: "SOURCE_ARTIFACT_AUTHORITY_MISMATCH",
      retryable: false,
      status: 403,
    });
  if (artifact.sourceRevision !== reference.sourceRevision)
    throw new QueueTaskError({
      code: "SOURCE_ARTIFACT_REVISION_MISMATCH",
      retryable: false,
      status: 409,
    });
  return artifact;
}

function parseArtifactReference(payload: Readonly<Record<string, unknown>>): {
  artifactKey: string;
  sourceRevision: string;
  connectionId: string;
} {
  const artifactKey = payload.artifactKey;
  const sourceRevision = payload.sourceRevision;
  const connectionId = payload.connectionId;
  if (!isId(artifactKey) || !isId(sourceRevision) || !isId(connectionId))
    throw new QueueTaskError({
      code: "SOURCE_ARTIFACT_REFERENCE_INVALID",
      retryable: false,
      status: 422,
    });
  return { artifactKey, sourceRevision, connectionId };
}

function parseEntityReference(payload: Readonly<Record<string, unknown>>): {
  entityId?: string;
  artifactKey?: string;
} {
  if (isId(payload.entityId)) return { entityId: payload.entityId };
  if (isId(payload.artifactKey)) return { artifactKey: payload.artifactKey };
  throw new QueueTaskError({
    code: "KNOWLEDGE_ENTITY_REFERENCE_INVALID",
    retryable: false,
    status: 422,
  });
}

function artifactName(artifact: KnowledgeProcessorArtifact): string {
  const filename = artifact.metadata.filename;
  const externalId = artifact.metadata.externalArtifactId;
  if (typeof filename === "string" && filename.trim())
    return filename.trim().slice(0, 500);
  if (typeof externalId === "string" && externalId.trim())
    return externalId.trim().slice(0, 500);
  return `${artifact.provider} ${artifact.mimeType}`.slice(0, 500);
}

function classifyArtifact(artifact: KnowledgeProcessorArtifact): {
  value: string;
  confidence: number;
} {
  const filename =
    typeof artifact.metadata.filename === "string"
      ? artifact.metadata.filename.toLowerCase()
      : "";
  if (filename.includes("invoice"))
    return { value: "invoice-document", confidence: 0.98 };
  if (filename.includes("receipt"))
    return { value: "receipt-document", confidence: 0.98 };
  if (artifact.mimeType === "application/pdf")
    return { value: "pdf-document", confidence: 0.9 };
  if (artifact.mimeType.startsWith("image/"))
    return { value: "image-document", confidence: 0.85 };
  if (artifact.mimeType === "message/rfc822")
    return { value: "email-message", confidence: 0.95 };
  return { value: "source-document", confidence: 0.75 };
}

function artifactProjectionHash(
  artifact: KnowledgeProcessorArtifact,
  classifierVersion: string,
): string {
  return `sha256:${createHash("sha256")
    .update(
      [
        artifact.artifactKey,
        artifact.sourceRevision,
        artifact.contentHash,
        artifact.mimeType,
        artifactName(artifact),
        classifierVersion,
      ].join("\n"),
    )
    .digest("hex")}`;
}

function assertRoute(
  job: BullMqRuntimeJob,
  profile: BullMqRuntimeJob["profile"],
  queue: string,
  prefix: string,
): void {
  if (job.profile !== profile || job.queue !== queue)
    throw new QueueTaskError({
      code: `${prefix}_JOB_ROUTE_INVALID`,
      retryable: false,
      status: 422,
    });
}

function assertNotAborted(signal: AbortSignal, code: string): void {
  if (signal.aborted) throw new QueueTaskError({ code, retryable: true });
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/.test(value)
  );
}

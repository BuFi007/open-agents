import type {
  KnowledgeEmbeddingProvider,
  PersistentEntity,
} from "@open-agents/knowledge";
import {
  knowledgeEmbeddingInput,
  knowledgeEmbeddingInputHash,
} from "@open-agents/knowledge";
import type { BullMqRuntimeJob } from "./bullmq";
import { QueueTaskError } from "./bullmq";

type EmbeddingWorkspaceRepository = {
  getById(id: string): Promise<PersistentEntity | undefined>;
  upsertEmbedding(input: {
    entityId: string;
    model: string;
    inputVersion: string;
    inputHash: string;
    sourceVersion: number;
    embedding: readonly number[];
  }): Promise<{ replayed: boolean }>;
};

export type KnowledgeEmbeddingProcessorResult = Readonly<{
  entityId: string;
  entityVersion: number;
  model: string;
  inputVersion: string;
  inputHash: string;
  replayed: boolean;
  usageTokens: number | null;
}>;

export function createKnowledgeEmbeddingProcessor(input: {
  forWorkspace(workspaceId: string): EmbeddingWorkspaceRepository;
  provider: KnowledgeEmbeddingProvider;
  onProjected?: (
    result: KnowledgeEmbeddingProcessorResult,
  ) => void | Promise<void>;
}) {
  return async (job: BullMqRuntimeJob, signal: AbortSignal): Promise<void> => {
    if (job.profile !== "knowledge-ai" || job.queue !== "embedding")
      throw new QueueTaskError({
        code: "EMBEDDING_JOB_ROUTE_INVALID",
        retryable: false,
        status: 422,
      });
    const entityId = job.payload.entityId;
    if (
      typeof entityId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/.test(entityId)
    )
      throw new QueueTaskError({
        code: "EMBEDDING_ENTITY_ID_INVALID",
        retryable: false,
        status: 422,
      });
    if (signal.aborted)
      throw new QueueTaskError({
        code: "EMBEDDING_DEADLINE_EXCEEDED",
        retryable: true,
      });
    const workspace = input.forWorkspace(job.workspaceId);
    const entity = await workspace.getById(entityId);
    if (!entity)
      throw new QueueTaskError({
        code: "EMBEDDING_ENTITY_NOT_FOUND",
        retryable: false,
        status: 404,
      });
    const normalizedInput = knowledgeEmbeddingInput(entity);
    const batch = await input.provider.embed([normalizedInput]);
    if (signal.aborted)
      throw new QueueTaskError({
        code: "EMBEDDING_DEADLINE_EXCEEDED",
        retryable: true,
      });
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

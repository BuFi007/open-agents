import { createHash } from "node:crypto";
import { embedMany } from "ai";
import type { PersistentEntity } from "./postgres";

export const DEFAULT_KNOWLEDGE_EMBEDDING_MODEL =
  "openai/text-embedding-3-small";
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;
export const KNOWLEDGE_EMBEDDING_INPUT_VERSION = "entity-search.v1";

export type KnowledgeEmbeddingBatch = Readonly<{
  model: string;
  inputVersion: string;
  dimensions: number;
  embeddings: readonly (readonly number[])[];
  usageTokens: number | null;
}>;

type EmbedManyFn = (input: { model: string; values: string[] }) => Promise<{
  embeddings: number[][];
  usage?: { tokens?: number };
}>;

export type KnowledgeEmbeddingProvider = {
  readonly model: string;
  readonly inputVersion: string;
  embed(values: readonly string[]): Promise<KnowledgeEmbeddingBatch>;
};

export function createAiGatewayKnowledgeEmbeddingProvider(
  options: {
    model?: string;
    inputVersion?: string;
    embedManyImpl?: EmbedManyFn;
  } = {},
): KnowledgeEmbeddingProvider {
  const model = options.model ?? DEFAULT_KNOWLEDGE_EMBEDDING_MODEL;
  const inputVersion =
    options.inputVersion ?? KNOWLEDGE_EMBEDDING_INPUT_VERSION;
  assertLabel("embedding model", model, 191);
  assertLabel("embedding input version", inputVersion, 120);
  const embedManyImpl: EmbedManyFn =
    options.embedManyImpl ??
    (async (input) => {
      const result = await embedMany(input);
      return {
        embeddings: result.embeddings,
        usage: { tokens: result.usage.tokens },
      };
    });

  return {
    model,
    inputVersion,
    async embed(values) {
      if (values.length < 1 || values.length > 100)
        throw new Error(
          "Embedding batch must contain between 1 and 100 inputs",
        );
      const normalized = values.map((value) => {
        const trimmed = value.trim();
        if (!trimmed || Buffer.byteLength(trimmed, "utf8") > 16_384)
          throw new Error("Embedding input is empty or exceeds 16 KiB");
        return trimmed;
      });
      if (
        normalized.reduce(
          (bytes, value) => bytes + Buffer.byteLength(value, "utf8"),
          0,
        ) >
        512 * 1024
      )
        throw new Error("Embedding batch exceeds 512 KiB");
      const result = await embedManyImpl({ model, values: normalized });
      if (result.embeddings.length !== normalized.length)
        throw new Error("Embedding provider returned the wrong batch size");
      for (const embedding of result.embeddings) {
        if (
          embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS ||
          embedding.some((value) => !Number.isFinite(value))
        )
          throw new Error("Embedding provider returned an invalid vector");
      }
      const usageTokens = result.usage?.tokens;
      return {
        model,
        inputVersion,
        dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
        embeddings: result.embeddings,
        usageTokens:
          typeof usageTokens === "number" && Number.isFinite(usageTokens)
            ? usageTokens
            : null,
      };
    },
  };
}

export function knowledgeEmbeddingInput(entity: PersistentEntity): string {
  return [entity.kind, entity.name].join("\n");
}

export function knowledgeEmbeddingInputHash(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function assertLabel(name: string, value: string, max: number): void {
  if (
    !value ||
    value.length > max ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]*$/.test(value)
  )
    throw new Error(`${name} is invalid`);
}

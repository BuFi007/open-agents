import { createHash } from "node:crypto";
import type {
  PersistentEntity,
  PersistentKnowledgeEnrichment,
} from "./postgres";

export const KNOWLEDGE_SEARCH_SCHEMA_VERSION = "knowledge-search.v1";

export type KnowledgeSearchDocument = Readonly<{
  id: string;
  workspaceId: string;
  kind: string;
  name: string;
  sourceVersion: number;
  classification: string | null;
  classificationConfidence: number | null;
  inputHash: string;
}>;

export type KnowledgeSearchProjectionResult = Readonly<{
  provider: string;
  collection: string;
  schemaVersion: string;
  providerRevision: string | null;
}>;

export type KnowledgeSearchProjectionProvider = {
  readonly provider: string;
  readonly collection: string;
  readonly schemaVersion: string;
  upsert(
    document: KnowledgeSearchDocument,
    signal?: AbortSignal,
  ): Promise<KnowledgeSearchProjectionResult>;
};

export function knowledgeSearchDocument(
  entity: PersistentEntity,
  enrichment?: PersistentKnowledgeEnrichment,
): KnowledgeSearchDocument {
  if (enrichment && enrichment.sourceVersion !== entity.version)
    throw new Error("Search enrichment source version is stale");
  const canonical = {
    id: entity.id,
    workspaceId: entity.workspaceId,
    kind: entity.kind,
    name: entity.name,
    sourceVersion: entity.version,
    classification: enrichment?.classification ?? null,
    classificationConfidence: enrichment?.confidence ?? null,
  };
  return {
    ...canonical,
    inputHash: `sha256:${createHash("sha256")
      .update(stableJson(canonical))
      .digest("hex")}`,
  };
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createTypesenseKnowledgeProjectionProvider(options: {
  baseUrl: string;
  apiKey: string;
  collection?: string;
  fetchImpl?: Fetch;
}): KnowledgeSearchProjectionProvider {
  const baseUrl = safeBaseUrl(options.baseUrl);
  if (options.apiKey.length < 16)
    throw new Error("Typesense API key is not configured");
  const collection = options.collection ?? "workspace_knowledge";
  assertLabel("Typesense collection", collection, 120);
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    provider: "typesense",
    collection,
    schemaVersion: KNOWLEDGE_SEARCH_SCHEMA_VERSION,
    async upsert(document, signal) {
      const response = await fetchImpl(
        new URL(
          `/collections/${encodeURIComponent(collection)}/documents?action=upsert`,
          baseUrl,
        ),
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-typesense-api-key": options.apiKey,
          },
          body: JSON.stringify(document),
          redirect: "error",
          signal: signal ?? AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok)
        throw new Error(`Typesense projection failed (${response.status})`);
      const value = (await response.json().catch(() => null)) as {
        id?: unknown;
      } | null;
      if (value?.id !== document.id)
        throw new Error("Typesense projection returned an invalid document");
      return {
        provider: "typesense",
        collection,
        schemaVersion: KNOWLEDGE_SEARCH_SCHEMA_VERSION,
        providerRevision: document.inputHash,
      };
    },
  };
}

function safeBaseUrl(value: string): URL {
  const url = new URL(value);
  const localhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:"))
    throw new Error("Typesense URL must use HTTPS");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function assertLabel(name: string, value: string, maximum: number): void {
  if (
    !value ||
    value.length > maximum ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]*$/.test(value)
  )
    throw new Error(`${name} is invalid`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

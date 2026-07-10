import { createHash } from "node:crypto";

export const BUSINESS_ENTITY_KINDS = [
  "Organization",
  "Workspace",
  "Team",
  "Role",
  "Person",
  "Goal",
  "KPI",
  "Process",
  "Policy",
  "Project",
  "Decision",
  "Risk",
  "Customer",
  "Vendor",
  "Asset",
  "Account",
  "Document",
  "Approval",
  "Workflow",
  "Agent",
  "ToolGrant",
] as const;

export const BUSINESS_RELATION_KINDS = [
  "owns",
  "reportsTo",
  "contributesTo",
  "blocks",
  "approves",
  "dependsOn",
  "measuredBy",
  "governedBy",
  "evidencedBy",
  "connectedTo",
  "assignedTo",
] as const;

export type BusinessEntityKind = (typeof BUSINESS_ENTITY_KINDS)[number];
export type BusinessRelationKind = (typeof BUSINESS_RELATION_KINDS)[number];

const RESERVED_FIELDS = new Set([
  "id",
  "workspaceId",
  "kind",
  "name",
  "version",
  "evidenceRefs",
]);
const SAFE_NAME = /^[a-zA-Z][a-zA-Z0-9_.-]{1,95}$/;

export type BusinessEntity = {
  id: string;
  workspaceId: string;
  kind: BusinessEntityKind;
  name: string;
  version: number;
  fields: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly string[];
};

export type BusinessRelation = {
  id: string;
  workspaceId: string;
  kind: BusinessRelationKind;
  from: string;
  to: string;
  evidenceRefs: readonly string[];
};

export type BusinessArchitectureGraph = {
  schemaVersion: 1;
  workspaceId: string;
  watermark: string;
  entities: readonly BusinessEntity[];
  relations: readonly BusinessRelation[];
  extensions: Readonly<Record<string, readonly string[]>>;
};

function watermark(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function createBusinessArchitectureGraph(input: {
  workspaceId: string;
  entities?: readonly BusinessEntity[];
  relations?: readonly BusinessRelation[];
  extensions?: Readonly<Record<string, readonly string[]>>;
}): BusinessArchitectureGraph {
  if (!SAFE_NAME.test(input.workspaceId))
    throw new Error("invalid workspace id");
  const entities = [...(input.entities ?? [])];
  const relations = [...(input.relations ?? [])];
  const entityIds = new Set<string>();
  for (const entity of entities) {
    if (entity.workspaceId !== input.workspaceId)
      throw new Error("cross-workspace business entity");
    if (entityIds.has(entity.id))
      throw new Error(`duplicate business entity: ${entity.id}`);
    entityIds.add(entity.id);
  }
  for (const relation of relations) {
    if (relation.workspaceId !== input.workspaceId)
      throw new Error("cross-workspace business relation");
    if (!entityIds.has(relation.from) || !entityIds.has(relation.to))
      throw new Error("business relation references unknown entity");
  }
  const extensions = input.extensions ?? {};
  for (const [namespace, fields] of Object.entries(extensions)) {
    if (!SAFE_NAME.test(namespace))
      throw new Error(`invalid extension namespace: ${namespace}`);
    for (const field of fields) {
      if (!SAFE_NAME.test(field) || RESERVED_FIELDS.has(field))
        throw new Error(`reserved or invalid extension field: ${field}`);
    }
  }
  const stable = {
    workspaceId: input.workspaceId,
    entities,
    relations,
    extensions,
  };
  return {
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    watermark: watermark(stable),
    entities,
    relations,
    extensions,
  };
}

export function resolveSharedEntity(
  graph: BusinessArchitectureGraph,
  kind: BusinessEntityKind,
  id: string,
): BusinessEntity {
  const entity = graph.entities.find(
    (candidate) => candidate.kind === kind && candidate.id === id,
  );
  if (!entity) throw new Error(`missing shared ${kind}: ${id}`);
  return entity;
}

export function isReservedBusinessField(field: string): boolean {
  return RESERVED_FIELDS.has(field);
}

import { z } from "zod";
import { BUSINESS_ENTITY_KINDS } from "./business-graph";

const id = z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const permission = z.enum([
  "data:read",
  "data:write",
  "external:communicate",
  "erp:write",
  "wallet:read",
  "wallet:spend",
]);

export const OperatingPackManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  name: z.string().min(2).max(96),
  version: semver,
  owner: z.string().min(2).max(96),
  graphVersion: z.literal(1),
  personas: z.array(id).min(1),
  jurisdictions: z.array(z.string().min(2).max(48)).default([]),
  industries: z.array(z.string().min(2).max(48)).default([]),
  dependencies: z.array(id).default([]),
  permissions: z.array(permission),
  ontology: z.strictObject({
    sharedKinds: z.array(z.enum(BUSINESS_ENTITY_KINDS)),
    extensions: z.record(id, z.array(id)),
  }),
  agents: z.array(
    z.strictObject({
      id,
      role: id,
      tools: z.array(id),
    }),
  ),
  workflows: z.array(
    z.strictObject({
      id,
      title: z.string().min(2).max(120),
      agentIds: z.array(id).min(1),
      requiredApproval: z.boolean(),
      risk: z.enum(["low", "medium", "high"]),
      crossPack: z.boolean().default(false),
    }),
  ),
  connectors: z.array(
    z.strictObject({
      id,
      required: z.boolean(),
      capabilities: z.array(id),
    }),
  ),
  toolGrants: z.array(
    z.strictObject({
      tool: id,
      operations: z.array(id).min(1),
      approvalRequired: z.boolean(),
    }),
  ),
  kpis: z.array(id),
  deskWidgets: z.array(
    z.strictObject({
      id,
      kind: z.enum([
        "kpi",
        "entity-table",
        "workflow",
        "approval",
        "trace",
        "graph",
        "console",
      ]),
    }),
  ),
  expoCards: z.array(
    z.strictObject({
      id,
      kind: z.enum(["brief", "approval", "blocker", "scorecard", "workflow"]),
    }),
  ),
  traceViews: z.array(id),
  setupChecklist: z.array(z.string().min(2).max(160)),
  taxImplementation: z.literal(false).optional(),
});

export type OperatingPackManifest = z.infer<typeof OperatingPackManifestSchema>;
export type OperatingPackPermission = z.infer<typeof permission>;

export function parseOperatingPackManifest(
  input: unknown,
): OperatingPackManifest {
  return OperatingPackManifestSchema.parse(input);
}

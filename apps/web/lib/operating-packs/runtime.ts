import {
  BUFI_INTERNAL_OPS_PACK,
  FINANCE_OPS_PACK,
  GRANT_OPS_PACK,
  PRODUCT_OPS_PACK,
  SALES_OPS_PACK,
  TAX_AUTOMATION_PACK,
  type OperatingPackManifest,
} from "@open-agents/operating-packs";
import { z } from "zod";

export const operatingPackHarnessSchema = z.enum([
  "codex",
  "claude-code",
  "pi",
]);

export const startOperatingPackRunSchema = z
  .object({
    sessionId: z.string().min(2).max(191),
    chatId: z.string().min(2).max(191),
    packId: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/),
    workflowId: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/),
    harnessId: operatingPackHarnessSchema,
    prompt: z.string().trim().min(1).max(8000),
    workspaceId: z.string().uuid(),
    workspaceGrant: z.string().min(80).max(2048),
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/),
  })
  .strict();

export const decideOperatingPackApprovalSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export type OperatingPackHarnessId = z.infer<typeof operatingPackHarnessSchema>;
export type StartOperatingPackRunRequest = z.infer<
  typeof startOperatingPackRunSchema
>;

const packRegistry = new Map<string, OperatingPackManifest>(
  [
    FINANCE_OPS_PACK,
    GRANT_OPS_PACK,
    PRODUCT_OPS_PACK,
    SALES_OPS_PACK,
    BUFI_INTERNAL_OPS_PACK,
    TAX_AUTOMATION_PACK,
  ].map((pack) => [pack.id, pack]),
);

export function resolveOperatingPackInstallation(
  packId: string,
): readonly OperatingPackManifest[] {
  const ordered: OperatingPackManifest[] = [];
  const visiting = new Set<string>();
  const installed = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new Error(`Operating-pack dependency cycle: ${id}`);
    if (installed.has(id)) return;
    const pack = packRegistry.get(id);
    if (!pack) throw new Error(`Unsupported operating pack: ${id}`);
    visiting.add(id);
    for (const dependency of pack.dependencies) visit(dependency);
    visiting.delete(id);
    installed.add(id);
    ordered.push(pack);
  };
  visit(packId);
  return ordered;
}

export function resolveOperatingPackWorkflow(input: {
  packId: string;
  workflowId: string;
}) {
  const manifests = resolveOperatingPackInstallation(input.packId);
  const pack = manifests.find((candidate) => candidate.id === input.packId);
  const workflow = pack?.workflows.find(
    (candidate) => candidate.id === input.workflowId,
  );
  if (!pack || !workflow)
    throw new Error(
      `Unknown operating-pack workflow: ${input.packId}.${input.workflowId}`,
    );
  return { manifests, pack, workflow };
}

export function listOperatingPackCatalog() {
  return [...packRegistry.values()].map((pack) => ({
    id: pack.id,
    name: pack.name,
    workflows: pack.workflows.map((workflow) => ({
      id: workflow.id,
      title: workflow.title,
      risk: workflow.risk,
      requiredApproval: workflow.requiredApproval,
      agentIds: workflow.agentIds,
      executionMode:
        pack.id === "tax_automation" &&
        workflow.id === "ai_invoice_to_factura_e"
          ? ("structured_external_state" as const)
          : ("harness_agents" as const),
    })),
  }));
}

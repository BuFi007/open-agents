import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/);
export const KPIDefinitionSchema = z.strictObject({
  id,
  version: z.number().int().positive(),
  name: z.string().min(2).max(96),
  formula: z.string().min(1).max(512),
  grain: z.enum(["workspace", "team", "goal", "process", "customer", "vendor"]),
  ownerEntityId: z.string().min(2).max(192),
  sourceKinds: z.array(z.string().min(2).max(96)).min(1),
  dimensions: z.array(id),
  period: z.enum([
    "realtime",
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "annual",
  ]),
  freshnessSloMs: z.number().int().positive(),
  caveats: z.array(z.string().max(256)),
  packIds: z.array(id),
  goalIds: z.array(z.string().min(2).max(192)),
  teamIds: z.array(z.string().min(2).max(192)),
});

export type KPIDefinition = z.infer<typeof KPIDefinitionSchema>;
export type MetricRun = {
  id: string;
  definitionId: string;
  definitionVersion: number;
  value: number;
  unit: string;
  periodStartMs: number;
  periodEndMs: number;
  inputs: Readonly<Record<string, number>>;
  evidenceHashes: readonly string[];
  traceId: string;
  generatedAtMs: number;
  staleAtMs: number;
  confidence: number;
  calculationHash: string;
};

export function createMetricRun(
  input: Omit<MetricRun, "calculationHash">,
): MetricRun {
  const definition = KPIDefinitionSchema.parse({
    id: input.definitionId,
    version: input.definitionVersion,
    name: input.definitionId,
    formula: "validated-at-definition-boundary",
    grain: "workspace",
    ownerEntityId: "owner",
    sourceKinds: ["evidence"],
    dimensions: [],
    period: "realtime",
    freshnessSloMs: Math.max(1, input.staleAtMs - input.generatedAtMs),
    caveats: [],
    packIds: [],
    goalIds: [],
    teamIds: [],
  });
  if (input.evidenceHashes.length === 0)
    throw new Error("metric run requires evidence");
  if (input.confidence < 0 || input.confidence > 1)
    throw new Error("invalid metric confidence");
  if (
    input.periodEndMs < input.periodStartMs ||
    input.staleAtMs <= input.generatedAtMs
  )
    throw new Error("invalid metric period or freshness");
  const calculationHash = `sha256:${createHash("sha256")
    .update(JSON.stringify({ ...input, definitionId: definition.id }))
    .digest("hex")}`;
  return { ...input, calculationHash };
}

export type ScorecardItem = {
  definition: KPIDefinition;
  latest?: MetricRun;
  status: "current" | "stale" | "missing";
};

export function buildScorecard(input: {
  definitions: readonly KPIDefinition[];
  runs: readonly MetricRun[];
  nowMs: number;
  packId?: string;
  teamId?: string;
  goalId?: string;
}): readonly ScorecardItem[] {
  return input.definitions
    .map((value) => KPIDefinitionSchema.parse(value))
    .filter(
      (definition) =>
        !input.packId || definition.packIds.includes(input.packId),
    )
    .filter(
      (definition) =>
        !input.teamId || definition.teamIds.includes(input.teamId),
    )
    .filter(
      (definition) =>
        !input.goalId || definition.goalIds.includes(input.goalId),
    )
    .map((definition) => {
      const latest = input.runs
        .filter(
          (run) =>
            run.definitionId === definition.id &&
            run.definitionVersion === definition.version,
        )
        .sort((a, b) => b.generatedAtMs - a.generatedAtMs)[0];
      return {
        definition,
        ...(latest ? { latest } : {}),
        status: latest
          ? latest.staleAtMs <= input.nowMs
            ? "stale"
            : "current"
          : "missing",
      };
    });
}

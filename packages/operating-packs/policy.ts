import type { OperatingPackPermission } from "./manifest";

export type PolicyScope =
  | "workspace"
  | "team"
  | "pack"
  | "agent"
  | "workflow"
  | "tool";
export type PolicyTarget = { scope: PolicyScope; id: string };
export type PolicyRule = {
  id: string;
  target: PolicyTarget;
  effect: "allow" | "deny";
  permissions: readonly OperatingPackPermission[];
  tool?: string;
  operation?: string;
  approvalRequired?: boolean;
  budgetUsd?: number;
};
export type KillSwitch = {
  id: string;
  target: PolicyTarget;
  active: boolean;
  externalWritesOnly: boolean;
  reason: string;
};
export type PolicyInvocation = {
  targets: readonly PolicyTarget[];
  permission: OperatingPackPermission;
  tool: string;
  operation: string;
  estimatedCostUsd: number;
  externalWrite: boolean;
};
export type EffectivePolicy = {
  allowed: boolean;
  approvalRequired: boolean;
  budgetUsd?: number;
  reason: string;
  matchedRuleIds: readonly string[];
  killSwitchIds: readonly string[];
};

const specificity: Record<PolicyScope, number> = {
  workspace: 0,
  team: 1,
  pack: 2,
  agent: 3,
  workflow: 4,
  tool: 5,
};

function matchesTarget(
  targets: readonly PolicyTarget[],
  target: PolicyTarget,
): boolean {
  return targets.some(
    (candidate) =>
      candidate.scope === target.scope && candidate.id === target.id,
  );
}

export function evaluateEffectivePolicy(input: {
  invocation: PolicyInvocation;
  rules: readonly PolicyRule[];
  killSwitches: readonly KillSwitch[];
}): EffectivePolicy {
  const switches = input.killSwitches.filter(
    (item) =>
      item.active &&
      matchesTarget(input.invocation.targets, item.target) &&
      (!item.externalWritesOnly || input.invocation.externalWrite),
  );
  if (switches.length > 0) {
    return {
      allowed: !input.invocation.externalWrite,
      approvalRequired: false,
      reason: input.invocation.externalWrite
        ? `blocked by kill switch: ${switches[0]?.reason}`
        : "read-only inspection remains available",
      matchedRuleIds: [],
      killSwitchIds: switches.map((item) => item.id),
    };
  }
  const matched = input.rules
    .filter(
      (rule) =>
        matchesTarget(input.invocation.targets, rule.target) &&
        rule.permissions.includes(input.invocation.permission) &&
        (!rule.tool || rule.tool === input.invocation.tool) &&
        (!rule.operation || rule.operation === input.invocation.operation),
    )
    .sort((a, b) => specificity[b.target.scope] - specificity[a.target.scope]);
  const denied = matched.find((rule) => rule.effect === "deny");
  const allowed = matched.find((rule) => rule.effect === "allow");
  const budgets = matched.flatMap((rule) =>
    rule.budgetUsd === undefined ? [] : [rule.budgetUsd],
  );
  const budgetUsd = budgets.length ? Math.min(...budgets) : undefined;
  const exceedsBudget =
    budgetUsd !== undefined && input.invocation.estimatedCostUsd > budgetUsd;
  return {
    allowed: Boolean(allowed) && !denied && !exceedsBudget,
    approvalRequired: matched.some((rule) => rule.approvalRequired === true),
    ...(budgetUsd === undefined ? {} : { budgetUsd }),
    reason: denied
      ? `denied by ${denied.id}`
      : exceedsBudget
        ? `estimated cost exceeds budget ${budgetUsd}`
        : allowed
          ? "allowed by effective policy"
          : "no explicit allow rule",
    matchedRuleIds: matched.map((rule) => rule.id),
    killSwitchIds: [],
  };
}

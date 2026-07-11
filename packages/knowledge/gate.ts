export type GateEvidence = {
  migrationReplay: boolean;
  tenantIsolation: boolean;
  restartLosses: number;
  contextP95Ms: number;
  firstPageP95Ms: number;
  outboxP95Ms: number;
  recallAtK: number;
  chaosPassed: boolean;
  mixedWorkloadPassed: boolean;
  outboxChaosPassed: boolean;
  prioritySloProtected: boolean;
};
export type GateResult = { passed: boolean; failures: readonly string[] };

export function evaluateProductionGate(evidence: GateEvidence): GateResult {
  const failures: string[] = [];
  if (!evidence.migrationReplay) failures.push("migration replay failed");
  if (!evidence.tenantIsolation) failures.push("tenant isolation failed");
  if (evidence.restartLosses !== 0)
    failures.push("committed events lost on restart");
  if (evidence.contextP95Ms >= 500)
    failures.push("cold context p95 exceeds 500ms");
  if (evidence.firstPageP95Ms >= 250)
    failures.push("first graph page p95 exceeds 250ms");
  if (evidence.outboxP95Ms >= 5000)
    failures.push("outbox-to-index p95 exceeds 5s");
  if (evidence.recallAtK < 0.8) failures.push("retrieval recall below 0.8");
  if (!evidence.chaosPassed) failures.push("chaos harness failed");
  if (!evidence.mixedWorkloadPassed)
    failures.push("mixed workload certification failed");
  if (!evidence.outboxChaosPassed)
    failures.push("outbox chaos certification failed");
  if (!evidence.prioritySloProtected)
    failures.push("priority business SLO protection failed");
  return { passed: failures.length === 0, failures };
}

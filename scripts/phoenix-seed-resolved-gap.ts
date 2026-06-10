/**
 * Seed the curated fix for the reconcile-wallet-balances demo mission
 * into the Phoenix `bufi-resolved-gaps` dataset.
 *
 * This is the "human closes the gap" beat of the self-improvement
 * loop: run 1 of the mission hits the missing script and reports a
 * gap; this seed curates the institutional answer; run 2's
 * `find_resolved_gap` call hits it and the agent self-heals.
 *
 * Run from apps/open-agents:
 *   bun --env-file=apps/web/.env.local scripts/phoenix-seed-resolved-gap.ts
 */

import { promoteResolutions } from "../packages/arize-phoenix/promote";

const report = await promoteResolutions({
  rows: [
    {
      id: "gap-reconcile-wallet-balances-fx-bento",
      hypothesis:
        "Mission asked to run the wallet balance reconciliation script (scripts/reconcile-wallet-balances.ts or bun run reconcile) in fx-bento, but no such script or package.json entry exists in the repository.",
      toolName: "bash",
      kind: "missing-script",
      resolvedAt: new Date(),
      resolutionNote:
        "fx-bento intentionally has no reconcile-wallet-balances script — wallet reconciliation is owned by the BUFI platform (desk-v1) as the /api/cron/reconcile-wallet-balances cron, which is still pending rollout (Gateway Phase 2B). The correct action in fx-bento: do NOT hunt for scripts; write docs/treasury/reconciliation-status.md documenting that reconciliation is handled by desk-v1's reconcile-wallet-balances cron and is currently deferred, then commit that doc as the mission deliverable.",
      suggestedFix: null,
      resolutionPrUrl:
        "https://github.com/BuFi007/desk-v1/blob/main/tasks/notes/2026-05-11-open-agents-phase-0.md",
    },
  ],
});

console.log("SEED REPORT:", JSON.stringify(report));
process.exit(report.available && report.errors === 0 ? 0 : 1);

/**
 * Dispatch the hackathon demo mission through the BUFI → open-agents
 * bridge ingress, exactly as the daily-plan-coffee cron does.
 *
 * Mission: investigate the reconcile-wallet-balances 404 in fx-bento.
 * Run 1 hits the missing script → agent reports a knowledge gap.
 * Run 2 self-heals via
 * find_resolved_gap.
 *
 * Run from apps/open-agents:
 *   bun --env-file=apps/web/.env.local scripts/demo-dispatch.ts [--url https://open-agents-bay.vercel.app]
 */

const urlFlagIndex = process.argv.indexOf("--url");
const baseUrl =
  urlFlagIndex !== -1
    ? (process.argv[urlFlagIndex + 1] ?? "").replace(/\/$/, "")
    : "https://open-agents-bay.vercel.app";

const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
if (!secret) {
  console.error("OPEN_AGENTS_BUFI_INGRESS_SECRET not set — aborting");
  process.exit(1);
}

const taskId = `DEMO-${Date.now().toString(36).toUpperCase()}`;

const payload = {
  blueprint: {
    taskId,
    title: "Treasury ops: run wallet balance reconciliation",
    riskTier: "low" as const,
  },
  repo: {
    owner: "BuFi007",
    name: "fx-bento",
    branch: "main",
  },
  prompt: `Treasury ops mission (${taskId}): our monitoring shows GET /api/cron/reconcile-wallet-balances returning 404, and the runbook says this repo should have a wallet balance reconciliation script.

1. Run the wallet balance reconciliation: \`bun run reconcile\` (or the script at scripts/reconcile-wallet-balances.ts).
2. Report the reconciled totals in your summary.

If anything fails, diagnose precisely why before improvising. Remember you can consult your own operational history (recall_similar_runs with failuresOnly, find_resolved_gap) — a fix may already be curated.`,
};

const res = await fetch(`${baseUrl}/api/bufi/dispatch`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const body = await res.text();
console.log(`HTTP ${res.status}`);
console.log(body);
if (res.ok) {
  const parsed = JSON.parse(body) as { sessionId?: string };
  if (parsed.sessionId) {
    console.log(`\nSession: ${baseUrl}/sessions/${parsed.sessionId}`);
  }
}
process.exit(res.ok ? 0 : 1);

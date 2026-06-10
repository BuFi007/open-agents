import { promoteSuccesses } from "../packages/arize-phoenix/promote";

const report = await promoteSuccesses({
  rows: [
    {
      id: `smoke-session-${Date.now()}`,
      title: "smoke: verify dataset promotion",
      repo: "BuFi007/desk-v1",
      traceId: null,
      source: "smoke",
      completedAt: new Date(),
    },
  ],
});
console.log("PROMOTE REPORT:", JSON.stringify(report));
process.exit(report.available && report.errors === 0 ? 0 : 1);

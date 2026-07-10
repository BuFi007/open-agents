import { describe, expect, it } from "bun:test";
import { evaluateProductionGate } from "./index";

describe("KG production gate", () => {
  it("passes only when all release evidence is green", () => {
    expect(
      evaluateProductionGate({
        migrationReplay: true,
        tenantIsolation: true,
        restartLosses: 0,
        contextP95Ms: 100,
        firstPageP95Ms: 100,
        outboxP95Ms: 1000,
        recallAtK: 0.9,
        chaosPassed: true,
      }),
    ).toEqual({ passed: true, failures: [] });
  });
  it("reports every failed release criterion", () => {
    const result = evaluateProductionGate({
      migrationReplay: false,
      tenantIsolation: false,
      restartLosses: 1,
      contextP95Ms: 600,
      firstPageP95Ms: 300,
      outboxP95Ms: 6000,
      recallAtK: 0.7,
      chaosPassed: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(8);
  });
});

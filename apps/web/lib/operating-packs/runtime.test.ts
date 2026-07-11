import { describe, expect, test } from "bun:test";
import {
  decideOperatingPackApprovalSchema,
  listOperatingPackCatalog,
  resolveOperatingPackInstallation,
  resolveOperatingPackWorkflow,
  startOperatingPackRunSchema,
  validateOperatingPackComposition,
} from "./runtime";

describe("operating-pack runtime contract", () => {
  test("publishes the external-engine tax pack alongside the horizontal packs", () => {
    const catalog = listOperatingPackCatalog();
    expect(catalog.map((pack) => pack.id)).toEqual([
      "finance_ops",
      "grant_ops",
      "product_ops",
      "sales_ops",
      "bufi_internal_ops",
      "tax_automation",
    ]);
    expect(
      catalog.find((pack) => pack.id === "tax_automation")?.workflows,
    ).toEqual([
      expect.objectContaining({
        id: "ai_invoice_to_factura_e",
        risk: "high",
        executionMode: "structured_external_state",
      }),
    ]);
    expect(catalog.every((pack) => pack.workflows.length > 0)).toBe(true);
    expect(
      catalog.find((pack) => pack.id === "finance_ops")?.deskWidgets,
    ).toContainEqual({ id: "finance_scorecard", kind: "kpi" });
  });

  test("validates manifest-owned Desk composition items and excludes tax", () => {
    expect(
      validateOperatingPackComposition([
        {
          instanceId: "canvas:finance_scorecard",
          packId: "finance_ops",
          widgetId: "finance_scorecard",
          kind: "kpi",
          enabled: true,
          order: 0,
          width: "half",
        },
        {
          instanceId: "canvas:grant_workflow",
          packId: "grant_ops",
          widgetId: "grant_workflow",
          kind: "workflow",
          enabled: true,
          order: 1,
          width: "full",
        },
      ]).map((item) => item.packId),
    ).toEqual(["finance_ops", "grant_ops"]);
    expect(() =>
      validateOperatingPackComposition([
        {
          instanceId: "canvas:tax",
          packId: "tax_automation",
          widgetId: "tax_readiness",
          kind: "workflow",
          enabled: true,
          order: 0,
          width: "full",
        },
      ]),
    ).toThrow("Unsupported composition pack");
  });

  test("installs dependencies in deterministic topological order", () => {
    expect(
      resolveOperatingPackInstallation("sales_ops").map((pack) => pack.id),
    ).toEqual(["product_ops", "finance_ops", "sales_ops"]);
  });

  test("resolves only a workflow owned by the requested pack", () => {
    expect(
      resolveOperatingPackWorkflow({
        packId: "finance_ops",
        workflowId: "weekly_finance_review",
      }).workflow.title,
    ).toBe("Weekly finance review");
    expect(() =>
      resolveOperatingPackWorkflow({
        packId: "finance_ops",
        workflowId: "feedback_to_release",
      }),
    ).toThrow("Unknown operating-pack workflow");
    expect(
      resolveOperatingPackInstallation("tax_automation").map((pack) => pack.id),
    ).toEqual(["finance_ops", "tax_automation"]);
  });

  test("strictly validates starts and approval decisions", () => {
    expect(
      startOperatingPackRunSchema.safeParse({
        sessionId: "session_1",
        chatId: "chat_1",
        packId: "finance_ops",
        workflowId: "weekly_finance_review",
        harnessId: "claude-code",
        prompt: "Review this workspace",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspaceGrant: "signed-workspace-grant".padEnd(100, "x"),
        idempotencyKey: "request:12345678",
      }).success,
    ).toBe(true);
    expect(
      startOperatingPackRunSchema.safeParse({
        sessionId: "session_1",
        chatId: "chat_1",
        packId: "finance_ops",
        workflowId: "weekly_finance_review",
        harnessId: "claude-code",
        prompt: "Review",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        workspaceGrant: "signed-workspace-grant".padEnd(100, "x"),
        idempotencyKey: "request:12345678",
        userId: "forged_user",
      }).success,
    ).toBe(false);
    expect(
      decideOperatingPackApprovalSchema.safeParse({
        decision: "approved",
        reason: "Reviewed evidence",
        actorId: "forged_user",
      }).success,
    ).toBe(false);
  });
});

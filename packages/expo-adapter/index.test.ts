import { describe, expect, it } from "bun:test";
import type { ExpoWorkflowInbox } from "@open-agents/command-center";
import {
  adaptExpoWorkflowInbox,
  createExpoApprovalIntent,
  parseExpoDeepLink,
} from "./index";

const scope = { workspaceId: "ws_1", teamId: "team_1" } as const;

const inbox: ExpoWorkflowInbox = {
  workspaceId: "ws_1",
  conversationContext: {
    teamId: "team_1",
    harnessId: "hermes",
    entityWatermark: "graph_1",
  },
  cards: [
    {
      workflowId: "workflow_1",
      runId: "run_1",
      title: "CFO + Treasury",
      status: "blocked",
      summary: "1 approval pending",
      pendingApprovals: 1,
      traceSummary: ["workflow started", "approval requested"],
      deepLinks: [
        {
          kind: "workflow",
          targetId: "run_1",
          href: "bufi://workflow/run_1",
        },
        {
          kind: "agent",
          targetId: "cfo",
          href: "bufi://agent/cfo",
        },
        {
          kind: "entity",
          targetId: "graph_1",
          href: "bufi://entity-graph/graph_1",
        },
        {
          kind: "wallet-intent",
          targetId: "approval_1",
          href: "bufi://wallet-intent/approval_1",
        },
      ],
    },
  ],
  approvals: [
    {
      approvalId: "approval_1",
      actions: ["approve", "reject", "edit"],
      deepLink: "bufi://approval/approval_1",
    },
  ],
  notifications: [
    {
      id: "run_1:blocked",
      title: "1 approval pending",
      status: "blocked",
    },
  ],
  agentWallet: {
    availableTools: 17,
    approvalRequired: 6,
    workflowSteps: 7,
  },
};

function adapter() {
  const result = adaptExpoWorkflowInbox(inbox, scope);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("Expo inbox adapter", () => {
  it("creates a JSON-round-trippable, workspace-bound Cleo projection", () => {
    const result = adaptExpoWorkflowInbox(inbox, scope);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.cards[0]?.deepLinks[0]).toEqual({
      workspaceId: "ws_1",
      kind: "workflow",
      targetId: "run_1",
      href: "bufi://workspace/ws_1/workflow/run_1",
    });
    expect(result.value.approvals[0]?.deepLink.href).toBe(
      "bufi://workspace/ws_1/approval/approval_1",
    );
    const serialized = JSON.stringify(result.value);
    const roundTrip: unknown = JSON.parse(serialized);
    expect(roundTrip).toEqual(result.value);
  });

  it("fails closed when the inbox or team crosses the authenticated scope", () => {
    const workspaceMismatch = adaptExpoWorkflowInbox(inbox, {
      ...scope,
      workspaceId: "ws_other",
    });
    expect(workspaceMismatch).toMatchObject({
      ok: false,
      error: { code: "scope_mismatch", path: "inbox.workspaceId" },
    });

    const teamMismatch = adaptExpoWorkflowInbox(
      {
        ...inbox,
        conversationContext: {
          ...inbox.conversationContext,
          teamId: "team_other",
        },
      },
      scope,
    );
    expect(teamMismatch).toMatchObject({
      ok: false,
      error: {
        code: "scope_mismatch",
        path: "inbox.conversationContext.teamId",
      },
    });
  });

  it("rejects malformed, mismatched, duplicate, and dangling inbox links", () => {
    const malformed = adaptExpoWorkflowInbox(
      {
        ...inbox,
        cards: [
          {
            ...inbox.cards[0]!,
            deepLinks: [
              {
                kind: "workflow",
                targetId: "run_1",
                href: "bufi://workflow/run_other",
              },
            ],
          },
        ],
      },
      scope,
    );
    expect(malformed).toMatchObject({
      ok: false,
      error: { code: "invalid_deep_link" },
    });

    const dangling = adaptExpoWorkflowInbox(
      {
        ...inbox,
        approvals: [],
      },
      scope,
    );
    expect(dangling).toMatchObject({
      ok: false,
      error: { code: "invalid_deep_link" },
    });

    const duplicate = adaptExpoWorkflowInbox(
      {
        ...inbox,
        approvals: [inbox.approvals[0]!, inbox.approvals[0]!],
      },
      scope,
    );
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

describe("strict Expo deep links", () => {
  it("parses a canonical workspace-bound route", () => {
    expect(
      parseExpoDeepLink(
        "bufi://workspace/ws_1/wallet-intent/approval_1",
        "ws_1",
      ),
    ).toEqual({
      ok: true,
      value: {
        workspaceId: "ws_1",
        kind: "wallet-intent",
        targetId: "approval_1",
        href: "bufi://workspace/ws_1/wallet-intent/approval_1",
      },
    });
  });

  it("rejects unbound, cross-workspace, traversal, query, and extra paths", () => {
    expect(
      parseExpoDeepLink("bufi://approval/approval_1", "ws_1"),
    ).toMatchObject({ ok: false, error: { code: "invalid_deep_link" } });
    expect(
      parseExpoDeepLink(
        "bufi://workspace/ws_other/approval/approval_1",
        "ws_1",
      ),
    ).toMatchObject({ ok: false, error: { code: "scope_mismatch" } });
    expect(
      parseExpoDeepLink("bufi://workspace/ws_1/approval/%2E%2E", "ws_1"),
    ).toMatchObject({ ok: false, error: { code: "invalid_deep_link" } });
    expect(
      parseExpoDeepLink(
        "bufi://workspace/ws_1/approval/approval%2Fother",
        "ws_1",
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_deep_link" } });
    expect(
      parseExpoDeepLink("bufi://workspace/ws_1/approval/%ZZ", "ws_1"),
    ).toMatchObject({ ok: false, error: { code: "invalid_deep_link" } });
    expect(
      parseExpoDeepLink(
        "bufi://workspace/ws_1/approval/approval_1?approve=true",
        "ws_1",
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_deep_link" } });
    expect(
      parseExpoDeepLink(
        "bufi://workspace/ws_1/approval/approval_1/extra",
        "ws_1",
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_deep_link" } });
  });
});

describe("approval intent construction", () => {
  it("builds a non-authoritative, server-revalidated approval intent", () => {
    const result = createExpoApprovalIntent(adapter(), scope, {
      requestId: "request_1",
      actorId: "user_1",
      href: "bufi://workspace/ws_1/approval/approval_1",
      action: "approve",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: "open-agents.expo-approval-intent.v1",
        kind: "approval-intent",
        requestId: "request_1",
        workspaceId: "ws_1",
        teamId: "team_1",
        harnessId: "hermes",
        actorId: "user_1",
        approvalId: "approval_1",
        action: "approve",
        expectedApprovalState: "pending",
        requiresServerAuthorization: true,
        sourceDeepLink: "bufi://workspace/ws_1/approval/approval_1",
      },
    });
  });

  it("builds bounded edit intents with JSON primitives", () => {
    const result = createExpoApprovalIntent(adapter(), scope, {
      requestId: "request_2",
      actorId: "user_1",
      href: "bufi://workspace/ws_1/approval/approval_1",
      action: "edit",
      reason: "Reduce the spend cap",
      changes: { amount: 25, memo: "Quarterly tooling", urgent: false },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        approvalId: "approval_1",
        action: "edit",
        changes: { amount: 25, memo: "Quarterly tooling", urgent: false },
      },
    });
    if (result.ok) {
      const serialized = JSON.stringify(result.value);
      const roundTrip: unknown = JSON.parse(serialized);
      expect(roundTrip).toEqual(result.value);
    }
  });

  it("rejects cross-workspace, unknown, disallowed, and malformed intents", () => {
    expect(
      createExpoApprovalIntent(adapter(), scope, {
        requestId: "request_3",
        actorId: "user_1",
        href: "bufi://workspace/ws_other/approval/approval_1",
        action: "approve",
      }),
    ).toMatchObject({ ok: false, error: { code: "scope_mismatch" } });

    expect(
      createExpoApprovalIntent(
        { ...adapter(), workspaceId: "ws_other" },
        scope,
        {
          requestId: "request_3b",
          actorId: "user_1",
          href: "bufi://workspace/ws_1/approval/approval_1",
          action: "approve",
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "scope_mismatch" } });

    expect(
      createExpoApprovalIntent(adapter(), scope, {
        requestId: "request_4",
        actorId: "user_1",
        href: "bufi://workspace/ws_1/approval/approval_missing",
        action: "approve",
      }),
    ).toMatchObject({ ok: false, error: { code: "approval_not_found" } });

    const unrestricted = adapter();
    const restricted = {
      ...unrestricted,
      approvals: [
        {
          ...unrestricted.approvals[0]!,
          actions: ["reject"] as const,
        },
      ],
    };
    expect(
      createExpoApprovalIntent(restricted, scope, {
        requestId: "request_5",
        actorId: "user_1",
        href: "bufi://workspace/ws_1/approval/approval_1",
        action: "approve",
      }),
    ).toMatchObject({ ok: false, error: { code: "action_not_allowed" } });

    expect(
      createExpoApprovalIntent(adapter(), scope, {
        requestId: "request_6",
        actorId: "user_1",
        href: "bufi://workspace/ws_1/approval/approval_1",
        action: "reject",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });

    expect(
      createExpoApprovalIntent(adapter(), scope, {
        requestId: "request_7",
        actorId: "user_1",
        href: "bufi://workspace/ws_1/approval/approval_1",
        action: "edit",
        changes: { nested: { unsafe: true } } as never,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

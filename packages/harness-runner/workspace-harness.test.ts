import { describe, expect, it } from "bun:test";
import {
  createMcpInvocationEvent,
  createWorkspaceHarness,
  type WorkspaceHarness,
} from "./index";

const harness: WorkspaceHarness = {
  harnessId: "hermes",
  workspaceId: "ws_1",
  teamId: "team_1",
  userId: "user_1",
  sessionId: "session_1",
  connectionState: "connected",
  sandboxRef: "sandbox_1",
  capabilities: [
    {
      name: "defi_swap_quote",
      server: "bufi-hyper",
      scopes: ["defi.read"],
      requiresApproval: false,
      allowedOperations: ["quote"],
    },
    {
      name: "defi_execute_swap",
      server: "bufi-hyper",
      scopes: ["defi.write"],
      requiresApproval: true,
      allowedOperations: ["execute"],
    },
  ],
};

describe("workspace harness contract", () => {
  it("normalizes Hermes/Codex/Claude Code through scoped MCP capabilities", () => {
    expect(
      createWorkspaceHarness({ ...harness, harnessId: "codex" }).harnessId,
    ).toBe("codex");
    expect(
      createWorkspaceHarness({ ...harness, harnessId: "claude-code" })
        .capabilities,
    ).toHaveLength(2);
  });

  it("creates audit events for approved bufi-hyper MCP invocations", () => {
    const event = createMcpInvocationEvent(harness, {
      capability: "defi_execute_swap",
      operation: "execute",
      atMs: 1000,
    });
    expect(event.server).toBe("bufi-hyper");
    expect(event.approvalRequired).toBe(true);
    expect(event.auditId).toContain("defi_execute_swap");
  });

  it("denies ungranted operations and degraded bufi-hyper sessions", () => {
    expect(() =>
      createMcpInvocationEvent(harness, {
        capability: "defi_swap_quote",
        operation: "execute",
        atMs: 1000,
      }),
    ).toThrow("operation");
    expect(() =>
      createWorkspaceHarness({ ...harness, connectionState: "degraded" }),
    ).toThrow("connected harness");
  });
});

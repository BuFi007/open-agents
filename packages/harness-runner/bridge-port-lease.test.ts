import { describe, expect, mock, test } from "bun:test";
import type {
  HarnessAgentAdapter,
  HarnessAgentAdapterSession,
  HarnessAgentStartOptions,
} from "@ai-sdk/harness/agent";

import { withSandboxBridgePortLease } from "./bridge-port-lease.ts";

describe("withSandboxBridgePortLease", () => {
  test("holds the sandbox lease until the adapter session is destroyed", async () => {
    const calls: string[] = [];
    const session = createSession({
      doDestroy: mock(async () => {
        calls.push("destroy");
      }),
    });
    const adapter = createAdapter(async () => {
      calls.push("start");
      return session;
    });
    const options = createStartOptions((command) => {
      calls.push(command.includes("STALE_LEASE_MS") ? "acquire" : "release");
    });

    const guardedSession =
      await withSandboxBridgePortLease(adapter).doStart(options);
    await guardedSession.doDestroy();

    expect(calls).toEqual(["acquire", "start", "destroy", "release"]);
  });

  test("releases the sandbox lease when adapter startup fails", async () => {
    const calls: string[] = [];
    const adapter = createAdapter(async () => {
      calls.push("start");
      throw new Error("startup failed");
    });
    const options = createStartOptions((command) => {
      calls.push(command.includes("STALE_LEASE_MS") ? "acquire" : "release");
    });

    await expect(
      withSandboxBridgePortLease(adapter).doStart(options),
    ).rejects.toThrow("startup failed");
    expect(calls).toEqual(["acquire", "start", "release"]);
  });

  test("attempts an owner-checked release when lease acquisition fails", async () => {
    const calls: string[] = [];
    const adapter = createAdapter(async () => {
      calls.push("start");
      return createSession();
    });
    const options = createStartOptions((command) => {
      const isAcquire = command.includes("STALE_LEASE_MS");
      calls.push(isAcquire ? "acquire" : "release");
      return isAcquire ? 1 : 0;
    });

    await expect(
      withSandboxBridgePortLease(adapter).doStart(options),
    ).rejects.toThrow("Failed to acquire harness bridge port 5001");
    expect(calls).toEqual(["acquire", "release"]);
  });

  test("keeps the sandbox lease when the adapter session detaches", async () => {
    const calls: string[] = [];
    const session = createSession({
      doDetach: mock(async () => {
        calls.push("detach");
        return {
          type: "resume-session" as const,
          harnessId: "test",
          specificationVersion: "harness-v1" as const,
          data: {},
        };
      }),
    });
    const adapter = createAdapter(async () => session);
    const options = createStartOptions((command) => {
      calls.push(command.includes("STALE_LEASE_MS") ? "acquire" : "release");
    });

    const guardedSession =
      await withSandboxBridgePortLease(adapter).doStart(options);
    await guardedSession.doDetach();

    expect(calls).toEqual(["acquire", "detach"]);
  });
});

function createAdapter(
  doStart: (
    options: HarnessAgentStartOptions,
  ) => Promise<HarnessAgentAdapterSession>,
): HarnessAgentAdapter {
  return {
    specificationVersion: "harness-v1",
    harnessId: "test",
    builtinTools: {},
    doStart,
  };
}

function createSession(
  overrides: Partial<HarnessAgentAdapterSession> = {},
): HarnessAgentAdapterSession {
  return {
    sessionId: "test-session",
    isResume: false,
    doPromptTurn: mock(() => {
      throw new Error("not implemented");
    }),
    doCompact: mock(async () => {}),
    doContinueTurn: mock(() => {
      throw new Error("not implemented");
    }),
    doSuspendTurn: mock(() => {
      throw new Error("not implemented");
    }),
    doDetach: mock(() => {
      throw new Error("not implemented");
    }),
    doStop: mock(() => {
      throw new Error("not implemented");
    }),
    doDestroy: mock(async () => {}),
    ...overrides,
  };
}

function createStartOptions(
  onRun: (command: string) => unknown,
): HarnessAgentStartOptions {
  const restricted = {
    run: mock(async ({ command }: { command: string }) => {
      const requestedExitCode = onRun(command);
      const exitCode =
        typeof requestedExitCode === "number" ? requestedExitCode : 0;
      return { exitCode, stdout: "", stderr: "" };
    }),
  };

  return {
    sessionId: "test-session",
    sessionWorkDir: "/tmp/test-session",
    sandboxSession: {
      ports: [5001],
      restricted: () => restricted,
    } as unknown as HarnessAgentStartOptions["sandboxSession"],
  };
}

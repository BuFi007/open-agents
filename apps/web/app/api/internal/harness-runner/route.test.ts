import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { signInternalHarnessRequest } from "@/lib/harness-runner/internal-request";

const originalSecret = process.env.BETTER_AUTH_SECRET;
const workspace = { name: "harness-workspace" };

const spies = {
  connectSandbox: mock(async () => ({
    toAgentHarnessWorkspace: () => workspace,
  })),
  runHarnessTurn: mock(
    async (input: {
      onChunk: (chunk: Record<string, unknown>) => Promise<void> | void;
    }) => {
      await input.onChunk({
        type: "text-delta",
        id: "text-1",
        delta: "hello",
      });
      return {
        responseMessage: {
          id: "assistant-1",
          role: "assistant" as const,
          parts: [{ type: "text", text: "hello" }],
        },
        finishReason: "stop" as const,
        rawFinishReason: "stop",
      };
    },
  ),
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

mock.module("@open-agents/harness-runner", () => ({
  runHarnessTurn: spies.runHarnessTurn,
}));

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-internal-harness-secret";
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = originalSecret;
  }
});

const { POST } = await import("./route");

const body = JSON.stringify({
  harnessId: "codex",
  sandboxState: { type: "vercel", sandboxName: "session-1" },
  workingDirectory: "/vercel/sandbox",
  sessionId: "codex-session-1",
  messageId: "assistant-1",
  messages: [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    },
  ],
  originalMessages: [],
  selectedModelId: "openai/gpt-5.4",
  modelId: "openai/gpt-5.4",
});

function createRequest(signed: boolean) {
  return new Request(
    "https://preview.example.com/api/internal/harness-runner",
    {
      method: "POST",
      headers: signed
        ? {
            "x-open-agents-harness-signature": signInternalHarnessRequest(body),
          }
        : undefined,
      body,
    },
  );
}

describe("/api/internal/harness-runner", () => {
  test("rejects unsigned requests", async () => {
    const response = await POST(createRequest(false));

    expect(response.status).toBe(401);
    expect(spies.connectSandbox).not.toHaveBeenCalled();
  });

  test("streams runner chunks and the final result", async () => {
    const response = await POST(createRequest(true));
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(response.status).toBe(200);
    expect(spies.connectSandbox).toHaveBeenCalledWith(
      { type: "vercel", sandboxName: "session-1" },
      { ports: [3000, 5173, 8000, 5000, 5001] },
    );
    expect(spies.runHarnessTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        harnessId: "codex",
        workspace,
        workingDirectory: "/vercel/sandbox",
      }),
    );
    expect(events).toEqual([
      {
        type: "chunk",
        chunk: { type: "text-delta", id: "text-1", delta: "hello" },
      },
      {
        type: "result",
        result: {
          responseMessage: {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "hello" }],
          },
          finishReason: "stop",
          rawFinishReason: "stop",
        },
      },
    ]);
  });
});

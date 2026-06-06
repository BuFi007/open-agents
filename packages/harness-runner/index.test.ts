import { describe, expect, test } from "bun:test";
import {
  assembleHarnessResponseMessage,
  buildHarnessPrompt,
  resolveCodexModelId,
} from "./index";

describe("buildHarnessPrompt", () => {
  test("builds a compact transcript from chat text", () => {
    expect(
      buildHarnessPrompt([
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Inspect the repo" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "I found the issue" }],
        },
        {
          id: "user-2",
          role: "user",
          parts: [{ type: "text", text: "Fix it" }],
        },
      ]),
    ).toBe(
      "User:\nInspect the repo\n\nAssistant:\nI found the issue\n\nUser:\nFix it",
    );
  });

  test("ignores messages without transferable prompt content", () => {
    expect(
      buildHarnessPrompt([
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "tool-bash", state: "output-available" }],
        },
      ]),
    ).toBe("");
  });
});

describe("resolveCodexModelId", () => {
  test("passes OpenAI models to Codex without the gateway provider prefix", () => {
    expect(resolveCodexModelId("openai/gpt-5.4")).toBe("gpt-5.4");
  });

  test("uses the Codex default for models from another provider", () => {
    expect(resolveCodexModelId("anthropic/claude-opus-4.6")).toBeUndefined();
  });
});

describe("assembleHarnessResponseMessage", () => {
  test("assembles persisted assistant parts from UI stream chunks", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "start-step" });
          controller.enqueue({ type: "text-start", id: "text-1" });
          controller.enqueue({
            type: "text-delta",
            id: "text-1",
            delta: "Hello from Codex",
          });
          controller.enqueue({ type: "text-end", id: "text-1" });
          controller.enqueue({ type: "finish-step" });
          controller.close();
        },
      }),
      "assistant-1",
    );

    expect(responseMessage).toEqual({
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "Hello from Codex", state: "done" },
      ],
    });
  });

  test("assembles native harness tool calls and results", async () => {
    const responseMessage = await assembleHarnessResponseMessage(
      new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "tool-input-available",
            toolCallId: "tool-1",
            toolName: "bash",
            input: { command: "pwd" },
            dynamic: true,
          });
          controller.enqueue({
            type: "tool-output-available",
            toolCallId: "tool-1",
            output: { exitCode: 0, output: "/vercel/sandbox\n" },
            dynamic: true,
          });
          controller.close();
        },
      }),
      "assistant-1",
    );

    expect(responseMessage.parts).toEqual([
      {
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: { command: "pwd" },
        output: { exitCode: 0, output: "/vercel/sandbox\n" },
      },
    ]);
  });
});

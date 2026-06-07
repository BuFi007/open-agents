import { describe, expect, test } from "bun:test";
import {
  OPEN_AGENT_HARNESS_INSTRUCTIONS,
  OPEN_AGENT_HARNESS_TOOLS,
  assembleHarnessResponseMessage,
  buildHarnessPrompt,
  mapOpenAgentToolChunk,
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

  test("includes completed interactive tool outputs", () => {
    expect(
      buildHarnessPrompt([
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-ask_user_question",
              toolCallId: "question-1",
              state: "output-available",
              input: {
                questions: [
                  {
                    question: "Which direction?",
                    header: "Direction",
                    options: [],
                  },
                ],
              },
              output: {
                answers: {
                  "Which direction?": "Keep it simple",
                },
              },
            },
          ],
        },
      ]),
    ).toBe(
      'Assistant:\nUser answered questions: "Which direction?"="Keep it simple".',
    );
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

describe("OPEN_AGENT_HARNESS_TOOLS", () => {
  test("exposes ask_user_question as an external client-side tool", () => {
    expect(Object.keys(OPEN_AGENT_HARNESS_TOOLS)).toEqual([
      "ask_user_question",
    ]);
    expect("execute" in OPEN_AGENT_HARNESS_TOOLS.ask_user_question).toBeFalse();
  });

  test("instructs Codex to use ask_user_question instead of prose fallback", () => {
    expect(OPEN_AGENT_HARNESS_INSTRUCTIONS).toContain(
      "The ask_user_question tool is available",
    );
    expect(OPEN_AGENT_HARNESS_INSTRUCTIONS).toContain(
      "Do not say that the structured question tool is unavailable",
    );
    expect(OPEN_AGENT_HARNESS_INSTRUCTIONS).toContain(
      "your first assistant action must be an ask_user_question tool call",
    );
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
        type: "tool-bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: { command: "pwd" },
        output: { exitCode: 0, output: "/vercel/sandbox\n" },
      },
    ]);
  });
});

describe("mapOpenAgentToolChunk", () => {
  test.each([
    "todo_write",
    "read",
    "write",
    "edit",
    "grep",
    "glob",
    "bash",
    "task",
    "ask_user_question",
    "skill",
    "web_fetch",
  ])("maps known Open Agents tool %s to a static tool chunk", (toolName) => {
    expect(
      mapOpenAgentToolChunk({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName,
        input: {},
        dynamic: true,
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName,
      input: {},
    });
  });

  test("maps streaming input starts before the part is created", () => {
    expect(
      mapOpenAgentToolChunk({
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "ask_user_question",
        dynamic: true,
      }),
    ).toEqual({
      type: "tool-input-start",
      toolCallId: "tool-1",
      toolName: "ask_user_question",
    });
  });

  test("preserves unknown dynamic tools", () => {
    expect(
      mapOpenAgentToolChunk({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "custom_tool",
        input: {},
        dynamic: true,
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "custom_tool",
      input: {},
      dynamic: true,
    });
  });
});

import { describe, expect, test } from "bun:test";

import { createOpenAgentsClaudeCode } from "./claude-code-adapter";

describe("createOpenAgentsClaudeCode", () => {
  test("disables Claude Code's native AskUserQuestion tool", async () => {
    const adapter = createOpenAgentsClaudeCode({
      model: "claude-sonnet-4-5",
    });
    const recipe = await adapter.getBootstrap?.();
    const bridge = recipe?.files.find(
      (file) => file.path === `${recipe.bootstrapDir}/bridge.mjs`,
    );

    expect(bridge).toBeDefined();
    expect(bridge?.content).toContain('disallowedTools: ["AskUserQuestion"],');
    expect(
      bridge?.content.match(/disallowedTools: \["AskUserQuestion"\],/g),
    ).toHaveLength(1);
  });
});

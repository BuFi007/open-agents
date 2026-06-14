import type { HarnessAgentAdapter } from "@ai-sdk/harness/agent";
import {
  createClaudeCode,
  type ClaudeCodeHarnessSettings,
} from "@ai-sdk/harness-claude-code";

const BRIDGE_FILE_NAME = "bridge.mjs";
const QUERY_OPTIONS_MARKER = "includePartialMessages: true,";
const DISABLE_NATIVE_QUESTION_TOOL = `${QUERY_OPTIONS_MARKER}
      disallowedTools: ["AskUserQuestion"],`;

export function patchClaudeCodeBridge(content: string): string {
  const markerIndex = content.indexOf(QUERY_OPTIONS_MARKER);

  if (markerIndex === -1) {
    throw new Error(
      "Could not disable Claude Code's native AskUserQuestion tool: query options marker not found",
    );
  }

  if (
    content.includes(
      QUERY_OPTIONS_MARKER,
      markerIndex + QUERY_OPTIONS_MARKER.length,
    )
  ) {
    throw new Error(
      "Could not disable Claude Code's native AskUserQuestion tool: query options marker is ambiguous",
    );
  }

  return content.replace(QUERY_OPTIONS_MARKER, DISABLE_NATIVE_QUESTION_TOOL);
}

export function createOpenAgentsClaudeCode(
  settings: ClaudeCodeHarnessSettings = {},
): HarnessAgentAdapter {
  const adapter = createClaudeCode(settings);

  return {
    ...adapter,
    getBootstrap: async (options) => {
      const recipe = await adapter.getBootstrap?.(options);

      if (!recipe) {
        throw new Error(
          "Claude Code harness did not provide a bootstrap recipe",
        );
      }

      const bridgePath = `${recipe.bootstrapDir}/${BRIDGE_FILE_NAME}`;
      let bridgeFound = false;
      const files = recipe.files.map((file) => {
        if (file.path !== bridgePath) {
          return file;
        }

        bridgeFound = true;
        return {
          ...file,
          content: patchClaudeCodeBridge(file.content),
        };
      });

      if (!bridgeFound) {
        throw new Error(
          `Could not disable Claude Code's native AskUserQuestion tool: ${bridgePath} not found`,
        );
      }

      return {
        ...recipe,
        files,
      };
    },
  };
}

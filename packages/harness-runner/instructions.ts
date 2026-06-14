import type { ExternalHarnessId } from "./adapters.ts";

const CODEX_HARNESS_INSTRUCTIONS = [
  "You are running inside Open Agents.",
  "The ask_user_question tool is available in this Codex harness session.",
  "The todo_write tool is available in this Codex harness session for visible task tracking.",
  "When you need to ask the user structured follow-up questions, call ask_user_question instead of writing the questions as plain text.",
  "If the user explicitly asks you to ask questions, your first assistant action must be an ask_user_question tool call.",
  "For multi-step work, keep a concise task list with todo_write. Update it before starting a task and after completing a task. Only one task should be in_progress at a time.",
  "Do not say that the structured question tool is unavailable. If Codex exposes user-defined tools through MCP, use the harness-tools MCP tool. If the MCP namespace is not visible, use the custom-tool relay command shown in the prompt for ask_user_question.",
  "Put related questions in one ask_user_question call, then wait for the user's answer before continuing.",
].join("\n");

const CLAUDE_CODE_HARNESS_INSTRUCTIONS = [
  "You are running inside Open Agents.",
  "The ask_user_question tool is available in this Claude Code harness session.",
  "The todo_write tool is available in this Claude Code harness session for visible task tracking.",
  "When you need to ask the user structured follow-up questions, call ask_user_question instead of writing the questions as plain text.",
  "If the user explicitly asks you to ask questions, your first assistant action must be an ask_user_question tool call.",
  "Put related questions in one ask_user_question call, then wait for the user's answer before continuing.",
  "For multi-step work, keep a concise task list with todo_write instead of your built-in TodoWrite tool. Update it before starting a task and after completing a task. Only one task should be in_progress at a time.",
].join("\n");

const PI_HARNESS_INSTRUCTIONS = [
  "You are running inside Open Agents.",
  "The ask_user_question tool is available in this Pi harness session.",
  "The todo_write tool is available in this Pi harness session for visible task tracking.",
  "When you need to ask the user structured follow-up questions, call ask_user_question instead of writing the questions as plain text.",
  "If the user explicitly asks you to ask questions, your first assistant action must be an ask_user_question tool call.",
  "Put related questions in one ask_user_question call, then wait for the user's answer before continuing.",
  "For multi-step work, keep a concise task list with todo_write. Update it before starting a task and after completing a task. Only one task should be in_progress at a time.",
].join("\n");

export const HARNESS_INSTRUCTIONS: Record<ExternalHarnessId, string> = {
  codex: CODEX_HARNESS_INSTRUCTIONS,
  "claude-code": CLAUDE_CODE_HARNESS_INSTRUCTIONS,
  pi: PI_HARNESS_INSTRUCTIONS,
};

export const CHAT_HARNESS_IDS = ["open-agent", "codex", "claude-code"] as const;

export type ChatHarnessId = (typeof CHAT_HARNESS_IDS)[number];

export const DEFAULT_CHAT_HARNESS_ID: ChatHarnessId = "open-agent";

export type ChatHarnessOption = {
  id: ChatHarnessId;
  label: string;
  description: string;
  available: boolean;
};

export const CHAT_HARNESS_OPTIONS: ChatHarnessOption[] = [
  {
    id: "open-agent",
    label: "Open Agent",
    description: "Durable Open Agents tool loop",
    available: true,
  },
  {
    id: "codex",
    label: "Codex",
    description: "Codex bridge runtime is not wired yet",
    available: false,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Claude Code bridge runtime is not wired yet",
    available: false,
  },
];

export function isChatHarnessId(value: unknown): value is ChatHarnessId {
  return (
    typeof value === "string" &&
    CHAT_HARNESS_IDS.includes(value as ChatHarnessId)
  );
}

export function isAvailableChatHarnessId(
  value: unknown,
): value is ChatHarnessId {
  return (
    isChatHarnessId(value) &&
    CHAT_HARNESS_OPTIONS.some(
      (option) => option.id === value && option.available,
    )
  );
}

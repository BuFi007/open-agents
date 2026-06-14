export const CHAT_HARNESS_IDS = [
  "open-agent",
  "codex",
  "claude-code",
  "pi",
] as const;

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
    description: "Codex native coding agent",
    available: true,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Claude Code native coding agent",
    available: true,
  },
  {
    id: "pi",
    label: "Pi",
    description: "Pi coding agent",
    available: true,
  },
];

export function getChatHarnessLabel(id: ChatHarnessId): string {
  return CHAT_HARNESS_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

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

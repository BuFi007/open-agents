import { Bot } from "lucide-react";
import type { SVGProps } from "react";
import { ProviderIcon } from "@/components/provider-icons";
import type { ChatHarnessId } from "@/lib/chat-harnesses";

const HARNESS_PROVIDERS: Partial<Record<ChatHarnessId, string>> = {
  codex: "openai",
  "claude-code": "anthropic",
};

interface HarnessIconProps extends SVGProps<SVGSVGElement> {
  harnessId: ChatHarnessId;
}

export function HarnessIcon({ harnessId, ...props }: HarnessIconProps) {
  const provider = HARNESS_PROVIDERS[harnessId];
  if (!provider) {
    return <Bot {...props} />;
  }
  return <ProviderIcon provider={provider} {...props} />;
}

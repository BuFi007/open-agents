"use client";

import { useCallback, useState } from "react";
import type { ChatHarnessId } from "@/lib/chat-harnesses";

interface UseChatHarnessSelectionOptions {
  harnessId: ChatHarnessId;
  updateChatHarness: (harnessId: ChatHarnessId) => Promise<void>;
}

export function useChatHarnessSelection({
  harnessId,
  updateChatHarness,
}: UseChatHarnessSelectionOptions) {
  const [isUpdatingHarness, setIsUpdatingHarness] = useState(false);

  const handleHarnessChange = useCallback(
    async (nextHarnessId: ChatHarnessId) => {
      if (nextHarnessId === harnessId) {
        return;
      }

      try {
        setIsUpdatingHarness(true);
        await updateChatHarness(nextHarnessId);
      } catch (error) {
        console.error("Failed to update chat harness:", error);
      } finally {
        setIsUpdatingHarness(false);
      }
    },
    [harnessId, updateChatHarness],
  );

  return {
    handleHarnessChange,
    isUpdatingHarness,
  };
}

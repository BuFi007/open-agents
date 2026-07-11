export type OperatingPackMobileNotificationStatus =
  | "awaiting_approval"
  | "rejected"
  | "completed"
  | "failed";

type NotificationConfig = { url: URL; apiKey: string };

export function resolveMobileNotificationConfig(
  env: Record<string, string | undefined> = process.env,
): NotificationConfig | null {
  const rawUrl = env.BUFI_SHIVA_URL;
  const apiKey = env.BUFI_SHIVA_API_KEY;
  if (!rawUrl || !apiKey || apiKey.length < 16) return null;
  try {
    const url = new URL(rawUrl);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
      return null;
    return { url, apiKey };
  } catch {
    return null;
  }
}

const copy = {
  awaiting_approval: {
    title: "BUFI needs your approval",
    body: "An agent workflow is ready for review in your mobile inbox.",
  },
  rejected: {
    title: "BUFI workflow rejected",
    body: "The workflow stopped after the approval decision.",
  },
  completed: {
    title: "BUFI workflow completed",
    body: "Your agent team finished and its evidence is ready to inspect.",
  },
  failed: {
    title: "BUFI workflow needs attention",
    body: "The agent workflow failed. Open the trace summary for details.",
  },
} satisfies Record<
  OperatingPackMobileNotificationStatus,
  { title: string; body: string }
>;

export async function sendOperatingPackMobileNotification(input: {
  executionId: string;
  workspaceId: string;
  userId: string;
  packId: string;
  workflowId: string;
  status: OperatingPackMobileNotificationStatus;
  config?: NotificationConfig | null;
  fetcher?: typeof fetch;
}): Promise<{ delivered: boolean; reason?: string }> {
  const config =
    input.config === undefined
      ? resolveMobileNotificationConfig()
      : input.config;
  if (!config) return { delivered: false, reason: "not_configured" };
  const message = copy[input.status];
  try {
    const response = await (input.fetcher ?? fetch)(
      new URL("/notifications/dispatch", config.url),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": config.apiKey,
        },
        body: JSON.stringify({
          teamId: input.workspaceId,
          recipientUserId: input.userId,
          fromAgent: "BUFI Agentic Workspaces",
          source: "agent",
          urgency: "high",
          category: "agent_workflow",
          title: message.title,
          body: message.body,
          actionUrl: `bufi://workflow/${encodeURIComponent(input.executionId)}`,
          actionLabel: "Open workflow",
          featureKey: "agent_workspaces",
          metadata: {
            type: "agent_workflow",
            runId: input.executionId,
            packId: input.packId,
            workflowId: input.workflowId,
            status: input.status,
          },
          idempotencyKey: `agent_workflow:${input.executionId}:${input.status}`,
          channelOverrides: { skipEmail: true, skipSlack: true },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      return { delivered: false, reason: `http_${response.status}` };
    return { delivered: true };
  } catch {
    return { delivered: false, reason: "unavailable" };
  }
}

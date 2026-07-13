import { describe, expect, test } from "bun:test";
import {
  resolveMobileNotificationConfig,
  sendOperatingPackMobileNotification,
} from "./mobile-notification";

describe("operating-pack mobile notifications", () => {
  test("rejects insecure or incomplete notification configuration", () => {
    expect(resolveMobileNotificationConfig({})).toBeNull();
    expect(
      resolveMobileNotificationConfig({
        BUFI_SHIVA_URL: "http://example.com",
        BUFI_SHIVA_API_KEY: "a".repeat(32),
      }),
    ).toBeNull();
  });

  test("dispatches one idempotent, deep-linked push without leaking the API key", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await sendOperatingPackMobileNotification({
      executionId: "op_demo",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      packId: "finance_ops",
      workflowId: "weekly_finance_review",
      status: "completed",
      config: {
        url: new URL("https://shiva.example.com"),
        apiKey: "notification-key-at-least-sixteen",
      },
      fetcher: (async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ success: true }, { status: 201 });
      }) as typeof fetch,
    });
    expect(result).toEqual({ delivered: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://shiva.example.com/notifications/dispatch",
    );
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      category: "agent_workflow",
      urgency: "high",
      actionUrl: "bufi://workflow/op_demo",
      idempotencyKey: "agent_workflow:op_demo:completed",
      metadata: { runId: "op_demo", status: "completed" },
    });
    expect(JSON.stringify(body)).not.toContain(
      "notification-key-at-least-sixteen",
    );
  });
});

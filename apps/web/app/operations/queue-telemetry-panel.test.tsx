import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueTelemetryPanel } from "./queue-telemetry-panel";

describe("QueueTelemetryPanel", () => {
  test("renders the latest safe SLO snapshot and alert", () => {
    const markup = renderToStaticMarkup(
      <QueueTelemetryPanel
        traces={[
          {
            type: "queue.telemetry",
            data: {
              schemaVersion: 1,
              generatedAtMs: 2_000,
              factCount: 3,
              metrics: [
                {
                  profile: "knowledge-ai",
                  queue: "embedding",
                  queued: 1,
                  completed: 0,
                  retrying: 1,
                  deadLettered: 0,
                  throttled: 0,
                  inFlight: 0,
                  p95QueueWaitMs: 100,
                  p95ProcessingMs: 200,
                },
              ],
              alerts: [
                {
                  code: "QUEUE_WAIT_SLO_EXCEEDED",
                  profile: "knowledge-ai",
                  queue: "embedding",
                  observed: 100,
                  threshold: 50,
                },
              ],
            },
          },
        ]}
      />,
    );
    expect(markup).toContain("Queue plane");
    expect(markup).toContain("1 SLO alert");
    expect(markup).toContain("knowledge-ai/embedding");
    expect(markup).toContain("100ms");
    expect(markup).toContain("QUEUE_WAIT_SLO_EXCEEDED");
    expect(markup).not.toContain("job-1");
  });

  test("hides malformed or non-queue traces", () => {
    expect(
      renderToStaticMarkup(
        <QueueTelemetryPanel
          traces={[
            { type: "tool.called", data: { payload: "secret" } },
            { type: "queue.telemetry", data: { schemaVersion: 99 } },
          ]}
        />,
      ),
    ).toBe("");
  });
});

import { describe, expect, it } from "bun:test";
import {
  classifyJobFailure,
  createDlqEntry,
  evaluateWorkerAdmission,
} from "./index";

const hash =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("BullMQ worker profile contract", () => {
  it("enforces queue allowlists, replica budgets, and workspace fair-share admission", () => {
    expect(
      evaluateWorkerAdmission({
        profile: "knowledge-ai",
        workspaceId: "ws_1",
        queue: "embedding",
        activeForWorkspace: 0,
        replicas: 2,
      }),
    ).toMatchObject({ admitted: true, totalConcurrency: 12 });
    expect(
      evaluateWorkerAdmission({
        profile: "knowledge-ai",
        workspaceId: "ws_1",
        queue: "invoice",
        activeForWorkspace: 0,
        replicas: 2,
      }).reason,
    ).toContain("not allowed");
    expect(
      evaluateWorkerAdmission({
        profile: "knowledge-ai",
        workspaceId: "ws_1",
        queue: "embedding",
        activeForWorkspace: 3,
        replicas: 2,
      }).reason,
    ).toContain("fair-share");
    expect(
      evaluateWorkerAdmission({
        profile: "knowledge-ai",
        workspaceId: "ws_1",
        queue: "embedding",
        activeForWorkspace: 0,
        replicas: 9,
      }).reason,
    ).toContain("replica");
  });

  it("classifies retryable, unrecoverable, and deadline failures", () => {
    expect(classifyJobFailure({ status: 429 })).toBe("retryable");
    expect(classifyJobFailure({ status: 400 })).toBe("unrecoverable");
    expect(classifyJobFailure({ timedOut: true })).toBe("deadline");
  });

  it("stores bounded sanitized DLQ metadata only", () => {
    const entry = createDlqEntry({
      jobId: "job_1",
      workspaceId: "ws_1",
      profile: "source-connectors",
      queue: "connector-page",
      failureClass: "retryable",
      errorCode: "HTTP_500",
      attempts: 2,
      payloadHash: hash,
      stackHash: hash,
      atMs: 1000,
    });
    expect(entry.payloadHash).toBe(hash);
    expect(() =>
      createDlqEntry({ ...entry, payloadHash: "raw payload" }),
    ).toThrow("hash");
  });
});

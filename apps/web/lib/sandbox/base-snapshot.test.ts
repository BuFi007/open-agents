import { afterAll, describe, expect, mock, test } from "bun:test";

const originalDeploymentId = process.env.VERCEL_DEPLOYMENT_ID;
const originalBaseSnapshotId = process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;
const resolvedTemplateNames: string[] = [];

mock.module("@open-agents/sandbox/vercel", () => ({
  createVercelSnapshotTemplateName: (deploymentId: string) =>
    `template-${deploymentId}`,
  resolveVercelSnapshotTemplateId: async (templateName: string) => {
    resolvedTemplateNames.push(templateName);
    return "snap-deployment";
  },
}));

afterAll(() => {
  if (originalDeploymentId === undefined) {
    delete process.env.VERCEL_DEPLOYMENT_ID;
  } else {
    process.env.VERCEL_DEPLOYMENT_ID = originalDeploymentId;
  }

  if (originalBaseSnapshotId === undefined) {
    delete process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;
  } else {
    process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID = originalBaseSnapshotId;
  }
});

describe("resolveSandboxBaseSnapshotId", () => {
  test("prefers the deployment-prewarmed template over the raw base snapshot", async () => {
    process.env.VERCEL_DEPLOYMENT_ID = "dpl-test";
    process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID = "snap-explicit-base";

    const { resolveSandboxBaseSnapshotId } = await import("./base-snapshot");

    await expect(resolveSandboxBaseSnapshotId()).resolves.toBe(
      "snap-deployment",
    );
    expect(resolvedTemplateNames).toEqual(["template-dpl-test"]);
  });
});

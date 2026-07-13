import { describe, expect, test } from "bun:test";
import { createBusinessArchitectureGraph } from "./business-graph";

describe("business architecture graph identity", () => {
  test("accepts externally issued UUID workspace IDs", () => {
    const graph = createBusinessArchitectureGraph({
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(graph.workspaceId).toBe("11111111-1111-4111-8111-111111111111");
  });

  test("rejects unsafe workspace IDs", () => {
    expect(() =>
      createBusinessArchitectureGraph({ workspaceId: "../other-workspace" }),
    ).toThrow("invalid workspace id");
  });
});

import { describe, expect, it } from "bun:test";
import { hybridRank } from "./index";

describe("bounded hybrid retrieval", () => {
  it("filters workspace and combines lexical, semantic, and freshness evidence", () => {
    const results = hybridRank(
      "a",
      [
        {
          id: "old",
          workspaceId: "a",
          lexical: 1,
          semantic: 1,
          observedAt: 0,
          evidenceVersion: 1,
        },
        {
          id: "fresh",
          workspaceId: "a",
          lexical: 0.8,
          semantic: 0.8,
          observedAt: 9999,
          evidenceVersion: 2,
        },
        {
          id: "other",
          workspaceId: "b",
          lexical: 9,
          semantic: 9,
          observedAt: 9999,
          evidenceVersion: 1,
        },
      ],
      10000,
      10,
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe("fresh");
    expect(results[0]?.freshnessMs).toBe(1);
  });
});

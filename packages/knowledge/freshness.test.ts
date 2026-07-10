import { describe, expect, it } from "bun:test";
import { needsRefresh } from "./index";

describe("knowledge projection freshness", () => {
  it("refreshes on source revision or age, not only null vectors", () => {
    expect(
      needsRefresh({
        sourceVersion: 2,
        projectionVersion: 1,
        observedAt: Date.now(),
        contentHash: "h",
      }),
    ).toBe(true);
    expect(
      needsRefresh(
        {
          sourceVersion: 1,
          projectionVersion: 1,
          observedAt: 0,
          contentHash: "h",
        },
        1000,
        10,
      ),
    ).toBe(true);
    expect(
      needsRefresh(
        {
          sourceVersion: 1,
          projectionVersion: 1,
          observedAt: 999,
          contentHash: "h",
        },
        1000,
        10,
      ),
    ).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";

import { readBoundedJson } from "./bounded-json";

describe("readBoundedJson", () => {
  test("parses a JSON body at the byte limit", async () => {
    const body = '{"a":1}';
    expect(
      await readBoundedJson(
        new Request("https://oa.test/tax", { method: "POST", body }),
        Buffer.byteLength(body),
      ),
    ).toEqual({ a: 1 });
  });

  test("rejects an oversized declared length before reading", async () => {
    const request = new Request("https://oa.test/tax", {
      method: "POST",
      headers: { "content-length": "9" },
      body: "{}",
    });
    await expect(readBoundedJson(request, 8)).rejects.toThrow(
      "REQUEST_BODY_TOO_LARGE",
    );
  });

  test("cancels a chunked body when its actual size exceeds the limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://oa.test/tax", {
      method: "POST",
      body,
      // Required by Node's Request implementation for streaming bodies.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBoundedJson(request, 8)).rejects.toThrow(
      "REQUEST_BODY_TOO_LARGE",
    );
    expect(cancelled).toBe(true);
  });
});

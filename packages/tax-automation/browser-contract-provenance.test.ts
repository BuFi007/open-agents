import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAX_BROWSER_GOLDEN_FIXTURES_V1,
  TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256,
} from "@tax-engine/browser-contracts/fixtures";

const EXPECTED_TARBALL_SHA256 =
  "1c27c6894740f6c3a8df1f7c7edb3f533624de4a31f50284da5589e61df3e19f";
const EXPECTED_GOLDEN_FIXTURE_SHA256 =
  "0fe0c49d4f83c52f2e8e9a97b2178cf28ff58beeb9a44b9df9eca8deca1ad425";
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const tarballPath = resolve(
  packageDirectory,
  "../../vendor/tax-engine-browser-contracts-0.4.0.tgz",
);
const provenancePath = resolve(
  packageDirectory,
  "../../vendor/tax-engine-browser-contracts-0.4.0.provenance.json",
);

describe("frozen Tax browser-contract dependency", () => {
  test("locks the vendored artifact, package identity, and golden fixture bytes", () => {
    const artifactHash = createHash("sha256")
      .update(readFileSync(tarballPath))
      .digest("hex");
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as {
      artifact: string;
      package: string;
      version: string;
      sha256: string;
      goldenFixturesSha256: string;
    };
    const installedEntry = fileURLToPath(
      import.meta.resolve("@tax-engine/browser-contracts"),
    );
    const installedManifest = JSON.parse(
      readFileSync(resolve(dirname(installedEntry), "../package.json"), "utf8"),
    ) as { name: string; version: string };
    const fixtureHash = createHash("sha256")
      .update(JSON.stringify(TAX_BROWSER_GOLDEN_FIXTURES_V1))
      .digest("hex");

    expect(provenance).toMatchObject({
      artifact: "tax-engine-browser-contracts-0.4.0.tgz",
      package: "@tax-engine/browser-contracts",
      version: "0.4.0",
      sha256: EXPECTED_TARBALL_SHA256,
      goldenFixturesSha256: EXPECTED_GOLDEN_FIXTURE_SHA256,
    });
    expect(artifactHash).toBe(EXPECTED_TARBALL_SHA256);
    expect(installedManifest).toMatchObject({
      name: "@tax-engine/browser-contracts",
      version: "0.4.0",
    });
    expect(TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256).toBe(
      EXPECTED_GOLDEN_FIXTURE_SHA256,
    );
    expect(fixtureHash).toBe(EXPECTED_GOLDEN_FIXTURE_SHA256);
  });
});

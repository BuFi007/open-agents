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
  "df86899d9a7e2815f3cef55377cd4ffd534e90cf44597555c3c7cd2decb9ce7b";
const EXPECTED_GOLDEN_FIXTURE_SHA256 =
  "4042a7cbddaec9729854e4be9f99b1120eb0f608fa056ffaadb175928f9af2c9";
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const tarballPath = resolve(
  packageDirectory,
  "../../vendor/tax-engine-browser-contracts-0.1.0.tgz",
);
const provenancePath = resolve(
  packageDirectory,
  "../../vendor/tax-engine-browser-contracts-0.1.0.provenance.json",
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
      artifact: "tax-engine-browser-contracts-0.1.0.tgz",
      package: "@tax-engine/browser-contracts",
      version: "0.1.0",
      sha256: EXPECTED_TARBALL_SHA256,
      goldenFixturesSha256: EXPECTED_GOLDEN_FIXTURE_SHA256,
    });
    expect(artifactHash).toBe(EXPECTED_TARBALL_SHA256);
    expect(installedManifest).toMatchObject({
      name: "@tax-engine/browser-contracts",
      version: "0.1.0",
    });
    expect(TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256).toBe(
      EXPECTED_GOLDEN_FIXTURE_SHA256,
    );
    expect(fixtureHash).toBe(EXPECTED_GOLDEN_FIXTURE_SHA256);
  });
});

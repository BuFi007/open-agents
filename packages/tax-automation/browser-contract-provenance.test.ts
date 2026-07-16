import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TAX_BROWSER_GOLDEN_FIXTURES_V1,
  TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256,
} from "@tax-engine/browser-contracts/fixtures";
import {
  TAX_BROWSER_SCENARIO_FIXTURES_V1,
  TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256,
} from "@tax-engine/browser-contracts/scenarios";

const EXPECTED_TARBALL_SHA256 =
  "7f9f2e0e7aaed138e07e54c0128b71b078962e2b3891547f1681b9fdaf1f8e42";
const EXPECTED_GOLDEN_FIXTURE_SHA256 =
  "703e681ee2e1bc76a6589f3f2e0bc865f07ac3855be4efc358e0c2ae0c5c9976";
const EXPECTED_SCENARIO_FIXTURE_SHA256 =
  "68f1038903de240f96f0034bbe9103d978fc84a22afde4615c2814e6bcf5a415";
const packageDirectory = dirname(fileURLToPath(import.meta.url));
const tarballPath = resolve(
  packageDirectory,
  "../../vendor/tax-engine-browser-contracts-0.6.0.tgz",
);
const provenancePath = resolve(
  packageDirectory,
  "../../vendor/tax-engine-browser-contracts-0.6.0.provenance.json",
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
      scenarioFixturesSha256: string;
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
    const scenarioHash = createHash("sha256")
      .update(JSON.stringify(TAX_BROWSER_SCENARIO_FIXTURES_V1))
      .digest("hex");

    expect(provenance).toMatchObject({
      artifact: "tax-engine-browser-contracts-0.6.0.tgz",
      package: "@tax-engine/browser-contracts",
      version: "0.6.0",
      sha256: EXPECTED_TARBALL_SHA256,
      goldenFixturesSha256: EXPECTED_GOLDEN_FIXTURE_SHA256,
      scenarioFixturesSha256: EXPECTED_SCENARIO_FIXTURE_SHA256,
    });
    expect(artifactHash).toBe(EXPECTED_TARBALL_SHA256);
    expect(installedManifest).toMatchObject({
      name: "@tax-engine/browser-contracts",
      version: "0.6.0",
    });
    expect(TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256).toBe(
      EXPECTED_GOLDEN_FIXTURE_SHA256,
    );
    expect(fixtureHash).toBe(EXPECTED_GOLDEN_FIXTURE_SHA256);
    expect(TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256).toBe(
      EXPECTED_SCENARIO_FIXTURE_SHA256,
    );
    expect(scenarioHash).toBe(EXPECTED_SCENARIO_FIXTURE_SHA256);
  });
});

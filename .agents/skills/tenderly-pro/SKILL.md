---
name: tenderly-pro
version: 1.0.0
description: |
  Leverage Tenderly Pro-tier features that aren't available on the free plan —
  multiple Virtual TestNets, lifted address-monitoring cap, Web3 Actions
  (event-driven serverless), Alerts, higher TUs/s for parallel sim matrices,
  and primed-vnet workflows that the previously-free /tenderly-testnet skill
  documents as gated.

  Builds on /tenderly-testnet (the base workflow) and
  /codex-adversarial-review-tenderly-testnet (the live-state codex pass).
  Use this skill when the project is on Tenderly Pro (or higher) and you
  want to take advantage of the unlocked surface.

triggers:
  - tenderly pro
  - leverage tenderly pro
  - multiple primed vnets
  - tenderly web3 actions
  - tenderly alerts
  - parallel simulator matrix
  - tenderly per-environment vnets
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - WebFetch
---

# Tenderly Pro — leverage the unlocked surface

`/tenderly-testnet` is constrained for the free plan: 2 vnets per project, 20
addresses monitored, ~5,000 vnet block ceiling, TUs/s rate-limited. Pro
lifts every one of those, plus unlocks features that were dark on free.

This skill turns those unlocks into concrete patterns.

## What Pro changes

| Constraint                       | Free                          | Pro                                               |
| -------------------------------- | ----------------------------- | ------------------------------------------------- |
| Virtual TestNets per project     | 2                             | typically 5+ (effectively unlimited for solo dev) |
| Addresses monitored              | 20                            | 200+                                              |
| Vnet max block height            | ~5,000                        | much higher (mins-to-hours of activity)           |
| TUs per second                   | rate-limited; mid-deploy 403s | high enough to run a 100+ sim matrix in parallel  |
| Web3 Actions (event-driven JS)   | gated                         | unlocked                                          |
| Alerts (on-chain event triggers) | gated                         | unlocked                                          |
| Forks (legacy)                   | gone since 2025               | gone (Pro doesn't bring back)                     |

## Pattern A — Per-environment primed vnets

On free you had to pick one primed vnet for the whole matrix. On Pro, run
one primed vnet per environment so dev / staging / integration don't
collide:

```bash
# dev environment — fast iteration, freely overridable state
sh packages/sdk/scripts/tenderly-prime-vnet.sh
# (interactive: picks a slug like fx-telarana-primed-dev)

# staging — same hub stack, locked + write-protected for QA
sh packages/sdk/scripts/tenderly-prime-vnet.sh
# (slug: fx-telarana-primed-staging)

# integration — multi-chain fork chain to test cross-chain flows
sh packages/sdk/scripts/tenderly-prime-vnet.sh
# (slug: fx-telarana-integration-fuji-hub)
```

Then route each test category against a different vnet via env vars:

```bash
TENDERLY_PRIMED_VNET_PUBLIC_RPC=$DEV_RPC    bun run sim:matrix
TENDERLY_PRIMED_VNET_PUBLIC_RPC=$STAGING_RPC bun run sim:matrix
```

## Pattern B — Parallel simulator matrix

On free, the TUs/s ceiling meant the 128-sim matrix had to run
serially (~5 min). Pro lifts the ceiling enough that you can `Promise.all`
the sims:

```ts
// packages/sdk/scripts/simulator/run-matrix.ts (Pro upgrade path)
const results = await Promise.all(
  cases.map(async c => {
    if (c.bundle) return client.simulateBundle(c.bundle);
    return client.simulate(c.request);
  })
);
// Matrix completes in 30-60 seconds instead of 5 minutes.
```

Keep an eye on dashboard's TUs/s graph to confirm you're not crossing
the Pro ceiling. If you do, fall back to a `pLimit(10)` concurrency cap.

## Pattern C — Web3 Actions for protocol invariants

Use Web3 Actions to run a JS function every time a target contract emits
a specified event. Two high-value patterns for cross-chain hubs:

1. **Stranded-deposit auto-sweep** — listen to `DepositStranded`, set a
   24h timer, then call `sweepStrandedDeposit(nonce)` automatically.
   Replaces the manual keeper.

2. **Oracle-staleness alert** — listen to swap-attempt failures (revert
   reason `OracleStale`); the Action calls Pyth Hermes for a fresh payload
   and submits `updatePriceFeeds`. Keeps the chain's Pyth fresh without a
   dedicated keeper.

Register via `POST /api/v1/account/{a}/project/{p}/actions/{action_id}/registry`
or via the dashboard's Web3 Actions UI. JS body runs in Tenderly's
serverless sandbox.

## Pattern D — Alerts as a regression detector

Wire an Alert on any contract event that should NEVER fire in production:

- `HookDataMismatch` on `FxHubMessageReceiver`: someone tampered with
  CCTP hookData; treat as a bridge integrity incident.
- `OracleDeviation` on `FxOracle.getMidVerified`: Pyth and RedStone
  diverged > 50 bps; possible oracle attack.
- `NotAuthorizedForOnBehalf` on `FxMarketRegistry`: someone tried to
  exploit the Codex-patched gate; useful as a tripwire even when the
  attack reverts.

Alerts can post to Slack/Discord/email/webhook. The webhook target is
the same surface as Web3 Actions, so an Alert can both notify AND
trigger an on-chain response in one wire.

## Pattern E — Address monitoring without picking favorites

On free we had to delete `MorphoOracleAdapter` entries to fit deployer
wallets under the 20-cap. On Pro: label everything. Useful surface:

- **all deployer wallets** across every spoke chain (the trail of activity
  from one operator across the bridge network)
- **external dependencies** (Morpho, Pyth, USDC, Permit2, UR, PoolManager)
  so traces decode them by name instead of as bare addresses
- **opponent contracts** — if you're benchmarking against a competitor
  forex DEX, label theirs in the same project for side-by-side traces

```bash
# Bulk-label every contract in a deployments-JSON manifest, including
# externals (Pro-only — would blow the 20-cap on free):
bun packages/sdk/scripts/tenderly-label.ts deployments/base-sepolia.json --include-external
```

## Pattern F — Transactions RPC for end-to-end dogfood

Pro vnets are stable enough to dogfood the full user flow live:

1. Open the vnet's Public RPC URL in MetaMask (or wagmi-based dapp).
2. Set chainId to whatever the vnet forks (Tenderly mirrors it).
3. Take real user actions: connect wallet → deposit on a spoke →
   wait for CCTP attestation → see hub-side state update.

The vnet keeps state across sessions, so you can hand the RPC URL to a
teammate or a PM for review without re-priming. Pro plans typically also
include team members on the same vnet, so multiple wallets can interact
in a shared simulated environment.

## Pattern G — Snapshot-style branching via vnet duplication

Tenderly's legacy Fork API is gone. The Pro substitute: keep a
"golden snapshot" vnet (primed, oracle-fresh, supply liquidity bootstrapped)
and **duplicate it** before each major test campaign:

```bash
# Pseudo — Tenderly exposes a vnet-clone endpoint on Pro:
curl -X POST -H "X-Access-Key: $TOKEN" "$API/vnets/$GOLDEN_VNET_ID/clone" \
  -d '{"slug":"campaign-2026-05-14"}'
```

Each campaign branch starts from the exact same primed state — no
re-running setup, no per-sim state_objects, no drift. Delete the clone
when the campaign ends.

(Verify the exact clone endpoint shape in the Pro docs — it may be
`POST /vnets` with `parent_id` field instead.)

## Bringing it together — h&sCCCm hub migration

The forex engine we extracted these patterns from is in the middle of a
hub migration: **Base Sepolia → Avalanche Fuji → Arc Testnet**. The Pro
workflow for that migration:

1. **Primed Fuji vnet** as the staging hub (already created — see
   `packages/sdk/scripts/tenderly-prime-vnet.sh`).
2. **Deploy hub stack** to the primed Fuji vnet first; iterate until the
   full sim matrix passes against it.
3. **Web3 Action** that listens for `DepositExecuted` on the Fuji hub
   and auto-mirrors the same call against a parallel Arc-shaped vnet,
   surfacing divergences immediately.
4. **Tenderly Alert** wired on `Stranded` events; webhooks into a
   dashboard so the team sees rescue-required deposits in real time.
5. Once the Fuji vnet matrix is green, broadcast the hub stack to live
   Fuji + redeploy all spokes pointing at the new hub via
   `packages/sdk/scripts/migrate-hub.ts deployments/hub-config-fuji.json --execute`.

## Rules

### Security

- Pro doesn't change the testnet-only guard — refuse any vnet whose
  `fork_config.network_id` is a mainnet ID (1, 10, 137, 8453, 42161,
  43114, 130).
- Web3 Actions run server-side with project secrets accessible — treat
  them like a production service. Don't store private keys in Action
  source.
- Alerts can fire on every block — make sure their webhook target can
  absorb the rate.

### Best practices

- **Tag vnets by purpose** (slug like `dev`, `staging`, `integration-fuji`).
- **Set up the Alert before the deploy**, not after — catching the first
  attack attempt requires the alert to exist before the contract.
- **Clone golden snapshots** for one-shot test campaigns instead of
  re-priming; saves 10-30s × every sim.
- **Use `--include-external`** when labeling — Pro has the headroom
  for it.

## Pattern H — Tenderly MCP Server (the unfair advantage)

Pro plans unlock custom MCP connectors on Claude.ai + Claude Desktop. On
Claude Code MCP works for free, but Pro lifts the underlying API/TU
quotas so the 59-tool surface is actually usable at production scale.

```bash
claude mcp add tenderly --transport http https://mcp.tenderly.co/mcp
claude mcp list                              # confirm "tenderly" appears
# Inside the conversation: /mcp → select tenderly → OAuth in browser
```

What this unlocks vs the curl-and-script approach:

- **`save_snapshot` / `restore_snapshot`** — the legacy Fork-API
  "branching" we lost in 2025, restored as first-class vnet operations.
  Save the primed-hub state once, branch per test campaign.
- **`tenderly_setBalance`, `tenderly_setErc20Balance`,
  `tenderly_setStorageAt`, `tenderly_setCode`** — all admin RPC calls
  without writing curl. Combine with **impersonated transactions** to
  test as any wallet.
- **Advanced trace navigation** — 16 tools (`get_trace_stats`,
  `get_trace_skeleton`, `find_failures`, `get_error_path`, fund-flow)
  that fan out underneath the 256-entry REST trace cap. Crucial when a
  reverted swap has 2000+ internal calls.
- **`set_active_vnet`** — every subsequent tool runs against that vnet
  automatically. Drops the per-call boilerplate.

### Recommended Pro workflow

1. **MCP is the default surface** for interactive work (deploys, snap +
   branch, simulate-and-trace, fund-flow audits).
2. **Scripts (`scripts/tenderly-*.sh`, `scripts/simulator/*.ts`) are
   the CI surface** — deterministic, headless, no OAuth. Run them in
   release pipelines.
3. **`/codex-adversarial-review-tenderly-testnet`** orchestrates both:
   probes live state via REST (the CI surface), then asks Codex to
   challenge the design. The Pro plan's higher TUs/s means the probe
   can hit every chain we deploy on without rate-limit reverts.

### Snapshot branching via MCP (the Pattern G upgrade)

```
"snapshot the active vnet as 'primed-hub-v4'"
"create a branch from primed-hub-v4 named 'campaign-borrow-stress'"
"set the active vnet to campaign-borrow-stress"
"simulate the borrow-stress test plan, show me the trace skeleton"
"if anything fails: restore primed-hub-v4 and we're back to clean state"
```

Replaces the script-based vnet-clone hack the v1 of this skill
described.

## Reference

- /tenderly-testnet (base workflow + Hardhat plugin patterns + MCP quickstart)
- /codex-adversarial-review-tenderly-testnet (live-state codex pass)
- Tenderly MCP Server docs: https://docs.tenderly.co/mcp
- Web3 Actions: https://docs.tenderly.co/web3-actions
- Alerts: https://docs.tenderly.co/alerts
- Pro plan billing: https://dashboard.tenderly.co/account/billing

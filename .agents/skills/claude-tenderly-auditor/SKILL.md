---
name: claude-tenderly-auditor
version: 1.0.0
description: |
  Claude-as-auditor methodology for stress-testing live protocols on Tenderly
  Virtual TestNets. Drives the full Tenderly MCP surface (snapshot/revert,
  setCode, setErc20Balance, simulate, trace) to run scaled stress scenarios
  (ERC-4626 math, leveraged borrows, liquidation + bad-debt realization,
  hook/swap path saturation, CCTP-style receive-side invariants) against the
  real deployed contracts on a primed vnet, and emits a public-grade
  AUDIT_REPORT.md.

  Companion to /codex-adversarial-tenderly-auditor: this skill produces the
  defensive baseline; that one runs the adversarial pass over the same
  artefacts. Both emit the same AUDIT_REPORT.md schema (see
  AUDIT_REPORT_TEMPLATE.md in this skill dir).

  HARD RULE — TESTNET ONLY (inherited from /tenderly-testnet): refuses any
  audit whose active vnet `fork_config.network_id` is a mainnet ID.

  Allow-list (testnets only):
    11155111 (Sepolia), 84532 (Base Sepolia), 11155420 (Optimism Sepolia),
    421614 (Arbitrum Sepolia), 80002 (Polygon Amoy), 43113 (Avalanche Fuji),
    1301 (Unichain Sepolia), 4801 (Worldchain Sepolia), 5042002 (Arc Testnet).
  Refuse-list (mainnets + Arc mainnet pending):
    1, 8453, 10, 42161, 137, 43114, 130, 1923 (Swellchain), <Arc mainnet TBD>.

triggers:
  - claude tenderly audit
  - tenderly stress test
  - audit protocol on vnet
  - tenderly tvl stress
  - tenderly load test
  - claude auditor
  - tenderly auditor
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - WebFetch
  - mcp__tenderly__*
---

# Claude Tenderly Auditor — defensive stress methodology

Pairs Tenderly's MCP surface with a structured stress-test playbook so an
auditor can prove a protocol survives extreme scale BEFORE the adversarial
pass. Output is a public-grade `AUDIT_REPORT.md` matching the canonical
schema in `AUDIT_REPORT_TEMPLATE.md` (companion file in this skill dir).

## When to invoke

Triggers when the user asks for a "stress test", "load test", "10B TVL
test", "scale audit", or any variant of "prove the protocol survives X" on
a Tenderly vnet. Also use after a major migration (hub/spoke topology
change, governance upgrade, oracle swap) to surface scale-class risks
before mainnet rollout.

Don't use for:

- single-contract unit testing (use `forge test`)
- mainnet incident response (this skill is testnet-only)
- adversarial / red-team work (use `/codex-adversarial-tenderly-auditor`)

## Pre-flight (Step 0)

1. **MCP auth.** Verify Tenderly MCP is OAuth'd in the current session.
   `mcp__tenderly__list_projects` should return without error. If it
   surfaces `authenticate` instead, run the OAuth flow and re-check.
2. **Testnet gate.** `mcp__tenderly__get_vnet` → read
   `fork_config.network_id`. Match against the allow-list above. If it
   matches the refuse-list, **HARD REFUSE** with the network_id in the
   error message; never run a stress matrix on mainnet state.
3. **Project context.** `mcp__tenderly__set_active_project` to bind the
   audit to a specific Tenderly project; emit the project slug in the
   report header.
4. **Snapshot.** `mcp__tenderly__snapshot_vnet` → record snapshot_id at
   the top of the audit report. This is the rewind point if anything
   goes sideways; cite it in every subsequent state mutation.

## Step 0.5 — Storage layout audit

Before any stress run, dump the storage layout of every contract under
audit and pin the slot assumptions:

```bash
# For each Solidity contract in the deployment manifest:
forge inspect <ContractName> storage-layout --pretty > /tmp/storage-layouts/<ContractName>.txt
```

Capture into the audit report:

- Slot indices of all mappings, packed-uint structs, immutable proxies
- Any `uint96` / `uint128` / `uint64` packed fields (these are the
  overflow candidates Step 4 will headroom-check)
- Diff against any prior layout if a contract was upgraded (storage
  collision class of bug — silent corruption on upgrade)

If a stress case will read storage via `tenderly_setStorageAt` (e.g. to
inject a balance directly), the slot MUST be derived from this layout
dump, never guessed. Surface as a methodology caveat in the report
otherwise.

## Step 1 — Inventory the hub stack

Read the canonical deployment manifest (`deployments/<chain>.json` or
`deployments/hub-config-*.json`) and verify every address actually has
code on the active vnet:

```ts
// pseudo — adapt to actual addresses
mcp__tenderly__vnet_multicall({
  calls: [
    // for each address: eth_getCode (extcodesize > 0 check)
    // for each token: decimals(), totalSupply()
    // for each ERC4626 receipt: asset(), totalAssets()
    // for each market: Morpho.market(id), idToMarketParams(id)
  ],
});
```

Document the inventory at the top of the report. If a manifest entry is
absent (e.g. `FxSwapHook` not in `hub-config-fuji.json`), mark the
corresponding stress case **BLOCKED** with a one-line "why" in the
out-of-scope table — do NOT silently skip.

Read on-chain parameters (LLTV, oracle config, fee rates, governance
owners) live via `vnet_call` — never trust env files. Document raw +
decoded value in the Environment block.

## Step 2 — Prime the whale persona

Use a deterministic persona address (canonical: `0x1111...1111`) so the
report is reproducible. Fund via MCP:

- `mcp__tenderly__set_erc20_balance(whale, USDC, 0x2386F26FC10000)` (10B @ 6 dec)
- `mcp__tenderly__set_erc20_balance(whale, EURC, 0x2386F26FC10000)`
- `mcp__tenderly__fund_account(whale, 0x56BC75E2D63100000)` (100 native)

**Dogfood note** (inherits `/tenderly-pro` Pattern: live RPC over env files):
read whale balances back via `vnet_multicall` to confirm the writes
landed. `tenderly_setErc20Balance` writes the balance slot but does NOT
bump `totalSupply` — if a contract under audit checks `token.totalSupply()`
against an upper bound, surface that as a methodology caveat in the
report's "Staging artefacts" section.

## Step 3 — Stage oracle / external dependencies

Cold-fork vnets often have stale Pyth feeds. If a price-read reverts with
`CalldataMustHaveValidPayload() = 0xe7764c9e` (RedStone fallback wants a
signed payload on msg.data tail), choose one of:

**A. Real-path freshen.** Fetch a Hermes payload and call
`Pyth.updatePriceFeeds` before any oracle-dependent tx. Highest fidelity
to production but slow + needs network.

**B. Mock oracle install (recommended for stress).** Use admin RPC
`tenderly_setCode` (via Bash curl — the MCP doesn't surface `set_code`
yet) to install a tiny constant-return stub at the `MorphoOracleAdapter`
address(es):

```python
# 41-byte runtime that returns 1e36 (1 collateral = 1 loan token)
# PUSH32 <1e36> PUSH1 0 MSTORE PUSH1 0x20 PUSH1 0 RETURN
code = "0x7f" + f"{10**36:064x}" + "60005260206000f3"
```

For directional crashes (Case S3 liquidation): re-install with
`price = 0.5e36` to push positions underwater.

Document EVERY storage/code mutation in the Staging Artefacts table —
the report must let a reader reproduce the conditions from the snapshot.

## Step 4 — Run the stress matrix

Canonical cases (pick the ones that apply to the protocol; add custom
cases per the user's brief):

### S1. ERC-4626 share-math at scale

Single supply of N (10B / 5B / 1B) of the loan token into the wrapper.
Read `totalAssets`, `totalSupply`, `convertToShares(N/2)`,
`previewWithdraw(N/2)`, `convertToAssets(N/2)`. Roundtrip: deposit →
mine_block → partial withdraw → redeem rest. Confirm 1:1 ratio holds at
fresh-vault initialization (or document `_decimalsOffset()` if non-zero).

**Asserts:** no off-by-one between `expectedSupplyAssets` (Morpho-side)
and `totalAssets` (wrapper-side); full unwind returns user to baseline;
no rounding leakage.

### S2. Leveraged borrow at LLTV - ε

Supply N collateral (e.g. 1B EURC), borrow `0.859 × N × oraclePrice`
(85.9% LTV under 86% LLTV market). Read market state, advance time
(`increase_time` + `mine_block`), call `accrueInterest`, read again.

**Asserts:** linear IRM produces sane APR (`utilization × slope`); rebase
captured by wrapper (e.g. `fxUSDC` share price > 1.0); no uint128
overflow on `totalSupplyShares` (Morpho uses 1e6 virtual-share boost —
log headroom-factor from Step 0.5 layout dump in the report).

### S3. Liquidation + bad-debt realization

Snapshot, crash oracle to e.g. `0.5e36` (50% loss), call liquidator with
`useVerified=false` + empty pythUpdate (bypasses the in-tx oracle
update). Read returned `(seized, repaid)`, compute bonus % against
Morpho's LIF formula (`WAD / (1 - α(1-lltv))`, α=0.3 default), confirm
bad-debt realization atomically deducts from `totalSupplyAssets`.

**Asserts:** Codex-patched `maxRepayAssets` cap holds (transfer-pull then
refund unused); bonus matches LIF formula (NOT a hardcoded percentage —
brief assumptions often diverge from on-chain reality); supplier haircut
= `badDebt / totalSupplyAssets` realized in-block.

### S4. Hook / swap path at size (if applicable)

500M-style swap through the protocol's swap hook. Confirm size-impact,
hot-reserve depletion, JIT-borrow paths fire as designed. If the hook
isn't deployed on the active vnet, mark BLOCKED with the specific
missing dependency (e.g. "Uniswap V4 PoolManager not on Fuji").

### S5. Receive-side / bridge invariants

For protocols with a CCTP-style relay (`FxHubMessageReceiver`):

- Install mock `MessageTransmitter` (~95-byte hand-assembled stub: on
  any call, `token.transfer(msg.sender, AMOUNT)` + return `0x01`)
- Pre-fund the mock with the receive-token (`set_erc20_balance`)
- Construct N distinct nonce messages with valid V2 layout (148B outer +
  228B burn body + hookData = `abi.encode(beneficiary, hubCalldata)`)
- Send `executeDeposit` per nonce, assert:
  - per-nonce `depositState` transitions correctly
  - `allowance(receiver → registry)` resets to 0 after each call
  - balance-delta tracking correct under multi-deposit accumulation
  - replay protection holds on duplicate nonce

If full 1000-scale requires real attestations, scale down (e.g. 4
sampled nonces) and **prove the result generalizes via storage-layout
argument** (mapping access is O(1); per-call state is in-frame).

## Step 5 — Trace any revert via MCP

When `simulate_vnet_transaction` or `send_vnet_transaction` returns
`status: false`:

1. `mcp__tenderly__find_vnet_failures(operation_id)` — get all error
   positions
2. `mcp__tenderly__get_vnet_error_path(operation_id)` — blame chain to
   deepest revert
3. If error is a 4-byte custom-error selector:
   - Grep the repo's `*.sol` files for matching `error Name()` declarations
   - `cast sig "Name()"` to verify
   - Fall back to 4byte.directory: `curl -s "https://www.4byte.directory/api/v1/signatures/?hex_signature=0xSELECTOR"`
   - Last resort: `cast 4byte-decode 0xSELECTOR`

Surface the exact line and root cause; do NOT paper over.

## Step 6 — Compose AUDIT_REPORT.md

Follow `AUDIT_REPORT_TEMPLATE.md` strictly. The report must include:

- Header (vnet ID, fork block, RPC URLs, snapshot IDs, contract inventory)
- Storage layout pins (from Step 0.5)
- Summary table (one row per stress case, PASS/FAIL/BLOCKED/DEFERRED)
- Staging artefacts table (the reproducibility contract)
- Per-case section with: setup, state snapshots, asserts, trace links,
  per-case headroom analysis
- "Overflow / design risks surfaced" table — actionable rows only, each
  with a concrete recommended check + preconditions column
- "Out-of-scope / blocked" table with explicit unblock paths
- "Reproducer" appendix: snapshot ID + minimal command sequence

Save to `reports/AUDIT_REPORT.md` (or `reports/audit-<protocol>-<date>.md`
if multiple audits coexist).

## Step 7 — Hand-off to adversarial pass (OPT-IN)

After the defensive baseline lands, prompt the user:

> Defensive audit complete. Want to run the adversarial pass with
> `/codex-adversarial-tenderly-auditor`? It will challenge every PASS
> result in this report and propose attack vectors against the surfaced
> risks.

**Do NOT auto-run.** The adversarial skill is opt-in — the user must
explicitly invoke it.

## Rules

### Security

- **TESTNET ONLY.** Refuse any `network_id` in the refuse-list at Step 0.
- **NEVER** echo `TENDERLY_ACCESS_KEY` or admin-RPC URLs containing the
  vnet UUID into the audit report's public-facing sections. Redact to
  `https://virtual.<chain>.rpc.tenderly.co/<REDACTED>` in the public copy.
- **NEVER** commit `.env.local` or any file containing the admin RPC.
- **ALWAYS** snapshot before destructive ops; cite snapshot_id in the
  report's reproducer block.

### Best practices

- **Dogfood live state**: read balances + market state via `vnet_call` /
  `vnet_multicall` after every mutation. Don't trust env files or
  pre-computed expectations.
- **Prefer admin RPC** for ops the MCP doesn't expose yet
  (`tenderly_setCode`, `tenderly_setStorageAt` for arbitrary slots).
- **Pattern G branching** (from `/tenderly-pro`): snapshot before each
  independent case so you can `revert_vnet` between scenarios without
  re-priming.
- **Quote everything in the report**: trace URLs, snapshot IDs, raw
  return-data hex. The report is forensic, not narrative.
- **Document blockers loudly**: if a stress case can't run (missing
  contract, missing dependency), mark it BLOCKED in the summary table
  with a one-line unblock path.
- **Pin storage layouts** from Step 0.5 before any `setStorageAt` op.
  Slot guesses are silent-corruption hazards.

### Style

- Sacrifice prose for tables in the body.
- Lead with results, then setup. Reader scanning for "did anything
  break?" should know in 10 seconds.
- Numbers in raw + decoded form (`0x38d7ea4c68000 = 1e15 = 1B USDC`).
- Annualized rates always include the elapsed window used to compute
  them (266s → APR extrapolation; not "APR" alone).
- Severity rubric is actionable-only — every risk row carries a
  "Recommended check" column. No "Theoretical-only" tier; if it's not
  actionable at audit scale, fold it into Low with explicit preconditions.

## Reference

- `AUDIT_REPORT_TEMPLATE.md` (companion file in this skill) — canonical schema
- `/tenderly-testnet` — base workflow + safety gates
- `/tenderly-pro` — Pattern A–H including snapshot-branching (G)
- `/codex-adversarial-tenderly-auditor` — sibling skill that runs the
  adversarial pass over the artefacts this skill produces

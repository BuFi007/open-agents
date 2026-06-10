# {{protocol_name}} — {{audit_title}}

**Date:** {{YYYY-MM-DD}}
**Auditor:** {{handle}} (Claude {{model_tag}} via `/claude-tenderly-auditor`)
**Adversarial pass:** {{ref to /codex-adversarial-tenderly-auditor output, or "not yet run"}}

## Environment

| Field              | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Vnet ID            | `{{uuid}}` (slug `{{slug}}`)                                             |
| Fork chain         | {{chain_name}} ({{chain_id}}) @ block `{{block_hex}}`                    |
| Admin RPC          | `https://virtual.<chain>.rpc.tenderly.co/<REDACTED>`                     |
| Public RPC         | `https://virtual.<chain>.rpc.tenderly.co/<REDACTED>`                     |
| Dashboard          | `https://dashboard.tenderly.co/{{account}}/{{project}}/testnet/{{uuid}}` |
| Pre-audit snapshot | `{{snapshot_id_0}}` (clean fork, persona unfunded)                       |
| Per-case snapshots | `{{snapshot_id_n}}` ({{description}})                                    |

**Test persona:** `{{whale_addr}}` — primed to `{{X}}` of token A, `{{Y}}` of
token B, `{{Z}}` native via MCP admin ops. Reproduction commands in
§Reproducer.

**Contracts under audit:**

| Role               | Address | Source          |
| ------------------ | ------- | --------------- |
| `{{ContractName}}` | `0x...` | `{{path:line}}` |
| ...                | ...     | ...             |

Key on-chain parameters read live (NOT from env):

| Param                          | Value (raw)                            | Decoded         |
| ------------------------------ | -------------------------------------- | --------------- |
| `LLTV` (market M2)             | `0x0bef55718ad60000`                   | 86%             |
| `oracle.price()` (after stage) | `0x...0c097ce7bc90715b34b9f1000000000` | 1e36 (1:1 mock) |
| ...                            | ...                                    | ...             |

## Storage layout pins (from `forge inspect`)

Overflow candidates and packed-storage fields enumerated before stress
matrix runs:

| Contract               | Slot | Field                          | Type    | Headroom @ audit scale |
| ---------------------- | ---- | ------------------------------ | ------- | ---------------------- |
| `Morpho`               | 5.0  | `market[id].totalSupplyAssets` | uint128 | `1.7e17×`              |
| `Morpho`               | 5.16 | `market[id].totalSupplyShares` | uint128 | `1.7e17×`              |
| `FxHubMessageReceiver` | 1    | `_deposits[nonce].amount`      | uint96  | `~7.9e22 USDC`         |
| ...                    | ...  | ...                            | ...     | ...                    |

Layout dumps captured in `/tmp/storage-layouts/<Contract>.txt`. Any
`setStorageAt` op in §Staging Artefacts references slots from this table.

---

## Summary

| #   | Case                  | Result                                           | Trace                 |
| --- | --------------------- | ------------------------------------------------ | --------------------- |
| S1  | {{case_1_short_name}} | **PASS** / **FAIL** / **BLOCKED** / **DEFERRED** | [link]({{trace_url}}) |
| S2  | ...                   | ...                                              | ...                   |
| ... | ...                   | ...                                              | ...                   |

**Risks surfaced (not patched — adversarial pass next):** {{N}} actionable. See §Risks.

---

## Methodology

This audit was produced by `/claude-tenderly-auditor` v{{version}}. The
skill prescribes:

1. Snapshot-first (Tenderly Pattern G) before any destructive op.
2. Storage-layout pinning via `forge inspect` for every contract under audit.
3. Live-state inventory (extcodesize > 0, constructor params via getter
   calls).
4. Persona priming via MCP `set_erc20_balance` + `fund_account`.
5. Staged externals (mock oracle / mock bridge transmitter) where the
   live fork lacks fresh data — every mock documented under §Staging
   artefacts so results are reproducible.
6. Per-case state-mutation runs through `send_vnet_transaction`, with
   simulate-first to capture return data + revert reason.
7. Trace-driven debug: `find_vnet_failures` → `get_vnet_error_path` →
   4-byte selector resolution.
8. Overflow analysis: from Step 0.5 layout dump, compute headroom factor
   (`type_max / observed_max`) for every packed field touched at audit
   scale.

**Out of scope:** mainnet behavior, gas-price economics, MEV / sandwich
attacks (those belong to `/codex-adversarial-tenderly-auditor`), formal
verification, optimizer-driven equivalence.

---

## Staging artefacts (REPRODUCIBILITY)

Every mutation that diverges from a clean fork is listed here in
execution order. The audit is INVALID without re-applying these in order.

| #   | Op                             | Target             | Value                                | Reason                                                                                                                                   |
| --- | ------------------------------ | ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `snapshot_vnet`                | —                  | `{{snap_id}}`                        | Clean-fork rewind point                                                                                                                  |
| 2   | `set_erc20_balance`            | `{{whale}} @ USDC` | `0x2386F26FC10000`                   | 10B whale fund                                                                                                                           |
| 3   | `tenderly_setCode` (admin RPC) | `{{adapter}}`      | 41-byte stub returning `1e36`        | Pyth feed stale on fork; mock 1:1 oracle for deterministic math. Staging only — NOT a finding.                                           |
| 4   | `tenderly_setCode` (admin RPC) | `{{transmitter}}`  | 95-byte mock CCTP MessageTransmitter | Real CCTP attestations can't be forged on a single-chain vnet. Mock matches return shape of `receiveMessage(bytes,bytes)`. Staging only. |
| ... | ...                            | ...                | ...                                  | ...                                                                                                                                      |

---

## Case S{{N}} — {{case_title}}

**Hypothesis:** {{what we expect to hold at this scale}}.

**Setup:**

1. {{step 1 — incl. snapshot_id used as starting state}}
2. {{step 2}}
3. {{step 3}}

**State snapshots:**

| State         | Field           | Pre        | Post       | Δ           |
| ------------- | --------------- | ---------- | ---------- | ----------- |
| `totalAssets` | `FxReceiptUSDC` | `0`        | `1e15`     | `+1B USDC`  |
| `share price` | derived         | `1.000000` | `1.000002` | `+1.56 ppm` |
| ...           | ...             | ...        | ...        | ...         |

**Asserts:**

- ☑ {{assertion 1 with on-chain proof}}
- ☑ {{assertion 2 with on-chain proof}}
- ☐ {{assertion that FAILED — link to trace + decoded error}}

**Result:** PASS / FAIL / BLOCKED / DEFERRED — {{one-line conclusion}}

**Traces:**

- {{step_label}}: `0x{{tx_hash}}` ([dashboard]({{url}}))
- ...

**Per-case headroom analysis:**

| Field               | Type    | Max         | Observed | Headroom  |
| ------------------- | ------- | ----------- | -------- | --------- |
| `totalSupplyShares` | uint128 | `3.4028e38` | `2e21`   | `1.7e17×` |
| ...                 | ...     | ...         | ...      | ...       |

**Risks surfaced (this case):** R{{x}}, R{{y}} — see §Risks table.

---

(repeat per case)

---

## Overflow + design risks surfaced

Actionable rows only. Each row carries a concrete recommended check. No
purely-theoretical risks listed; if a finding requires preconditions
outside realistic protocol bounds, it appears under Low with the
preconditions explicitly stated.

| #   | Class     | Severity                  | Surface         | One-liner       | Preconditions                                                              | Recommended check                  |
| --- | --------- | ------------------------- | --------------- | --------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| R1  | {{class}} | {{Low/Med/High/Critical}} | `{{path:line}}` | {{description}} | {{e.g. "requires first-depositor race before hub-flow mints first share"}} | {{audit-test or patch suggestion}} |
| R2  | ...       | ...                       | ...             | ...             | ...                                                                        | ...                                |

Severity rubric:

- **Critical** — protocol-wide loss-of-funds at audit scale; demonstrated, not theoretical.
- **High** — loss-of-funds with realistic preconditions; demonstrated.
- **Medium** — loss-of-funds with narrow preconditions, OR economic griefing at scale.
- **Low** — ergonomic / operational / defence-in-depth concern; no fund loss at realistic preconditions. Preconditions column captures why it's narrow.

---

## Out-of-scope / blocked

Cases that this audit could NOT run, with concrete unblock paths so the
next iteration can pick them up:

| Case   | Blocker                             | Unblock path                                                                  | Est. effort |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------- | ----------- |
| S{{x}} | {{e.g. FxSwapHook not on Fuji hub}} | {{e.g. fork Base Sepolia for swap-hook tests, or deploy stub V4 PoolManager}} | {{hours}}   |
| ...    | ...                                 | ...                                                                           | ...         |

---

## Reproducer

```bash
# 1. Auth + activate (Tenderly MCP must be OAuth'd in the session)
# mcp__tenderly__set_active_project --account_slug={{a}} --project_slug={{p}}
# mcp__tenderly__set_active_vnet --vnet_id={{uuid}}
# mcp__tenderly__revert_vnet --snapshot_id={{snap_id}}    # clean state

# 2. Re-apply staging artefacts (see §Staging artefacts table for the canonical sequence)
# ...

# 3. Per-case command sequences are in the body of each §Case S{{N}} section.
```

Raw calldata builders + decode helpers used during the audit:

```python
# (paste the python helpers used for selector encoding / state decoding here)
```

---

## Sign-off

| Field            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Methodology      | `/claude-tenderly-auditor` v{{version}}                  |
| Model            | Claude Opus 4.7 (`claude-opus-4-7`)                      |
| Date             | {{ISO date}}                                             |
| Defensive pass   | ☑ Complete                                               |
| Adversarial pass | ☐ Pending — invoke `/codex-adversarial-tenderly-auditor` |
| Next action      | {{user decision — patch, re-test, deploy gating, etc.}}  |

This report is reproducible from the snapshot ID + staging-artefacts
table. Any divergence in re-runs MUST be investigated — the methodology
is forensic, not statistical.

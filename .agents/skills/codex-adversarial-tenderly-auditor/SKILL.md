---
name: codex-adversarial-tenderly-auditor
version: 1.0.0
description: |
  Adversarial follow-up to /claude-tenderly-auditor. Reads the defensive
  AUDIT_REPORT.md produced by that skill and asks Codex CLI to challenge
  every PASS row, propose attack vectors against the surfaced risks, and
  attempt to weaponize the staging artefacts (mock oracle crashes,
  setStorageAt slot writes, impersonated CCTP messages) into demonstrable
  exploit paths on the same vnet.

  Pairs `/codex:adversarial-review`-style execution (Codex stdout returned
  verbatim, no paraphrase) with full Tenderly MCP access so Codex sees
  live chain state — vnet block height, primed snapshots, real revert
  surfaces — not just the diff.

  Output appends an "Adversarial findings" section to the existing
  AUDIT_REPORT.md (or writes a sibling `AUDIT_REPORT_ADVERSARIAL.md`),
  using the same canonical schema as the defensive pass.

  HARD RULE — TESTNET ONLY (inherited from /tenderly-testnet): refuses any
  review whose active vnet `fork_config.network_id` is a mainnet ID.

  Allow-list (testnets only):
    11155111 (Sepolia), 84532 (Base Sepolia), 11155420 (Optimism Sepolia),
    421614 (Arbitrum Sepolia), 80002 (Polygon Amoy), 43113 (Avalanche Fuji),
    1301 (Unichain Sepolia), 4801 (Worldchain Sepolia), 5042002 (Arc Testnet).
  Refuse-list:
    1, 8453, 10, 42161, 137, 43114, 130, 1923, <Arc mainnet TBD>.

triggers:
  - codex tenderly auditor
  - codex adversarial audit
  - adversarial tenderly audit
  - challenge audit report
  - codex challenge stress test
  - adversarial pass on audit
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - WebFetch
  - AskUserQuestion
  - mcp__tenderly__*
---

# Codex Adversarial Tenderly Auditor

Sibling to `/claude-tenderly-auditor`. Reads its `AUDIT_REPORT.md`
artefact, points Codex at the live vnet, and asks Codex to **break** the
defensive baseline.

## When to invoke

User-driven only — this skill is opt-in and triggered after the
defensive audit lands. Common entry points:

- "Run the codex adversarial pass on `reports/AUDIT_REPORT.md`"
- "Challenge every PASS in the audit"
- "Try to weaponize the surfaced risks into a real exploit"

If the user invokes this without a defensive report present, **STOP and
ask** which protocol/vnet should be audited — there is no useful
adversarial pass without a baseline.

## Prerequisites

1. **A defensive `AUDIT_REPORT.md` exists** at `reports/AUDIT_REPORT.md`
   (or path passed in args). Read it first; the report contains the
   snapshot IDs, staging artefacts, and risk rows the adversarial pass
   will target.
2. **Tenderly MCP authenticated** in the current session
   (`mcp__tenderly__list_projects` returns).
3. **Codex CLI available** via `~/.claude/skills/codex/` runtime.
4. **Active vnet matches the report**. Read
   `mcp__tenderly__get_vnet` and confirm `vnet_id` matches the report
   header. If mismatched, ABORT and ask which vnet to use.

## Step 0 — Safety gate

Identical to `/claude-tenderly-auditor`:

1. `mcp__tenderly__get_vnet` → `fork_config.network_id`
2. Match against allow-list. Refuse on any mainnet ID with the network_id
   in the error.
3. Refuse if the report header references a mainnet network_id (someone
   handed you a bogus defensive report).

## Step 1 — Restore from defensive snapshot

The defensive audit ran a sequence of staged mutations. To run the
adversarial pass on the same starting state:

1. Read the §Staging Artefacts table from `AUDIT_REPORT.md`
2. `mcp__tenderly__revert_vnet(snapshot_id=<entry #1 in table>)` —
   clean fork
3. Re-apply staging artefacts in order (re-fund whale, re-install mock
   oracle / mock transmitter). Use the canonical Bash+MCP commands from
   the report's §Reproducer block.
4. `mcp__tenderly__snapshot_vnet` → new adversarial-base snapshot. Cite
   in the appended findings section.

This gives Codex a deterministic starting point identical to the
defensive baseline.

## Step 2 — Build the Codex prompt

Compose the prompt with these sections (in order):

### 2a. Inheritance block

```
You are running an ADVERSARIAL audit pass over a defensive baseline.
The defensive auditor (Claude /claude-tenderly-auditor) ran the stress
matrix at <vnet_id> and produced reports/AUDIT_REPORT.md. Your job is
to CHALLENGE every PASS row and propose attack vectors against the
surfaced risks.

You have full Tenderly MCP access. Test your hypotheses against the
LIVE vnet — do not just reason from the diff.

Hard rules:
- TESTNET ONLY (network_id ∈ allow-list above).
- Snapshot before any destructive op. Use Pattern G branching.
- Append findings to reports/AUDIT_REPORT.md under an "Adversarial
  Findings" section. Do NOT rewrite the defensive sections.
```

### 2b. Defensive report verbatim

Paste the entire `AUDIT_REPORT.md` content. Codex needs:

- Snapshot IDs (to revert/branch)
- Staging artefacts table (to know what's mocked)
- Storage layout pins (to know what slots are valid `setStorageAt` targets)
- Risks surfaced (the seed list for adversarial exploitation)
- Trace links + state-snapshot tables (to know what "normal" looks like)

### 2c. Adversarial agenda

Append these standing challenges (every adversarial pass MUST address
each; user-supplied additions go on top):

1. **PASS rows as preconditions for attack.** For each PASS, ask: "What
   precondition does this PASS implicitly assume, and can I violate it?"
   E.g., Case S1 PASS assumes the wrapper is empty at first deposit —
   try inflation-attack the first deposit by racing a direct USDC
   `transfer` to the wrapper before any user's `deposit()`.

2. **Weaponize the staging artefacts.** The mock oracle / mock
   transmitter / setErc20Balance writes are AUDIT ARTEFACTS, but they
   also represent capabilities an attacker has IF they ever land in
   production (e.g., a governance takeover swapping the oracle, or a
   compromised relayer). For each artefact: assume the attacker has
   that capability and attempt to drain funds.

3. **Compose risks.** The defensive report lists risks in isolation.
   Adversarial pass: try chaining two-or-more risks. E.g., R3 (4.38%
   bonus vs 5% assumption) + R4 (bad-debt rounding) — does the
   combination create a MEV path where a liquidator can profit by
   over-liquidating at the boundary?

4. **Out-of-scope items as primary attack surface.** Cases marked
   BLOCKED or DEFERRED in the defensive report are NOT proven safe —
   they're untested. Try to construct the missing dependency (e.g.,
   deploy a stub UniV4 PoolManager for S4) and run the adversarial
   case Codex believes is most dangerous.

5. **Trace divergence.** For every Codex hypothesis: run the actual tx
   through `simulate_vnet_transaction` and link the trace URL. A
   hypothesis without an on-chain trace is a guess, not a finding.

6. **Severity downgrade attempt.** For every Critical / High risk in
   the defensive report: try to prove it's actually Medium or Low by
   running the realistic-precondition path on-chain. If Codex can't
   trigger it under realistic conditions, downgrade with justification.

### 2d. Output format

Codex must output findings using the **same severity rubric and table
schema** as the defensive `AUDIT_REPORT.md` (no "Theoretical" tier —
actionable rows only, with explicit preconditions). Findings go in a
new section appended to the report:

```markdown
## Adversarial findings (Codex pass)

**Pass date:** {{ISO date}}
**Codex run id:** {{...}}
**Adversarial-base snapshot:** {{snap_id_from_step_1}}

### Challenged PASS rows

| Defensive case | Defensive result | Adversarial verdict          | Trace |
| -------------- | ---------------- | ---------------------------- | ----- |
| S1             | PASS             | UPHELD / **BROKEN — see F1** | ...   |
| ...            | ...              | ...                          | ...   |

### New findings

| #   | Class     | Severity                     | Surface         | One-liner       | Preconditions               | PoC trace  | Recommended check |
| --- | --------- | ---------------------------- | --------------- | --------------- | --------------------------- | ---------- | ----------------- |
| F1  | {{class}} | {{Critical/High/Medium/Low}} | `{{path:line}}` | {{description}} | {{realistic preconditions}} | `0x{{tx}}` | {{patch or test}} |

### Severity reassessments of defensive risks

| Defensive # | Defensive severity | Adversarial verdict | Justification |
| ----------- | ------------------ | ------------------- | ------------- |
| R3          | Operational        | UPHELD              | ...           |
| ...         | ...                | ...                 | ...           |
```

## Step 3 — Invoke Codex

```bash
# Codex CLI runtime is at ~/.claude/skills/codex/
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/codex}/scripts/codex-companion.mjs" \
  adversarial-review \
  --include-file reports/AUDIT_REPORT.md \
  --include-file /tmp/storage-layouts/*.txt \
  "$(cat /tmp/codex-adversarial-prompt.txt)"
```

The Codex runtime has its own session continuity — for multi-turn
challenges, use `/codex:consult` follow-ups.

## Step 4 — Hand-off Codex output verbatim, append to report

Per `/codex:adversarial-review` rules:

- Return Codex stdout exactly as-is. Do not paraphrase or summarize.
- Do not fix issues raised. That's the implementation phase, separate
  from this audit.
- Append Codex output under the `## Adversarial findings (Codex pass)`
  heading in `reports/AUDIT_REPORT.md` (or write to
  `reports/AUDIT_REPORT_ADVERSARIAL.md` if the user prefers a separate
  file).
- Update the sign-off table:
  ```
  | Adversarial pass | ☑ Complete — see §Adversarial findings |
  ```

## Step 5 — Re-run defensive cases against new findings

If Codex's adversarial pass surfaces any **High** or **Critical**
finding that BROKE a defensive PASS:

1. Snapshot before re-test
2. Re-run the affected defensive cases under the adversarial
   preconditions
3. Append the re-run state tables to the affected `## Case S{{N}}`
   sections — clearly marked "Adversarial re-test"
4. Update the defensive Summary table row from PASS → **PASS (defensive)
   / BROKEN (adversarial)** so the asymmetric result is visible at a glance

## Patterns Codex should be primed to challenge

Append these standing prompts to §2c unless the user already covered
them:

1. **First-depositor race on ERC-4626 wrappers** — even if hub flow
   "guarantees" the first deposit is bridged, what if a direct USDC
   transfer lands first? Inflation-attack the share-price ratio.

2. **Oracle compromise → liquidation cascade** — assume governance
   takeover or compromised oracle signer. Use `tenderly_setCode` to
   simulate a price spike or crash in one block; chain multiple
   liquidations; measure realized bad debt and supplier haircut.

3. **CCTP V2 hookData malleability** — the hub receiver binds
   `hookData == keccak(abi.encode(beneficiary, hubCalldata))`. Codex
   should try constructing a `hubCalldata` that is benign on inspection
   but pulls USDC to a controlled address via `transferFrom` after the
   receiver's `forceApprove` window (race-condition class).

4. **Liquidation bonus economics** — at 4.38% bonus (Morpho LIF, not
   the brief's assumed 5%), what's the keeper-loss line for a 1B
   liquidation? Can an attacker grief liquidations by frontrunning
   the keeper's repay tx with a smaller, profit-extracting liquidation?

5. **Stranded-deposit grace window MEV** — at 1000 stranded entries,
   can a malicious beneficiary sweep their entry AND inject a new
   stranded entry at the same nonce slot via storage collision? Verify
   slot derivation from Step 0.5 layout dump.

6. **Bad-debt socialization order** — when N positions go underwater
   in one block, does the order of liquidations affect the realized
   haircut per supplier? If yes, that's MEV.

7. **uint96 truncation on extreme messages** — even if Circle caps real
   burnAmount, can Codex construct a CCTP message with mintedAmount
   above 2^96 that truncates silently in `uint96(minted)`? The mock
   transmitter can be reconfigured to mint > 2^96 — try it.

## Rules

### Security

- **TESTNET ONLY**. Mainnet network_id = HARD REFUSE.
- **NEVER** echo admin-RPC URLs containing vnet UUIDs in the public
  report. Redact identically to the defensive pass.
- **NEVER** propose attacks against live mainnet contracts. The
  adversarial pass is a thought experiment on the vnet only.
- **ALWAYS** snapshot before each adversarial scenario; chain-of-custody
  must be reproducible.
- **ALWAYS** include trace URLs for findings — a finding without an
  on-chain proof is downgraded to "hypothesis".

### Best practices

- **Codex stdout verbatim** — no summary, no paraphrase. This is a
  /codex:adversarial-review-style hand-off.
- **Pattern G branching** between scenarios — never run two adversarial
  scenarios from the same starting state without resetting via
  `revert_vnet`.
- **One snapshot per scenario** — each F-number finding has its own
  snapshot_id so reviewers can replicate without re-running the entire
  pass.
- **Append, never rewrite** — the defensive report's sections are
  immutable. Adversarial output goes in a new section only.

### Style

- Tables over prose.
- Severity reassessments must include justification — never lower a
  defensive severity without a Codex trace proving the realistic-
  precondition path can't trigger it.
- Findings are CONCRETE: contract:line + trace URL + recommended check.
  "There may be an issue with X" is not a finding.

## Reference

- `/claude-tenderly-auditor` (sibling skill — produces the defensive
  baseline this skill challenges)
- `AUDIT_REPORT_TEMPLATE.md` in `/claude-tenderly-auditor` skill dir —
  canonical schema both skills emit
- `/codex:adversarial-review` (the underlying review primitive)
- `/codex-adversarial-review-tenderly-testnet` (older sibling — diff-
  centric review; this skill is artefact-centric)
- `/tenderly-pro` Pattern G (snapshot branching)

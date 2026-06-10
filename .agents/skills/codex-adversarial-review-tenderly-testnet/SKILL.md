---
name: codex-adversarial-review-tenderly-testnet
version: 1.0.0
description: |
  Tenderly-aware adversarial review by Codex. Probes the live Tenderly
  Virtual TestNet, transactions RPC, simulator state, and deployed-contract
  surface BEFORE invoking codex, so the model reviews real chain reality —
  not just the diff. Pairs the `/codex:adversarial-review` runtime with the
  `/tenderly-testnet` workflow knowledge.

  Use when the user wants Codex to challenge the design with full Tenderly
  context: live vnet block heights, account/project quotas, primed-state
  inventory, and an actual transactions-RPC dry-run of the protocol being
  reviewed.

  HARD RULE — TESTNET ONLY (inherited from /tenderly-testnet): refuses
  any review whose Tenderly env points at a mainnet network_id (1, 8453,
  10, 42161, 137, 43114, 130).

triggers:
  - codex adversarial review tenderly
  - codex tenderly testnet
  - adversarial review with tenderly rpc
  - review using transactions rpc
  - review using virtual testnet
  - codex challenge tenderly simulations
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - WebFetch
  - AskUserQuestion
---

# Codex Adversarial Review — Tenderly TestNet edition

`/codex:adversarial-review` reviews a git diff. This skill goes further: it
asks Codex to challenge the protocol's behavior **under realistic Tenderly
state** — vnet at current head, transactions executing through the live
transactions RPC, simulations exercised on the same primed snapshot the
production matrix would use.

## When to use

Triggers automatically when the user's review request mentions any of:

- **transactions RPC** / **transactions endpoint** / **tx RPC**
- **simulate** / **simulation** / **simulator** in a Tenderly context
- **virtual testnet** / **vnet** / **fork**
- **primed state** / **primed vnet** / **prime-vnet**
- **trace** / **state override** / **state_objects**

Also use when the user explicitly types `/codex:adversarial-review:tenderly-testnet`
(or the shortcut `/codex-tenderly-testnet`).

## Why a dedicated skill

Plain `/codex:adversarial-review` only knows the diff. For a protocol that
deploys across spokes + hub + a CCTP V2 bridge + Uniswap v4 hook, the diff
misses a huge amount of _production reality_:

- whether the LIVE vnet is at the patched contracts or stale ones
- whether **transactions RPC** behavior matches the test-suite assumptions
- whether the **primed vnet** the runner expects actually has the state it
  claims (Codex's Drop-9 finding #2 was exactly this — bootstrap claimed
  to prime personas + oracle, only funded ETH)
- whether the user's Tenderly quotas (20 monitored addresses, 2 vnets,
  max block height per vnet, TUs/s rate limit) are about to blow up the
  next sim run

This skill gathers all of that _before_ shipping the diff to Codex.

## Step 0 — Safety gate (inherits /tenderly-testnet)

Refuse if any of these network IDs appear in `.env.local`:

| Blocked | Chain     |
| ------- | --------- |
| 1       | Ethereum  |
| 10      | Optimism  |
| 137     | Polygon   |
| 8453    | Base      |
| 42161   | Arbitrum  |
| 43114   | Avalanche |
| 130     | Unichain  |

## Step 1 — Probe Tenderly state

Run these in parallel and capture into a single `tenderly-context.md` file
that Codex will read alongside the diff:

```bash
set -a; source .env.local; set +a

API="https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT"

# 1) Project quota: addresses monitored count vs 20-cap
curl -s -H "X-Access-Key: $TENDERLY_ACCESS_KEY" "$API/contracts" \
  | jq '[.[] | {id, account_type, display_name, verification_type}]' \
  > /tmp/tenderly-contracts.json

# 2) Vnet inventory: ids, slugs, source network, fork block, max block height
curl -s -H "X-Access-Key: $TENDERLY_ACCESS_KEY" "$API/vnets" \
  | jq '[.[] | {id, slug, display_name, network_id: .fork_config.network_id, block: .fork_config.block_number, last_block: .last_block_number}]' \
  > /tmp/tenderly-vnets.json

# 3) If a primed vnet env is set, probe its head + key contracts via the
#    transactions RPC. This is the killer feature — Codex gets to see what
#    `eth_call` would return RIGHT NOW for the contracts under review.
if [ -n "${TENDERLY_PRIMED_VNET_PUBLIC_RPC:-}" ]; then
  for METHOD in eth_chainId eth_blockNumber eth_gasPrice; do
    curl -s -X POST -H "Content-Type: application/json" \
      "$TENDERLY_PRIMED_VNET_PUBLIC_RPC" \
      -d "{\"jsonrpc\":\"2.0\",\"method\":\"$METHOD\",\"params\":[],\"id\":1}"
  done > /tmp/tenderly-primed-rpc.json
fi
```

The output goes into the codex focus text via `--include-file` (companion
script accepts file attachments), so codex sees live state.

## Step 2 — Dry-run a small set of transactions through transactions RPC

The Tenderly transactions RPC (the same `*_PUBLIC_RPC` URL the vnet exposes)
accepts standard JSON-RPC, including `eth_sendRawTransaction` for any
pre-signed tx. Before handing the diff to codex, do up to 3 representative
`eth_call`s against the deployed contracts:

```bash
# Example: read FxOracle.config() to confirm the patched contract is live
curl -s -X POST -H "Content-Type: application/json" \
  "${TENDERLY_PRIMED_VNET_PUBLIC_RPC:-https://sepolia.base.org}" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[
      {"to":"<FxOracle addr from deployments/base-sepolia.json>",
       "data":"0x79502c55"},
      "latest"
    ],
    "id":1
  }'
```

If a call returns unexpected data (e.g., the deployed contract is v3 while
the diff is for v4), **stop and surface that to Codex first** — the review
is being run against stale state and would produce false-positive findings.

## Step 3 — Compose Codex prompt with live context

Concatenate:

1. The user's original adversarial focus text (preserve verbatim).
2. A `<tenderly_context>` block:
   - project quota: `N/20 addresses monitored`
   - vnet inventory with last-block, max-block-height warnings
   - primed-vnet RPC reachability + chainId + block number
   - 3 eth_call probes against the contracts under review, with results
3. A `<known_failures>` block from the most recent
   `reports/sim-matrix-latest.md` — Codex should know which categories the
   suite already flags as expected-fail.

Then invoke the underlying codex companion:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/cache/openai-codex/codex/1.0.4}/scripts/codex-companion.mjs" \
  adversarial-review \
  --base main \
  "$(cat /tmp/tenderly-prompt.txt)"
```

## Step 4 — Hand-off Codex output verbatim

Per `/codex:adversarial-review` rules:

- Return Codex stdout exactly as-is.
- Do not paraphrase or summarize.
- Do not fix issues raised. That's the implementation phase, separate
  from this review.

## Patterns Codex should be asked to challenge

When composing the focus text, append these standing adversarial prompts
(unless the user already covered them):

1. **Primed vnet drift** — "Does the diff claim primed-vnet behavior that
   the bootstrap doesn't actually wire? Specifically check whether
   `TENDERLY_USE_PRIMED_VNET=1` actually routes execution, or only logs."
2. **Quota blow-up** — "If the matrix grows past the 20-address Tenderly
   free-plan cap or the 2-vnet cap, where does the next run silently
   skip cases instead of failing loudly?"
3. **Transactions-RPC vs /simulate divergence** — "Are there protocol
   paths that pass via `/simulate` (forked fresh per call) but fail
   under the persistent state of a transactions-RPC sim? Common culprits:
   stateful re-entrancy guards, allowances that accumulate across calls,
   block-timestamp-sensitive code."
4. **Setcode mocks vs real contracts** — "When the suite `setCode`-overrides
   the MessageTransmitter (Drop 6/7), does the mock match the real
   contract's gas profile and revert surface? A passing setcode sim
   doesn't prove the real CCTP V2 path works."
5. **Storage-slot assumptions** — "Drop 5 found `_deposits` at slot 0
   only via `forge inspect ... storage-layout`. Are there other contracts
   whose slot the suite hardcodes that could shift under an OZ version
   bump or a transient-storage migration?"

## Rules

### Security

- **NEVER** echo `TENDERLY_ACCESS_KEY` into the codex prompt text. Redact
  before including any curl output.
- **NEVER** include private keys in the context block. Mask addresses if
  the user has indicated they're sensitive.
- **NEVER** run this skill against a mainnet network_id. Hard-refuse.
- **ALWAYS** redact `TENDERLY_PRIMED_VNET_*_RPC` URLs in displayed output
  — they're bearer tokens.

### Best practices

- **ALWAYS** include a `<known_failures>` block from the latest sim report.
  Codex shouldn't surface known limitations as new findings.
- **ALWAYS** verify the deployed contract version matches the diff
  (via `eth_call` to a known view function) before running codex.
- **PREFER** background execution for any non-trivial diff — Codex
  adversarial review on a 100-file diff easily takes 5-10 minutes.
- **PREFER** running this skill AFTER the most recent `bun run sim:matrix`
  so the report is fresh.

## Reference

- /tenderly-testnet skill (the production Tenderly workflow this skill builds on)
- /codex:adversarial-review (the underlying review command)
- /codex:status (check on a running background review)
- Tenderly transactions RPC docs: https://docs.tenderly.co/web3-gateway/references/json-rpc-api
- Tenderly Virtual TestNets API: https://docs.tenderly.co/virtual-testnets/develop/rest-api

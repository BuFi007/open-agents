---
name: tenderly-testnet
version: 1.1.0
description: |
  Reusable Tenderly Virtual TestNet + Simulate API workflow for Solidity contract
  development. Forks a public testnet into a persistent sandbox with admin RPC
  powers — fund any wallet, set any ERC-20 balance, time-travel, mutate storage.
  Lets you broadcast `forge script` against real public-infra deps (Morpho, Pyth,
  CCTP, Uniswap v4) without burning testnet gas. Also includes the live-state
  Simulate API patterns (personas, simulate-bundle, setCode mocks, Permit2 slot
  derivation, Pyth-fresh bundle) extracted from the **Hub & Spoke Cross-Chain
  Confidential on Morpho [h&sCCCm]** dogfood — 117+ sim coverage matrix on a
  9-chain CCTP V2 + Uniswap v4 hook + Morpho Blue stack.

  Use when asked to "set up tenderly", "create a virtual testnet", "tenderly vnet",
  "fork base sepolia in tenderly", "deploy to a tenderly fork", or when the user
  needs a persistent dev environment for cross-contract integration testing.

  HARD RULE: TESTNET ONLY. This skill refuses to operate against any mainnet
  network_id (1, 8453, 10, 42161, 137, 43114, 130). For mainnet deploys use a
  proper deploy workflow with multisig + timelock.
triggers:
  - set up tenderly
  - create tenderly virtual testnet
  - tenderly vnet
  - fork testnet in tenderly
  - deploy to tenderly
  - simulate transaction on tenderly
  - simulator matrix
  - primed vnet
  - h&sCCCm
  - hub and spoke confidential morpho
allowed-tools:
  - Bash
  - Write
  - Edit
  - Read
  - WebFetch
---

# Tenderly TestNet — Reusable Workflow

Spin up a Tenderly Virtual TestNet, broadcast a forge deploy against it, and persist live addresses. Designed to be re-run on any project that needs Solidity integration testing against real public-chain infra.

## Step 0 — Safety gate (non-negotiable)

This skill operates **TESTNET ONLY**. Refuse and stop immediately if any of these network IDs are involved:

| Mainnet (BLOCKED) | Chain     |
| ----------------- | --------- |
| 1                 | Ethereum  |
| 10                | Optimism  |
| 137               | Polygon   |
| 8453              | Base      |
| 42161             | Arbitrum  |
| 43114             | Avalanche |
| 130               | Unichain  |

Allowed testnets only: 11155111 (Sepolia), 84532 (Base Sepolia), 421614 (Arb Sepolia), 11155420 (OP Sepolia), 80002 (Polygon Amoy), 43113 (Fuji), 5042002 (Arc Testnet), 10143 (Monad Testnet), 1301 (Unichain Sepolia).

If the user asks for a mainnet fork: explain that Tenderly Virtual TestNets are sandboxes — even forking mainnet doesn't _affect_ mainnet — but this skill is opinionated about TESTNET-only forks to keep blast radius tiny and prevent accidentally testing patterns that rely on mainnet-only liquidity. Suggest they use a dedicated mainnet-staging skill.

## Prerequisites

The user must provide:

- **Tenderly access token** (from Settings → Access Tokens at https://dashboard.tenderly.co/account/authorization)
- **Tenderly account slug** (their username in the URL)
- **Tenderly project slug** (the project they want the vnet in)

These go in `.env.local` (gitignored) at the repo root. **Never** commit, log, or echo the token back to the user.

## Step 1 — Verify access + create `.env.local`

```bash
# Replace with the actual values the user provided
TOKEN="<user-supplied>"
ACCOUNT="<account-slug>"
PROJECT="<project-slug>"

curl -s -L -H "X-Access-Key: $TOKEN" \
  "https://api.tenderly.co/api/v1/account/$ACCOUNT/project/$PROJECT/vnets" \
  | head -c 400
```

If the response is a JSON array (even empty `[]`), auth works. If you get an HTML "Moved Permanently" page, the redirect is fine — `-L` followed it. Hard 401 means the token is invalid.

Then create the gitignored env file:

```bash
cat > .env.local <<EOF
# LOCAL ONLY — gitignored. Rotate this token at https://dashboard.tenderly.co after each session.

TENDERLY_ACCESS_KEY=$TOKEN
TENDERLY_ACCOUNT=$ACCOUNT
TENDERLY_PROJECT=$PROJECT
EOF

# Make sure it's gitignored
grep -q '^\.env\.local$' .gitignore || echo '.env.local' >> .gitignore
git check-ignore .env.local
```

## Step 2 — Choose the source testnet to fork

Pick the chainId that has the public-infra dependencies your contracts need (Morpho on Base Sepolia, Uniswap v4 PoolManager, CCTP V2, etc.). When in doubt, **Base Sepolia (84532)** is the deepest in protocol coverage today.

## Step 3 — Create the Virtual TestNet

The Tenderly API is picky about types: `network_id` and `chain_id` MUST be numbers, not strings. The slug must be lowercase-kebab.

```bash
SOURCE_CHAIN_ID=84532   # Base Sepolia (replace with target)
SLUG="<project>-base-sepolia"
DISPLAY="<Project> Base Sepolia"

VNET_JSON=$(curl -s -L -X POST \
  -H "X-Access-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.tenderly.co/api/v1/account/$ACCOUNT/project/$PROJECT/vnets" \
  -d "{
    \"slug\": \"$SLUG\",
    \"display_name\": \"$DISPLAY\",
    \"fork_config\": { \"network_id\": $SOURCE_CHAIN_ID, \"block_number\": \"latest\" },
    \"virtual_network_config\": { \"chain_config\": { \"chain_id\": $SOURCE_CHAIN_ID } },
    \"sync_state_config\": { \"enabled\": false, \"commitment_level\": \"latest\" },
    \"explorer_page_config\": { \"enabled\": true, \"verification_visibility\": \"src\" }
  }")

echo "$VNET_JSON" | head -c 2000
```

Extract the RPC URLs from the response (`rpcs` array — `Admin RPC` and `Public RPC`). Append them to `.env.local`:

```bash
ADMIN_RPC=$(echo "$VNET_JSON" | jq -r '.rpcs[] | select(.name == "Admin RPC") | .url')
PUBLIC_RPC=$(echo "$VNET_JSON" | jq -r '.rpcs[] | select(.name == "Public RPC") | .url')
VNET_ID=$(echo "$VNET_JSON" | jq -r '.id')
FORK_BLOCK=$(echo "$VNET_JSON" | jq -r '.fork_config.block_number')

cat >> .env.local <<EOF

TENDERLY_VNET_SLUG=$SLUG
TENDERLY_VNET_ID=$VNET_ID
TENDERLY_ADMIN_RPC=$ADMIN_RPC
TENDERLY_PUBLIC_RPC=$PUBLIC_RPC
TENDERLY_FORK_BLOCK=$FORK_BLOCK
EOF
```

Sanity-check the vnet RPC:

```bash
curl -s -X POST -H "Content-Type: application/json" "$PUBLIC_RPC" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","id":1}'
# expect: {"id":1,"jsonrpc":"2.0","result":"0x...."} where 0x.... matches your chainId
```

## Step 4 — Fund the deployer wallet via admin RPC

Use `tenderly_setBalance` to give your test deployer arbitrary native gas. Anvil's standard test key #0 (`0xac0974…ff80` → `0xf39F…b92266`) is the safest choice in shared workflows since it's well-known and obviously throwaway.

```bash
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# 10 ETH = 0x8AC7230489E80000 (18-decimal native gas, regardless of whether the
# underlying token is ETH or USDC — Tenderly normalizes the unit)
curl -s -X POST -H "Content-Type: application/json" "$ADMIN_RPC" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tenderly_setBalance\",\"params\":[\"$DEPLOYER\",\"0x8AC7230489E80000\"],\"id\":1}"
```

Need a test user with ERC-20 USDC? Use `tenderly_setErc20Balance`:

```bash
USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # Base Sepolia USDC
USER=0xCAFE...
curl -s -X POST -H "Content-Type: application/json" "$ADMIN_RPC" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tenderly_setErc20Balance\",\"params\":[\"$USDC\",\"$USER\",\"0xF4240\"],\"id\":1}"
# 0xF4240 = 1_000_000 = 1 USDC (6 decimals)
```

## Step 5 — Broadcast a forge script against the vnet

```bash
# Source .env.local first
set -a; source .env.local; set +a

DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy<Whatever>.s.sol \
    --rpc-url "$TENDERLY_ADMIN_RPC" \
    --broadcast \
    --skip-simulation \
    --slow
```

`--skip-simulation` is necessary because the vnet has admin-mutated state forge can't replay deterministically. `--slow` adds a small per-tx delay so the explorer sees each tx sequentially.

## Step 6 — Persist live addresses

Read the deployment output and write a stable JSON manifest under `deployments/` (NOT gitignored — it's the canonical record):

```bash
mkdir -p deployments
cat > deployments/tenderly-<source-chain>.json <<'EOF'
{
  "network": "tenderly-<source-chain>-vnet",
  "chainId": <source-chain-id>,
  "tenderlyVnetId": "<VNET_ID>",
  "tenderlyVnetSlug": "<SLUG>",
  "forkedFromBlock": "<FORK_BLOCK>",
  "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "contracts": {
    "<Name>": "<0x...>",
    ...
  },
  "external": {
    "<DependencyName>": "<0x...>",
    ...
  }
}
EOF
```

This manifest is the single source of truth for the SDK address registry and any post-deploy scripts (Circle SCP registration, frontend env, etc.).

## Step 7 — Useful admin RPC patterns

Tenderly vnets support a handful of state-manipulation RPC methods that make tests trivial:

| Method                                                | Use                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `tenderly_setBalance(address, hex_amount)`            | Fund any wallet with native gas                                                 |
| `tenderly_setErc20Balance(token, holder, hex_amount)` | Fund any ERC-20 balance directly (skips approvals + faucets)                    |
| `tenderly_setStorageAt(address, slot, value)`         | Mutate any storage slot — useful for putting a contract into an arbitrary state |
| `tenderly_setCode(address, bytecode)`                 | Replace a deployed contract's code (e.g. swap in a debug version)               |
| `evm_increaseTime(seconds)`                           | Time-travel forward (test grace periods, unlock schedules, etc.)                |
| `evm_mine`                                            | Mine a single block at current/future timestamp                                 |
| `evm_setBlockGasLimit(hex_amount)`                    | Loosen gas limit for one tx                                                     |

All of these are POST'd to the **Admin RPC** URL (not Public RPC).

## Step 8 — Hand-off to the dashboard

Tenderly dashboard URL pattern:

```
https://dashboard.tenderly.co/<ACCOUNT>/<PROJECT>/testnet/<VNET_ID>
```

What's available there for free:

- Live transaction list with full call traces (Tenderly's debugger is the killer feature)
- Auto-decoded events ONCE you verify the contract (see Step 9). Without verification, traces show raw calldata + `unverified_contract` type.
- Gas profiler per call
- Web3 Actions (event-driven serverless) — wire alerts here for `DepositStranded`, `OracleDeviation`, or whatever your contracts emit

## Step 9 — Name + verify contracts (so the dashboard is readable)

This is the step nearly every guide skips. **Deploying to a Tenderly vnet (or any chain Tenderly indexes) does NOT automatically register your contracts in the project.** Without this step:

- Transaction traces show raw bytecode/calldata, not function names
- Contracts list shows nothing — entries appear only as anonymous addresses
- Events aren't decoded
- The dashboard's **Contracts** tab stays empty

### What works (and what doesn't)

| Path                                                                                 | What it does                                                                                                                                                                         | When to use                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `POST /api/v1/account/{a}/project/{p}/wallet`                                        | Adds an address with `account_type=wallet`. Even if the address has code, it lands in the **Wallets** tab — not Contracts. The contract entry shows `type=unverified_contract`.      | **EOAs only** (your deployer, end-user accounts). Don't use for contracts. |
| `forge verify-contract --verifier custom --verifier-url <tenderly-etherscan-compat>` | Uploads Solidity source + matches against on-chain bytecode. Sets `account_type=contract`, attaches source for full trace decoding. Tenderly's verifier is etherscan-API-compatible. | **All contracts.** This is the correct path.                               |
| `POST /api/v1/account/{a}/project/{p}/contracts`                                     | The CLI's heavy "upload full Truffle artifact" path. Wants a deeply-shaped request body and frequently 500s.                                                                         | Avoid. Use forge instead.                                                  |

### The verifier URL

Different shape for vnets vs public networks:

```bash
# Public network (e.g. Base Sepolia, Unichain Sepolia, Fuji)
VURL="https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT/etherscan/verify/network/$CHAIN_ID"

# Virtual TestNet — append /verify/etherscan to the vnet RPC
VURL="${TENDERLY_PUBLIC_RPC}/verify/etherscan"
```

### Per-contract command

```bash
# 1. Encode the constructor arguments. Tenderly's verifier REJECTS
#    forge --guess-constructor-args ("Action not supported"), so you must
#    do this manually for each contract.
ARGS=$(cast abi-encode "constructor(address,address,uint256)" 0x... 0x... 600)

# 2. Verify against Tenderly.
forge verify-contract <DEPLOYED_ADDR> src/path/MyContract.sol:MyContract \
  --constructor-args "$ARGS" \
  --verifier custom \
  --verifier-url "$VURL" \
  --etherscan-api-key "$TENDERLY_ACCESS_KEY" \
  --watch
```

For contracts where the same source produces multiple instances (e.g. two ERC-4626 vaults wrapping different assets), `forge verify-contract` correctly attaches source but the `display_name` field is empty — both show as the Solidity contract name. Set a custom display per address:

```bash
ADDR_LC=$(echo "$ADDR" | tr A-Z a-z)
curl -s -X POST \
  -H "X-Access-Key: $TENDERLY_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  "https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT/contract/$CHAIN_ID/$ADDR_LC/rename" \
  -d '{"display_name":"FxReceiptEURC (fxEURC)"}'
```

### Free-plan limits you'll hit

| Limit                                                | Default                   | What happens at cap                                                                                   |
| ---------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Addresses Monitored** (per project, across chains) | 20                        | `HTTP 403 quota_limit_reached` when adding the 21st                                                   |
| **Node total** (vnets per project)                   | 2                         | Can't create a new vnet; must delete one first                                                        |
| **Vnet max block height**                            | ~5000 blocks              | Existing vnet stops accepting new txs with `You have reached the maximum block height` error          |
| **TUs per second**                                   | rate-limited on free plan | Mid-deploy 403s during `forge script` bursts; spread with `--slow` or deploy to a real public testnet |

**Practical impact**: the 20-address cap will bite if you label every external dependency (Morpho, Pyth, USDC, Permit2 ...) on each chain. Skip externals — they're well-known addresses everyone knows. Reserve project slots for the contracts you actually own.

### Cleanup commands

```bash
# List everything in the project
curl -s -H "X-Access-Key: $TENDERLY_ACCESS_KEY" \
  "https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT/contracts" \
  | python3 -c 'import sys,json; [print(x["id"], "|", x.get("display_name","")) for x in json.load(sys.stdin)]'

# Filter to just Contracts (account_type=contract)
curl -s -H "X-Access-Key: $TENDERLY_ACCESS_KEY" \
  "https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT/contracts?accountType=contract"

# Bulk-delete (frees slots toward the 20 cap)
curl -s -X DELETE \
  -H "X-Access-Key: $TENDERLY_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  "https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT/contracts" \
  -d '{"account_ids":["eth:84532:0x...","eth:84532:0x..."]}'

# Tag an existing entry (orthogonal to display_name — appears in Tags column)
curl -s -X POST \
  -H "X-Access-Key: $TENDERLY_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  "https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT/tag" \
  -d '{"contract_ids":["eth:84532:0x..."],"tag":"hub-v3"}'
```

### Reusable pipeline

Write a `tenderly-verify.sh` that:

1. Sources `.env.local`.
2. Reads the deployment manifest JSON (chainId + per-contract addresses).
3. For each contract: `cast abi-encode` the constructor args → `forge verify-contract` → `curl POST .../rename` to set display name.

This idempotent script runs in ~30 seconds and converts a fresh deployment into a fully-named, source-decoded Tenderly project. Generic templates ship with this skill under `scripts/`.

## Step 10 — Simulate API for live-chain integration tests (h&sCCCm pattern)

Tenderly's `/simulate` endpoint runs a fresh fork of any indexed chain at the current head, applies `state_objects` (storage + balance + code overrides), and returns the full decoded trace. Pair with `/simulate-bundle` for stateful setup→assertion sequences.

### Personas (state_objects override pattern)

```ts
// FiatToken layout: _balances slot 9, _allowed slot 10
const balanceSlot = (holder, slot) => keccak256(abi.encode(holder, slot));
const allowanceSlot = (owner, spender, slot) =>
  keccak256(abi.encode(spender, keccak256(abi.encode(owner, slot))));

const state_objects = {
  [USDC]: {
    storage: {
      [balanceSlot(whale, 9)]: hex32(1_000_000_000_000n),
      [allowanceSlot(whale, Permit2, 10)]: hex32(MAX),
    },
  },
  [whale]: { balance: '0x8AC7230489E80000' },
};
```

### simulate-bundle for state propagation (ERC-4626 totalSupply, Morpho liquidity)

```
POST /simulate-bundle { "simulations": [setupTx, assertionTx] }
```

### Pyth-fresh bundle (fixes testnet OracleStale reverts)

```ts
const url = `https://hermes.pyth.network/api/latest_vaas?ids[]=${FEED_USDC}&ids[]=${FEED_EURC}`;
const vaas = await fetch(url).then(r => r.json());
const pythUpdate = vaas.map(b64 => `0x${Buffer.from(b64, 'base64').toString('hex')}`);
// Bundle `Pyth.updatePriceFeeds(pythUpdate)` before the assertion that reads the oracle.
```

## Step 11 — Storage layout debugging (forge inspect is law)

`state_objects.storage` overrides silently no-op when the mapping slot is wrong. **`forge inspect <Contract> storage-layout` is the only authoritative source.**

OZ v5's `ReentrancyGuard` uses **transient storage** (EIP-1153) → no permanent slot consumed → the child's first state variable lands at slot 0. The "slot 1 because ReentrancyGuard owns slot 0" assumption blew up h&sCCCm's sweep tests in Drop 5; only `forge inspect` caught it. Verify with `cast storage <addr> 0 --rpc-url <chain>`.

## Step 12 — Mock contracts via setCode (CCTP V2, Chainlink, etc.)

```solidity
contract MockMTStub {
    address public token;   // slot 0 low 20B
    uint96  public mintAmt; // slot 0 high 12B
    function receiveMessage(bytes calldata, bytes calldata) external returns (bool) {
        IERC20(token).transfer(msg.sender, uint256(mintAmt));
        return true;
    }
}
```

```ts
const runtime = JSON.parse(readFileSync('out/MockMTStub.sol/MockMTStub.json')).deployedBytecode
  .object;
const slot0 = pad(toHex((BigInt(mintAmt) << 160n) | BigInt(TOKEN)), { size: 32 });
state_objects[MESSAGE_TRANSMITTER_V2] = {
  code: runtime,
  storage: { ['0x' + '00'.repeat(32)]: slot0 },
};
// also override USDC._balances[MESSAGE_TRANSMITTER_V2] so the stub has funds to transfer
```

## Step 13 — Universal Router + Permit2 sim patterns

Permit2 storage: `allowance` is at slot 1 (slot 0 = `nonceBitmap` on SignatureTransfer parent). Triple-nested mapping. `PackedAllowance` packs `amount uint160 | expiration uint48 | nonce uint48` in one 32-byte slot.

```ts
function permit2AllowanceSlot(owner, token, spender) {
  const s1 = keccak256(abi.encode(owner, 1));
  const s2 = keccak256(abi.encode(token, s1));
  return keccak256(abi.encode(spender, s2));
}
function packAllowance(amount, exp, nonce) {
  return amount | (exp << 160n) | (nonce << 208n);
}
```

Combined with the standard `_balances` + ERC-20→Permit2 override, whale can call `UR.execute(V4_SWAP, ...)` end-to-end in one sim.

## Step 14 — Forks deprecated → primed vnet workflow

`POST /fork` returns `410 Gone: "Forks are deprecated. Please use Virtual Testnets"` (changed mid-2025). Migration: create a vnet, prime via admin RPC (`tenderly_setBalance`, `tenderly_setErc20Balance`), then route every sim through the vnet's Public RPC instead of `/simulate`. Pro plans lift the 2-vnet / 20-address quotas.

Companion script: `packages/sdk/scripts/tenderly-prime-vnet.sh` automates the delete-old-vnet + create-primed + admin-RPC-prime flow in one shot, persisting `TENDERLY_PRIMED_VNET_*` env vars.

## Step 15 — Tenderly MCP Server (the killer feature)

`claude mcp add tenderly --transport http https://mcp.tenderly.co/mcp` →
one command, OAuth login, Claude has direct access to **59 Tenderly tools**
across 7 areas. Skip the curl + skip the slash commands for everything
this server covers:

| Area                          | What Claude can do                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Virtual TestNets**          | create / fork / delete vnets, fund accounts, `tenderly_setBalance` / `setErc20Balance` / `setStorageAt`, impersonated transactions, time-travel, **save/restore snapshots for branching scenarios** (replaces the lost Fork API) |
| **Transaction Simulation**    | `/simulate` with decoded traces, events, state changes, asset transfers, balance diffs — no gas, any EVM network                                                                                                                 |
| **Transaction Tracing**       | on-chain + vnet traces with call trees, gas, state diffs, EIP-2930 access lists                                                                                                                                                  |
| **Advanced Trace Navigation** | 16 tools for huge traces — `get_trace_stats`, `get_trace_skeleton`, `find_failures`, `get_error_path`, fund-flow analysis                                                                                                        |
| **Contract Inspection**       | metadata + ABI + token-standard detection for any address                                                                                                                                                                        |
| **Network Discovery**         | list of 100+ supported EVM networks                                                                                                                                                                                              |
| **Project Management**        | `set_active_project` so every subsequent tool runs in that context                                                                                                                                                               |

### Quickstart

```bash
claude mcp add tenderly --transport http https://mcp.tenderly.co/mcp
claude mcp list                          # confirm "tenderly" appears
# Inside Claude Code: /mcp → select tenderly → browser OAuth
```

Then talk to Claude:

```
"set my active project to bufi under criptopoeta"
"fork base-sepolia at latest and set whale=0x1111… to have 1M USDC"
"simulate UR.execute V4_SWAP USDC→EURC on the active vnet, show the trace"
"find the failure in tx 0xabc… and trace the error path"
```

### MCP vs everything else

| Need              | Pre-MCP                                     | With MCP                                       |
| ----------------- | ------------------------------------------- | ---------------------------------------------- |
| Create vnet       | curl POST /vnets + parse RPC URLs           | "fork base-sepolia"                            |
| Fund whale        | scripts/tenderly-prime-vnet.sh + assertions | "give whale 1M USDC on the active vnet"        |
| Simulate tx       | hand-build state_objects + call /simulate   | "simulate UR.execute … in the active vnet"     |
| Read full trace   | 256-entry cap in the REST API               | trace-navigation tools fan out below the cap   |
| Snapshot + branch | Fork API deprecated → vnet-clone manually   | "snapshot active vnet" / "restore snapshot S1" |

The `tenderly-pro` skill recommends Pattern G (snapshot branching) —
MCP lets Claude do that natively with `save_snapshot` / `restore_snapshot`
without leaving the conversation.

### Auth + access scope

OAuth via WorkOS — Claude only performs actions within your Tenderly
permissions. Custom connectors on Claude.ai/Desktop require Pro+; on
Claude Code, free works. Disconnect any time via the connector list.

### When MCP doesn't fit

- **Bulk operations from a CI pipeline** — the REST endpoints + scripts
  in this skill are still the right tool (deterministic, scriptable,
  doesn't need an interactive session).
- **Source verification** — MCP doesn't ship `forge verify-contract`;
  use the etherscan-compat verifier URL pattern in Step 9.
- **Deployments via forge** — MCP doesn't ship `forge script`; do the
  deploy via Foundry then use MCP tools to inspect.

## Step 16 — Hardhat plugin path (alternative to Foundry verify)

When the project uses Hardhat instead of Foundry, the
`@tenderly/hardhat-tenderly` plugin automates verification end-to-end.

```bash
npm install --save-dev @tenderly/hardhat-tenderly
# Plugin versions >= 2.4.0 / >= 1.10.0 don't need tenderly.setup() —
# just import it and the plugin self-registers.
```

`hardhat.config.ts`:

```ts
import '@tenderly/hardhat-tenderly';

export default {
  tenderly: {
    username: 'criptopoeta',
    project: 'bufi',
    privateVerification: true, // false = publicly visible verified
  },
  networks: {
    virtual_base: {
      url: process.env.TENDERLY_VIRTUAL_TESTNET_RPC_URL,
    },
  },
};
```

Then deploy with auto-verification:

```bash
TENDERLY_AUTOMATIC_VERIFICATION=true \
npx hardhat ignition deploy ./ignition/modules/Mine.ts \
  --network virtual_base \
  --deployment-id deploy-to-virtual-base
```

### Proxy contracts (UUPS / Transparent / Beacon)

`@tenderly/hardhat-tenderly` ≥ 2.1.0 / 1.10.0 handles proxy verification
automatically when you use `@openzeppelin/hardhat-upgrades`. Set
`TENDERLY_AUTOMATIC_POPULATE_HARDHAT_VERIFY_CONFIG=true` in `.env` so the
plugin auto-populates `@nomicfoundation/hardhat-verify` config.

```ts
import { ethers, upgrades } from 'hardhat';

const VotingLogic = await ethers.getContractFactory('VotingLogic');
const proxy = await upgrades.deployProxy(VotingLogic);
await proxy.waitForDeployment();
// Tenderly verifies both the proxy AND the implementation automatically.
```

For older plugin versions you need the manual workaround:

- Create `contracts/DummyProxy.sol` that imports the OZ proxy contracts
  you use (so they compile)
- Add solidity compiler overrides for `@openzeppelin/contracts/proxy/**`
  to match the version OZ used when building those contracts (typically
  0.8.9 with 200 optimizer runs)
- Call `tenderly.verify({ name: 'Vault', address: implAddr }, { name: 'ERC1967Proxy', address: proxyAddr })`

### Private vs public verification (both Foundry + Hardhat)

Default is **private** (visible only inside your Tenderly project).
Append `/public` to the verifier URL to publish:

| Mode    | Forge URL suffix                              | Hardhat config                        |
| ------- | --------------------------------------------- | ------------------------------------- |
| Private | `…/etherscan/verify/network/{chainId}`        | `tenderly.privateVerification: true`  |
| Public  | `…/etherscan/verify/network/{chainId}/public` | `tenderly.privateVerification: false` |

**Once public, can't revert without contacting support@tenderly.co.**
Deleting the contract from your project does NOT remove the public
verification — the source stays visible.

## Step 17 — Cleanup + token rotation

Tell the user explicitly:

> Your Tenderly access token is now in this session's transcript. Rotate it after the session at https://dashboard.tenderly.co/account/authorization. Tenderly tokens are bearer tokens — anyone with the string has full project access.

To delete the vnet when done:

```bash
curl -s -X DELETE \
  -H "X-Access-Key: $TENDERLY_ACCESS_KEY" \
  "https://api.tenderly.co/api/v1/account/$TENDERLY_ACCOUNT/project/$TENDERLY_PROJECT/vnets/$TENDERLY_VNET_ID"
```

## Rules

> **Security Rules** are non-negotiable. **Best Practices** are strongly recommended.

### Security Rules

- **NEVER** target mainnet network IDs. Skill refuses to fork chainId 1, 10, 137, 8453, 42161, 43114, 130.
- **NEVER** echo the Tenderly access token back to the user, write it to git-tracked files, or log it.
- **NEVER** commit `.env.local` — verify `git check-ignore .env.local` succeeds before any commit.
- **ALWAYS** warn at session end that the token is in the transcript and must be rotated.
- **NEVER** use real-user private keys as `DEPLOYER_PRIVATE_KEY` in a Tenderly vnet — use Anvil's well-known test key or a throwaway.

### Best Practices

- **ALWAYS** use `network_id` and `chain_id` as JSON numbers, not strings (Tenderly's API rejects strings).
- **ALWAYS** keep the source chainId === the vnet chainId — forking Base Sepolia (84532) means your vnet should also be chainId 84532, so cross-chain primitives (CCTP domain mappings) still resolve correctly.
- **ALWAYS** pass `--skip-simulation --slow` to `forge script` against a Tenderly vnet — admin-mutated state doesn't replay cleanly otherwise.
- **ALWAYS** persist deployments under `deployments/tenderly-*.json` (NOT gitignored). Treat the file as the canonical address manifest for the SDK.
- **ALWAYS** run `forge verify-contract` against the Tenderly verifier URL after every deploy — without it, the Contracts tab stays empty and traces are unreadable. Use **explicit** `--constructor-args` (`cast abi-encode`); Tenderly's verifier rejects `--guess-constructor-args` ("Action not supported").
- **NEVER** use `POST /wallet` to register a contract. It lands in the Wallets tab with `account_type=wallet`. The endpoint accepts contract addresses but mis-classifies them. Use the verify path instead.
- **PREFER** deploying to real public testnets (not vnets) when the chain has a public testnet — Tenderly indexes both, and free-plan vnets hit max-block-height quickly. Vnets are best for state-manipulation tests (forced balances, time travel), not long-lived deployment hosting.
- **PREFER** the Public RPC URL for read-heavy frontend code, the Admin RPC URL for deploy scripts and admin manipulations.
- **NEVER** rely on the vnet for long-term state persistence — Tenderly may garbage-collect inactive vnets or reset state. Re-broadcast deploy script is the source of truth.
- **SKIP** external dependencies (Morpho, Pyth, USDC, Permit2, etc.) when labeling — they burn through the 20-address project cap and you already know they're working contracts.

## Reference

- Tenderly Virtual TestNets REST API: https://docs.tenderly.co/virtual-testnets/develop/rest-api
- Admin RPC method reference: https://docs.tenderly.co/virtual-testnets/admin-rpc
- Contract verification via Foundry: https://docs.tenderly.co/contract-verification/foundry
- Dashboard: https://dashboard.tenderly.co

## Undocumented endpoints (validated by trial)

| Endpoint                                                             | Method                                            | Purpose                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/api/v1/account/{a}/project/{p}/wallet`                             | POST `{address, network_ids:[...], display_name}` | Add an EOA. **Don't use for contracts.**                                                                        |
| `/api/v1/account/{a}/project/{p}/contract/{chainId}/{addr}/rename`   | POST `{display_name}`                             | Override Solidity contract name with custom display name (needed when same source produces multiple instances). |
| `/api/v1/account/{a}/project/{p}/tag`                                | POST `{contract_ids:["eth:CHAIN:0x..."], tag}`    | Attach a free-form tag (orthogonal to display name; appears in Tags column).                                    |
| `/api/v1/account/{a}/project/{p}/contracts`                          | DELETE `{account_ids:["eth:CHAIN:0x..."]}`        | Bulk remove entries (frees slots toward the 20-cap).                                                            |
| `/api/v1/account/{a}/project/{p}/contracts?accountType=contract`     | GET                                               | Filtered list (just Contracts, not Wallets).                                                                    |
| `{TENDERLY_PUBLIC_RPC}/verify/etherscan`                             | etherscan-compat                                  | Vnet contract verification target for `forge verify-contract --verifier custom --verifier-url`.                 |
| `/api/v1/account/{a}/project/{p}/etherscan/verify/network/{chainId}` | etherscan-compat                                  | Public-network contract verification target (Base Sepolia, Unichain Sepolia, Fuji, etc.).                       |

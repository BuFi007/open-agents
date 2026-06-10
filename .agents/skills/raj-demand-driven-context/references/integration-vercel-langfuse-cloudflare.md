# End-to-end debugging: gap board → trace → server log → edge log

When a row appears on `docs/agent-gaps/board.md`, you have four sources of truth to walk in order. Each one narrows the failure mode further. Total time from "gap surfaces" to "I know what to fix": ~5 minutes.

This playbook chains existing dev-environment skills you already have:

- **Sendero gap board** (this skill) — what the agent thinks went wrong.
- **`langfuse` skill / MCP** (`/mcp`) — the full trace tree of the failing turn.
- **`vercel:vercel-cli` skill** — the server-side stack trace for the failing tool call.
- **`mcp__cloudflare-workers__*` tools** — edge-side logs when the request crossed the worker.

## The chain

### Step 1 — Read the gap

```bash
bun gaps:scan --resolve-stale-days 14
open docs/agent-gaps/board.md
```

Pick a Critical or High row. Read:

- `hypothesis` — the agent's diagnosis.
- `suggestedFix` — when present, often shipping-quality.
- `traceId` — the bridge to Langfuse.
- `toolName`, `errorMessage`, `surface` (e.g. `agent.kapso`, `agent.dispatch`).
- `occurrenceCount` — gauges urgency. ×50 with the same hypothesis = real customer pain.

### Step 2 — Pull the full trace

Two paths, depending on what you have wired up:

**Langfuse MCP (preferred — interactive in Claude)**:

```
/mcp
# Confirm langfuse server is connected. If not, see CLAUDE.md
# "Observability + prompt management — Langfuse" section.
```

Then ask Claude to fetch the trace:

> "Pull Langfuse trace `<traceId>` and summarize the tool-call sequence."

The MCP returns the full agent turn: input, system prompt, tool calls in order with arguments + responses, the final reply, and any scores attached. Critically: **the model's reasoning between tool calls** — Langfuse captures this when `aiTelemetryConfig` is wired (it is, on every Sendero agent surface).

**Langfuse CLI / dashboard (fallback)**:

```bash
# CLI version of the same thing
bun run langfuse trace get <traceId>
```

Or open in browser: `https://us.cloud.langfuse.com/project/<id>/traces/<traceId>`.

What you're looking for:

- Did the agent retry the failing tool? How many times?
- What input did it actually pass on the retry?
- Did the model's reasoning blame something different than the gap's hypothesis? (If yes, the gap-tool was called too late and you need a slab fix to call it earlier.)

### Step 3 — Read the server-side stack trace

The agent saw an HTTP response code + body. You see the throw site. Use the `vercel:vercel-cli` skill:

```bash
# Find the deployment that handled the failing request
vercel ls --prod | head -10                       # most recent prod deploys
# OR for preview:
vercel ls | grep <branch-name> | head -3

# Stream logs for a specific deployment
vercel logs <deployment-url-or-id>

# OR filter to a function path
vercel logs <deployment> --output api/tools/<tool_name>
```

What you're looking for:

- The actual error class + line number.
- The Prisma query (when the error is data-shape).
- The Duffel/Circle/Kapso/Stripe upstream response that triggered it.
- Any `[wa/webhook]` or `[slack/interactions]` log warnings around the same timestamp.

If the gap's `surface` is `agent.kapso`, also check:

```bash
# Kapso execution events (via the automate-whatsapp skill scripts)
node ~/.claude/skills/automate-whatsapp/scripts/get-execution.js <executionId>
node ~/.claude/skills/automate-whatsapp/scripts/list-execution-events.js <executionId>
```

### Step 4 — Edge worker logs (if applicable)

When the gap's `kind` is `runtime_constraint` OR the `traceId` shows the request hit `sendero-arc-edge.tomas-cordero-esp.workers.dev`, pull Cloudflare worker logs:

```
# Via Cloudflare MCP
/mcp
# Then ask Claude:
> "Pull recent error logs from the sendero-arc-edge worker."
```

The MCP exposes `mcp__cloudflare-workers__*` tools — common ones:

- Recent invocations + error rates
- Tail of stderr for a specific deployment
- Request analytics (geo, status codes, timing)

What you're looking for:

- Edge cache hits/misses (a gap in `runtime_constraint` for stale data is often a cache-pin issue).
- Geo-specific failures (the EZE inbound user hitting an edge in São Paulo, but the function in Iad).
- 5xx burst pattern (rare; usually indicates upstream Vercel function down).

## Putting it together — Sendero example

Tonight's `documentImageUrl` vs `documentUrl` bug, walked end-to-end:

1. **Gap board** showed:

   ```
   ### scan_passport_inline — tool input ≠ schema · ×3 · 🚧 blocking

   > I think the prompt told me to send documentImageUrl but the tool wants
   > documentUrl. Field name typo in Story 4.2.

   Suggested fix: rename in agent-persona.ts Story 4.2.

   id: gap_xxx · severity: critical · last seen: 2h ago
   ```

2. **Langfuse trace** confirmed: agent called `scan_passport_inline({ documentImageUrl: "..." })`, got a 200 with `{ status: 'unsupported', message: "needs documentUrl" }`. Model's reasoning: "the user expects vault to save it; let me try a different field name." Retried with `documentUrl` — got 500 (KEK missing). Model gave up, called `request_human_handoff`.

3. **Vercel logs** for the deployment at the timestamp showed the 500 stack: `Error: PASSPORT_VAULT_KEK is not set` from `packages/vault/src/envelope.ts:67`. Confirms env var snapshot predates the env-add.

4. **Edge logs** (skipped — not edge-routed).

**Fix queue:**

- Prompt: rename `documentImageUrl → documentUrl` (Kapso prompt push, lock 119 → 120). ✓
- Infra: trigger redeploy so KEK env loads. ✓
- Persona: add Story 4.2 with explicit `documentUrl` and the correct retry rules. ✓

Total elapsed time from gap surfacing to root-cause + fix: ~12 minutes. Without the gap board, the same investigation took an hour the first time around — most of it spent re-reading the WhatsApp transcript trying to figure out what the agent had even tried.

## Combining commands inside Claude

The fastest way to walk the chain is to ask Claude one question that triggers all four sources:

> "Pull gap `gap_xxx` from `docs/agent-gaps/board.md`, fetch the Langfuse trace it references, pull the matching Vercel deployment logs for the failing tool path, and tell me the root cause."

Claude routes:

- Read tool → markdown
- `mcp__langfuse-docs__searchLangfuseDocs` or the langfuse MCP → trace
- Bash → `vercel logs <deployment>`
- (Optional) `mcp__cloudflare-workers__*` → edge logs

…and synthesizes the four signals into a single fix proposal.

## Setup — what should be wired before you reach for this

Run `/mcp` in Claude Code and confirm these are connected:

- `langfuse-docs` (or local langfuse MCP) — for trace pulls
- `cloudflare-workers` — for edge logs
- `automate-whatsapp` skill (per Sendero CLAUDE.md) — for Kapso execution introspection
- `observe-whatsapp` skill — for WhatsApp delivery debugging

Run `/skills` and confirm these are installed:

- `vercel:vercel-cli` — for `vercel logs`
- `langfuse` — for prompt management + dataset/regression interaction
- `automate-whatsapp` — for Kapso function/workflow CRUD
- `observe-whatsapp` — for delivery + webhook triage
- `raj-demand-driven-context` — this skill (the entry point)

If any are missing, the chain still works — just with more manual steps. The sweet spot is all five wired so a single Claude prompt walks the entire investigation.

## When to skip the chain

The chain is overkill for:

- Single-occurrence gaps that auto-resolve in 14 days (let `--resolve-stale-days` do its job)
- Gaps where `suggestedFix` is already correct + obvious (just ship the fix; the trace won't add information)
- Gaps where `kind: 'env_missing'` with a known fix (just redeploy)

It's worth the full walk for:

- Critical-severity gaps with `occurrenceCount ≥ 5`
- Anything in `kind: 'runtime_constraint'` (platform foot-guns; the trace will show the workaround attempt)
- Gaps that surfaced AND a customer escalation came in around the same time (cross-reference the `traceId` with the `ChannelHandoff.metadata.traceId`)
- Pre-incident reviews — the board is a leading indicator; reading it Tuesday morning often catches Friday's incident on Monday afternoon

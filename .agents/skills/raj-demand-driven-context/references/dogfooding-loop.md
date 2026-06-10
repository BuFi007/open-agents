# Dogfooding loop — three tools, one motion

The skill's three tools (`report_knowledge_gap`, `list_available_tools`, `bun gaps:scan`) are designed to compose into a tight live-testing loop. This file is the concrete recipe.

**Iron rule: never run a dogfooding session without all three tools wired AND a Monitor running.** Skipping any one breaks the loop and you're back to manual whack-a-mole.

## The loop, visualized

```
                ┌─────────────────────────────────────────┐
                │  YOU send a real test request           │
                │  (WhatsApp message, Slack cmd, etc.)    │
                └──────────────┬──────────────────────────┘
                               │
                               ▼
        ┌───────────────────────────────────────┐
        │  Monitor surfaces inbound + outbound  │
        │  events to Claude (Shell A)           │
        └──────────────┬────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────────┐
        │  Agent attempts the action           │
        └──────────────┬───────────────────────┘
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
         works    recoverable    unrecoverable
            │     fail            fail
            │      │               │
            │      ▼               ▼
            │   list_available  report_knowledge
            │   _tools          _gap → escalate
            │      │             via request_human
            │      ▼             _handoff
            │   retry with        │
            │   correct tool      ▼
            │      │           Gap row persisted
            │      ▼           (deduped)
            │   works ──┐         │
            │           │         ▼
            ▼           ▼     YOU walk the
        next test    next      debugging chain
        case         test     (gap → trace →
                     case      vercel → cf logs)
                                  │
                                  ▼
                              YOU fix root cause,
                              re-test SAME scenario,
                              gap closes (or new
                              gap surfaces — repeat)
```

## Setup — 5 minutes

### 1. Gap-board snapshot

```bash
# Capture the state of the gap board BEFORE the session.
# This is what you'll diff against after to see what surfaced.
cp docs/agent-gaps/board.md /tmp/gaps-before.md 2>/dev/null || \
  bun gaps:scan --output /tmp/gaps-before.md --dry-run
```

### 2. Env parity

```bash
# Pull the live Vercel env so localhost matches preview/prod shape.
# Without this, you'll false-positive "env_missing" gaps that don't
# repro in production.
vercel env pull .env.local
```

### 3. Three Claude shells

| Shell | Purpose         | What's running                                                                                                                                                                          |
| ----- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Editor + driver | Claude Code with this skill loaded. You give the high-level instructions.                                                                                                               |
| **B** | Inbound monitor | `Monitor` watching the channel under test. WhatsApp = Kapso event stream. Slack = `apps/app/.next/dev/...` server log filtered to `/api/webhooks/slack/*`. Web = dev server access log. |
| **C** | Backend monitor | `Monitor` on `vercel logs --follow <preview-url>` for the deployed surface, OR `bun dev` console for local.                                                                             |

The Monitor in Shell B is what makes the loop work autonomously. Without it, you're typing "what just happened with the WhatsApp message I sent?" every turn. With it, Claude in Shell A sees inbound + outbound events as they fire and reacts in the same flow.

### 4. Pre-flight gap board read

In Shell A, ask Claude:

> "Read `docs/agent-gaps/board.md` and tell me which open gaps are most likely to fire during a `<feature being tested>` session."

This primes Claude on known foot-guns so it can preempt them when the relevant inbound traffic arrives. If a gap is listed `severity: critical` and matches your test surface, fix it BEFORE you start dogfooding — don't burn live customer turns proving a known gap is still broken.

## Live — turn-by-turn motion

### When the agent succeeds

Move on. Don't celebrate. The loop only adds value on failures.

### When the agent fails recoverably

Recoverable failure shapes:

- Tool returns 4xx with a clear shape error ("expected `documentUrl`, got `documentImageUrl`")
- Tool returns a status code the agent has slab guidance for (`traveler_data_required: passport`, `insufficient_funds`)
- Agent retries with adjusted input and succeeds

The persona slab tells the agent: "after 2 consecutive 4xx/5xx OR a runtime 'Tool X not available', call `list_available_tools({ keyword })` to discover what's registered." Watch for this pattern in the trace. If the agent doesn't introspect when it should, that's itself a gap — the slab needs to teach this behavior more emphatically.

### When the agent fails unrecoverably

Unrecoverable failure shapes:

- Tool returns 500 with an opaque error
- Runtime says "Tool not available" for a tool the agent thought existed
- Tool returns success but the side effect didn't happen (data not persisted, message not sent)
- Agent doesn't know what to do with the response

The persona slab tells the agent to call:

```ts
report_knowledge_gap({
  kind:
    'tool_input_mismatch' |
    'tool_not_found' |
    'tool_error_unrecoverable' |
    'instruction_missing' |
    'env_missing' |
    'schema_drift' |
    'runtime_constraint' |
    'other',
  toolName: '<the tool that failed>',
  errorMessage: '<verbatim from the failed call>',
  hypothesis: '<SPECIFIC diagnosis — "I think field is X, not Y" beats "tool failed">',
  suggestedFix: '<optional, but useful>',
  blockingTraveler: true, // it just blocked the session
  channelKind: 'whatsapp' | 'slack' | 'web' | 'mcp',
});
```

Then escalate via `request_human_handoff` so the test traveler (you) gets a real handoff record + Liveblocks notification. **You** are the handoff target during dogfood — receiving your own escalation closes the operator-side loop too.

### When the gap row persists

In Shell A, immediately walk the chain:

```
> "Pull the gap that just landed. Use the traceId to fetch the full
> Langfuse trace, then pull Vercel logs for the failing tool path."
```

Claude routes:

1. `Read` → `docs/agent-gaps/board.md` (or query Postgres directly via Prisma)
2. `mcp__langfuse-docs__searchLangfuseDocs` (or local langfuse MCP) → trace tree
3. `Bash` → `vercel logs <deployment>` filtered to the tool path
4. (Optional) `mcp__cloudflare-workers__*` → edge logs when relevant

Synthesize: what's the root cause? Common shapes:

- Prompt slab named a field wrong → edit slab, push to Kapso (`bun langfuse:prompts:seed` or workflow update)
- Env var missing → `vercel env add NAME production` + redeploy
- Tool's Zod schema is stricter than the description → either loosen schema or tighten description
- Tool exists but isn't in Kapso's `flow_agent_function_tools` enum → Kapso graph update

### Re-test the same scenario

This is the load-bearing step. Without re-test, you don't know if the fix held. Send the same WhatsApp message / Slack command / web click. Three outcomes:

1. **Same gap re-fires** → fix didn't apply (deploy didn't pick up, persona didn't ship, etc.). Don't iterate on a different gap until this one closes.
2. **Different gap fires** → first fix held; you've surfaced the next layer. Loop again.
3. **Success** → the gap is implicitly resolved. The scanner will mark it resolved on the next `--resolve-stale-days N` run.

## Post-session — 5 minutes

### 1. Diff the board

```bash
bun gaps:scan
git diff docs/agent-gaps/board.md
```

The diff IS your session retro. Don't write a separate one. Three things to look at:

- **NEW open rows** → gaps you found but didn't close. File issues for these or fix tomorrow.
- **CLOSED rows** (moved to "Recently resolved") → gaps you closed during the session. Each one deserves a regression test (next step).
- **Severity escalations** → rows that bumped from medium → high because they fired 3+ times during the session. These are systemic, not one-offs.

### 2. Auto-resolve stale rows

```bash
bun gaps:scan --resolve-stale-days 1
```

After a productive session, anything not-blocking that didn't recur in the last 24h gets auto-resolved. Conservative because:

- Blocking rows are NEVER auto-resolved (a human must confirm the fix shipped)
- 1-day window means a gap from yesterday that the fix actually closed gets archived; one that's flaky stays open

### 3. Promote closed gaps to regression

For each gap you closed during the session, add the triggering input to the Langfuse golden-turns dataset:

```bash
# Edit scripts/seed-langfuse-dataset.ts to add a new dataset item
# matching the input that triggered the gap. Set mustMention to the
# correct outcome the fix produces.
bun langfuse:dataset:seed

# Run the regression to confirm the suite still passes.
bun langfuse:regression
```

This closes Raj's "TDD with failed tests" loop. A future prompt edit that re-introduces the same field-name typo will fail the regression suite before merging.

### 4. Decide on remaining open rows

For each NEW open row that survived `--resolve-stale-days`:

- **Critical or blocking** → ship the fix today. These re-fire on the next live customer.
- **High** → file a real GitHub issue with the gap id in the title; fix this week.
- **Medium** → comment on the row with status; fix when the related area gets touched.
- **Low** → leave it. The 14-day auto-resolver will archive it if it doesn't recur. If it does recur, the repeat-offender promotion (`occurrenceCount >= 3 && blockingTraveler`) will bump it.

Never leave critical/high open rows in unknown state across days. The board is most valuable when the open count tracks reality — drift kills trust.

## Common dogfood pitfalls

### Skipping the Monitor

Without the inbound Monitor, you're context-switching between Claude, your WhatsApp app, the Slack panel, and Vercel logs. By the time you've copy-pasted what happened into Claude, you've lost the rhythm. Always start the Monitor first. If you're not sure how to set it up for your channel, ask Claude:

> "Set up a Monitor watching for inbound + outbound on the WhatsApp dogfood channel for tenant `<id>`. I want to see Kapso events in real-time."

### Fixing without re-testing

Tempting because the fix "looks right." Don't. The agent might pick up a stale env, a cached prompt slab, or a Vercel deployment that hasn't propagated. Re-test the SAME scenario every time, even when you're sure.

### Letting the agent escape into `handoff_to_human` (Kapso built-in)

If the agent calls `handoff_to_human` instead of `request_human_handoff`, the conversation goes dark at the Kapso platform layer. No Liveblocks notification, no Slack post, no operator dashboard surface. Treat any `handoff_to_human` call as a high-severity prompt-slab gap — file it, fix it, never let the agent think this is OK. (Sendero CLAUDE.md has the full ban as of lock 116.)

### Running gap-scan without --dry-run during a session

If the scanner runs mid-session and writes the board, you can't `git diff` against the pre-snapshot. Either always use `--dry-run` mid-session, or move the pre-snapshot somewhere outside the repo (e.g. `/tmp/gaps-before.md`) so the diff still works.

### Not pulling Vercel env

`vercel env pull .env.local` is non-negotiable before a session. Local dev with stale env reproduces "env_missing" gaps that don't actually exist in production — wastes 10 minutes per false-positive.

### Treating the scanner as a dashboard

It's not. The scanner is a _state-snapshot of what just surfaced_. The dashboard for live operators is `/dashboard/agent-gaps` (when you build it — see `wiring-new-vertical.md` Phase 2 ops surfaces). The scanner is for the dev's loop, not the operator's.

## Cadence — when to dogfood

- **Before every Kapso prompt-slab push.** Smoke-test the change against the scenarios it claims to fix. Lock change shouldn't bump unless re-test passes.
- **After every new tool registration.** New tool surface = new gap surface. Run the loop on the happy path + the two adjacent corridors.
- **Weekly, full sweep.** Every Friday, run a 60-min session walking the top 5 user journeys from the analytics. The gap board becomes the next week's TODO.
- **Pre-incident review.** When a customer reports something off, FIRST check the gap board for matching rows — they're a leading indicator and often already have suggestedFix populated.
- **NEVER as part of CI.** This loop is human-driven. Automating it produces gap-board noise from synthetic traffic. The CI equivalent is `bun langfuse:regression`.

## Reference

- Skill: `~/.claude/skills/raj-demand-driven-context/SKILL.md`
- Tools: `packages/tools/src/report-knowledge-gap.ts`, `packages/tools/src/list-available-tools.ts`
- Scanner: `scripts/scan-knowledge-gaps.ts`
- Schema: `packages/database/prisma/schema.prisma` → `model KnowledgeGap`
- Persona slab: `apps/app/lib/agent-persona.ts` → "Self-diagnostic tools" section
- Debugging chain: `references/integration-vercel-langfuse-cloudflare.md`
- New-vertical playbook: `references/wiring-new-vertical.md`
- Source: Raj Kapadia, "Demand-Driven Context for AI Agents", 2026 — https://www.youtube.com/watch?v=_QAVExf_1uw

# Horizontal AI ERP operating packs — implementation and migration

## Implemented contract spine

- `BusinessArchitectureGraph` v1 reserves the shared entity and relation families used by every pack. Pack-specific fields are namespaced and cannot redefine identity, workspace, kind, version, name, or evidence primitives.
- `OperatingPackManifest` is strict and runtime-validated. It declares ontology extensions, roster agents, workflows, connectors, Harness tool grants, approval boundaries, KPIs, Desk widgets, Expo cards, trace views, permissions, and setup checks.
- The compiler fails closed on missing pack dependencies, missing Harness capabilities, duplicate packs, and reserved-field redefinition. Multiple packs compile onto one graph.
- The policy plane computes deny-first effective policy across workspace/team/pack/agent/workflow/tool scopes, minimum budgets, approval escalation, and write-only kill switches while preserving authorized read-only inspection.
- Governance reviews installs/upgrades for permission escalation, emits sanitized Eve traces, supports rollback, and removes pack execution without deleting graph evidence.
- Semantic KPI definitions and metric runs retain formula, version, owner, dimensions, evidence hashes, trace, freshness, confidence, and calculation hash.
- Simulation uses immutable graph and ContextPacket watermarks, performs zero external effects, blocks stale-source simulation, exposes proposed changes/approvals/evidence gaps/budget, and gates high-risk execution on a matching dry run.
- Finance Ops, Grant Ops, Product Ops, Sales Ops, and BUFI Internal Ops manifests compile together. Tax is represented only by a deferred cross-project reference.
- Desk/Expo consume shared composer and team-cockpit projections; no client policy or orchestration is duplicated.

## Existing KG migration

1. Snapshot each workspace's current canonical entities, relationships, evidence, activities, aliases, and projection watermarks.
2. Map known current kinds onto reserved graph families without rewriting source IDs. Unknown/domain kinds become namespaced ontology extensions.
3. Create graph relations from existing ownership, canonical identity, evidence, workflow, approval, and account links. Preserve every original evidence reference.
4. Build the v1 graph beside current projections and compare counts, source hashes, unresolved kinds, and tenant ownership.
5. Emit a versioned `ContextPacket` from both paths for golden queries. Cut reads only after citation/evidence parity and tenant-isolation checks pass.
6. Keep the legacy projection replayable until outbox replay, rollback, and zero-loss gates are green.

## Current Gateman result

Decision: **YES_WITH_FOLLOWUPS**. Contract risk is low: 18 focused tests pass, package-wide typecheck and migration drift checks pass, all manifests are strict, and the certification E2E exercises five packs, three workflows, five KPIs, policy, simulation, composer, and cockpit projections.

The remaining production gate is intentionally external to these contracts: live Harness certification (Hermes/Codex/Claude Code/Computer Use), real connector/KG/BullMQ soak and chaos, and visual Desk/Expo composition. No Tax Automation Engine work is included.

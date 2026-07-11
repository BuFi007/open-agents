import type { WorkspaceHarness } from "@open-agents/harness-runner";
import {
  createBusinessArchitectureGraph,
  isReservedBusinessField,
  type BusinessArchitectureGraph,
} from "./business-graph";
import {
  parseOperatingPackManifest,
  type OperatingPackManifest,
} from "./manifest";

export type CompiledOperatingPacks = {
  workspaceId: string;
  manifests: readonly OperatingPackManifest[];
  graph: BusinessArchitectureGraph;
  workflows: readonly (OperatingPackManifest["workflows"][number] & {
    packId: string;
  })[];
  agents: readonly (OperatingPackManifest["agents"][number] & {
    packId: string;
    agentId: string;
  })[];
  toolGrants: readonly (OperatingPackManifest["toolGrants"][number] & {
    packIds: readonly string[];
  })[];
  deskWidgets: readonly (OperatingPackManifest["deskWidgets"][number] & {
    packId: string;
  })[];
  expoCards: readonly (OperatingPackManifest["expoCards"][number] & {
    packId: string;
  })[];
};

function orderManifests(
  manifests: readonly OperatingPackManifest[],
): readonly OperatingPackManifest[] {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: OperatingPackManifest[] = [];
  const visit = (manifest: OperatingPackManifest) => {
    if (visiting.has(manifest.id))
      throw new Error(`operating pack dependency cycle: ${manifest.id}`);
    if (visited.has(manifest.id)) return;
    visiting.add(manifest.id);
    for (const dependency of manifest.dependencies) {
      const target = byId.get(dependency);
      if (!target) throw new Error(`missing pack dependency: ${dependency}`);
      visit(target);
    }
    visiting.delete(manifest.id);
    visited.add(manifest.id);
    ordered.push(manifest);
  };
  for (const manifest of manifests) visit(manifest);
  return ordered;
}

export function compileOperatingPacks(input: {
  graph: BusinessArchitectureGraph;
  harness: WorkspaceHarness;
  manifests: readonly unknown[];
}): CompiledOperatingPacks {
  if (input.graph.workspaceId !== input.harness.workspaceId)
    throw new Error("pack compiler workspace mismatch");
  const parsedManifests = input.manifests.map(parseOperatingPackManifest);
  const packIds = new Set(parsedManifests.map((manifest) => manifest.id));
  if (packIds.size !== parsedManifests.length)
    throw new Error("duplicate operating pack");
  const manifests = orderManifests(parsedManifests);
  const capabilities = new Map(
    input.harness.capabilities.map((capability) => [
      capability.name,
      capability,
    ]),
  );
  const extensions: Record<string, readonly string[]> = {
    ...input.graph.extensions,
  };
  const seenAgents = new Set<string>();
  const agentsById = new Map<
    string,
    Array<{ packId: string; agent: OperatingPackManifest["agents"][number] }>
  >();

  for (const manifest of manifests) {
    for (const agent of manifest.agents) {
      const candidates = agentsById.get(agent.id) ?? [];
      candidates.push({ packId: manifest.id, agent });
      agentsById.set(agent.id, candidates);
    }
  }

  for (const manifest of manifests) {
    const grants = new Map(
      manifest.toolGrants.map((grant) => [grant.tool, grant]),
    );
    for (const grant of manifest.toolGrants) {
      const capability = capabilities.get(grant.tool);
      if (!capability)
        throw new Error(`undeclared harness capability: ${grant.tool}`);
      if (
        grant.operations.some(
          (operation) => !capability.allowedOperations.includes(operation),
        )
      )
        throw new Error(`undeclared harness operation: ${grant.tool}`);
      if (capability.requiresApproval && !grant.approvalRequired)
        throw new Error(`pack weakens harness approval: ${grant.tool}`);
    }
    for (const [namespace, fields] of Object.entries(
      manifest.ontology.extensions,
    )) {
      if (fields.some(isReservedBusinessField))
        throw new Error(`pack redefines reserved primitive: ${namespace}`);
      const key = `${manifest.id}.${namespace}`;
      if (extensions[key])
        throw new Error(`duplicate ontology extension: ${key}`);
      extensions[key] = fields;
    }
    for (const agent of manifest.agents) {
      const qualified = `${manifest.id}:${agent.id}`;
      if (seenAgents.has(qualified))
        throw new Error(`duplicate pack agent: ${qualified}`);
      seenAgents.add(qualified);
      for (const tool of agent.tools) {
        if (!grants.has(tool))
          throw new Error(`agent tool is not granted: ${qualified}:${tool}`);
      }
    }
    const localAgentIds = new Set(manifest.agents.map((agent) => agent.id));
    for (const workflow of manifest.workflows) {
      for (const agentId of workflow.agentIds) {
        if (localAgentIds.has(agentId)) continue;
        if (!workflow.crossPack)
          throw new Error(
            `non-cross-pack workflow references external agent: ${manifest.id}.${workflow.id}:${agentId}`,
          );
        const candidates = agentsById.get(agentId) ?? [];
        if (candidates.length === 0)
          throw new Error(
            `workflow references unknown agent: ${manifest.id}.${workflow.id}:${agentId}`,
          );
        if (candidates.length > 1)
          throw new Error(
            `workflow references ambiguous agent: ${manifest.id}.${workflow.id}:${agentId}`,
          );
      }
    }
  }

  const mergedToolGrants = new Map<
    string,
    CompiledOperatingPacks["toolGrants"][number]
  >();
  for (const manifest of manifests) {
    for (const grant of manifest.toolGrants) {
      const existing = mergedToolGrants.get(grant.tool);
      mergedToolGrants.set(grant.tool, {
        tool: grant.tool,
        operations: [
          ...new Set([...(existing?.operations ?? []), ...grant.operations]),
        ],
        approvalRequired:
          (existing?.approvalRequired ?? false) || grant.approvalRequired,
        packIds: [...new Set([...(existing?.packIds ?? []), manifest.id])],
      });
    }
  }

  const graph = createBusinessArchitectureGraph({
    workspaceId: input.graph.workspaceId,
    entities: input.graph.entities,
    relations: input.graph.relations,
    extensions,
  });
  return {
    workspaceId: graph.workspaceId,
    manifests,
    graph,
    workflows: manifests.flatMap((manifest) =>
      manifest.workflows.map((workflow) => ({
        ...workflow,
        packId: manifest.id,
      })),
    ),
    agents: manifests.flatMap((manifest) =>
      manifest.agents.map((agent) => ({
        ...agent,
        agentId: agent.id,
        packId: manifest.id,
      })),
    ),
    toolGrants: [...mergedToolGrants.values()],
    deskWidgets: manifests.flatMap((manifest) =>
      manifest.deskWidgets.map((widget) => ({
        ...widget,
        packId: manifest.id,
      })),
    ),
    expoCards: manifests.flatMap((manifest) =>
      manifest.expoCards.map((card) => ({ ...card, packId: manifest.id })),
    ),
  };
}

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
  workflows: readonly OperatingPackManifest["workflows"][number][];
  agents: readonly OperatingPackManifest["agents"][number][];
  toolGrants: readonly OperatingPackManifest["toolGrants"][number][];
  deskWidgets: readonly (OperatingPackManifest["deskWidgets"][number] & {
    packId: string;
  })[];
  expoCards: readonly (OperatingPackManifest["expoCards"][number] & {
    packId: string;
  })[];
};

export function compileOperatingPacks(input: {
  graph: BusinessArchitectureGraph;
  harness: WorkspaceHarness;
  manifests: readonly unknown[];
}): CompiledOperatingPacks {
  if (input.graph.workspaceId !== input.harness.workspaceId)
    throw new Error("pack compiler workspace mismatch");
  const manifests = input.manifests.map(parseOperatingPackManifest);
  const packIds = new Set(manifests.map((manifest) => manifest.id));
  if (packIds.size !== manifests.length)
    throw new Error("duplicate operating pack");
  const installed = new Set<string>();
  const capabilities = new Set(
    input.harness.capabilities.map((capability) => capability.name),
  );
  const extensions: Record<string, readonly string[]> = {
    ...input.graph.extensions,
  };
  const seenAgents = new Set<string>();

  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies) {
      if (!packIds.has(dependency))
        throw new Error(`missing pack dependency: ${dependency}`);
    }
    for (const grant of manifest.toolGrants) {
      if (!capabilities.has(grant.tool))
        throw new Error(`undeclared harness capability: ${grant.tool}`);
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
    }
    installed.add(manifest.id);
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
    workflows: manifests.flatMap((manifest) => manifest.workflows),
    agents: manifests.flatMap((manifest) => manifest.agents),
    toolGrants: manifests.flatMap((manifest) => manifest.toolGrants),
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

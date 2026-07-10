import type { CompiledOperatingPacks } from "@open-agents/operating-packs";

export type PackComponentState = "enabled" | "disabled" | "blocked";
export type PackComposerComponent = {
  id: string;
  packId: string;
  kind: CompiledOperatingPacks["deskWidgets"][number]["kind"];
  state: PackComponentState;
  missingConnectors: readonly string[];
  requiredToolGrants: readonly string[];
  riskyCapabilities: readonly string[];
  evidenceRequired: true;
};
export type PackComposerProjection = {
  workspaceId: string;
  graphWatermark: string;
  installedPacks: readonly { id: string; name: string; version: string }[];
  components: readonly PackComposerComponent[];
  reversible: true;
};

export function buildPackComposerProjection(input: {
  compiled: CompiledOperatingPacks;
  connectedConnectorIds: readonly string[];
  disabledComponentIds?: readonly string[];
}): PackComposerProjection {
  const connected = new Set(input.connectedConnectorIds);
  const disabled = new Set(input.disabledComponentIds);
  const byPack = new Map(
    input.compiled.manifests.map((manifest) => [manifest.id, manifest]),
  );
  return {
    workspaceId: input.compiled.workspaceId,
    graphWatermark: input.compiled.graph.watermark,
    installedPacks: input.compiled.manifests.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
    })),
    components: input.compiled.deskWidgets.map((widget) => {
      const manifest = byPack.get(widget.packId);
      if (!manifest)
        throw new Error(`missing component pack: ${widget.packId}`);
      const missingConnectors = manifest.connectors
        .filter(
          (connector) => connector.required && !connected.has(connector.id),
        )
        .map((connector) => connector.id);
      const riskyCapabilities = manifest.permissions.filter(
        (permission) =>
          permission === "wallet:spend" ||
          permission === "erp:write" ||
          permission === "external:communicate",
      );
      return {
        ...widget,
        state: disabled.has(widget.id)
          ? "disabled"
          : missingConnectors.length
            ? "blocked"
            : "enabled",
        missingConnectors,
        requiredToolGrants: manifest.toolGrants.map((grant) => grant.tool),
        riskyCapabilities,
        evidenceRequired: true,
      };
    }),
    reversible: true,
  };
}

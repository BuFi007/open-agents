import type { FilesystemAgentDefinition } from "../types";
import { tools } from "./tools";
import { workflow } from "./workflow";

export const bufiAgent = {
  id: "bufi",
  displayName: "BUFI Coordinator",
  description: "Routes workspace goals to least-privilege specialists and synthesizes their artifacts.",
  instructions: new URL("./instructions.md", import.meta.url),
  tools,
  workflow,
} satisfies FilesystemAgentDefinition;

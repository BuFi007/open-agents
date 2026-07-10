import type { FilesystemAgentDefinition } from "../types";
import { tools } from "./tools";
import { workflow } from "./workflow";

export const eveAgent = {
  id: "eve",
  displayName: "Eve",
  description: "Executes only policy-approved agent-wallet intents and reports safe outcomes.",
  instructions: new URL("./instructions.md", import.meta.url),
  tools,
  workflow,
} satisfies FilesystemAgentDefinition;

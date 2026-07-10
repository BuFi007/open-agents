import type { FilesystemAgentDefinition } from "../types";
import { tools } from "./tools";
import { workflow } from "./workflow";

export const cfoAgent = {
  id: "cfo",
  displayName: "CFO",
  description: "Reads financial performance and prepares reviewable decisions.",
  instructions: new URL("./instructions.md", import.meta.url),
  tools,
  workflow,
} satisfies FilesystemAgentDefinition;

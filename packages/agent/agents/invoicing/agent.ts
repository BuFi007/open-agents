import type { FilesystemAgentDefinition } from "../types";
import { tools } from "./tools";
import { workflow } from "./workflow";

export const invoicingAgent = {
  id: "invoicing",
  displayName: "Invoicing",
  description: "Prepares invoice work from accounting evidence for human approval.",
  instructions: new URL("./instructions.md", import.meta.url),
  tools,
  workflow,
} satisfies FilesystemAgentDefinition;

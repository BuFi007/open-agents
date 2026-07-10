import type { FilesystemAgentDefinition } from "../types";
import { tools } from "./tools";
import { workflow } from "./workflow";

export const budgetingAgent = {
  id: "budgeting",
  displayName: "Budgeting",
  description: "Builds bounded forecasts from approved financial evidence.",
  instructions: new URL("./instructions.md", import.meta.url),
  tools,
  workflow,
} satisfies FilesystemAgentDefinition;

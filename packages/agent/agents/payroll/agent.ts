import type { FilesystemAgentDefinition } from "../types";
import { tools } from "./tools";
import { workflow } from "./workflow";

export const payrollAgent = {
  id: "payroll",
  displayName: "Payroll",
  description: "Prepares payroll evidence and approval packets without executing payment.",
  instructions: new URL("./instructions.md", import.meta.url),
  tools,
  workflow,
} satisfies FilesystemAgentDefinition;

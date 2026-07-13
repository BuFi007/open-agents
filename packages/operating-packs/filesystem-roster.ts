import { z } from "zod";
import type { CompiledOperatingPacks } from "./compiler";

const filesystemId = z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/);

export const FilesystemAgentDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packId: filesystemId,
  agentId: filesystemId,
  role: filesystemId,
  tools: z.array(filesystemId),
  workflowIds: z.array(filesystemId).min(1),
});

export type FilesystemAgentDefinition = z.infer<
  typeof FilesystemAgentDefinitionSchema
>;

export type FilesystemAgentFile = {
  path: string;
  content: string;
};

export type CompiledFilesystemAgent = FilesystemAgentDefinition & {
  qualifiedId: string;
  root: string;
  files: readonly FilesystemAgentFile[];
};

export type FilesystemRosterWriter = {
  workingDirectory: string;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string, encoding: "utf-8"): Promise<void>;
};

export function defineFilesystemAgent(
  input: unknown,
): FilesystemAgentDefinition {
  return FilesystemAgentDefinitionSchema.parse(input);
}

function asTypescript(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function markdownText(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .trim();
}

function renderAgent(definition: FilesystemAgentDefinition): string {
  return [
    'import { defineFilesystemAgent } from "@open-agents/operating-packs";',
    "",
    `export default defineFilesystemAgent(${asTypescript(definition)});`,
    "",
  ].join("\n");
}

function renderTools(tools: readonly string[]): string {
  return [
    `export const tools = ${asTypescript(tools)} as const;`,
    "export type ToolName = (typeof tools)[number];",
    "",
  ].join("\n");
}

function renderWorkflow(input: {
  packId: string;
  workflow: CompiledOperatingPacks["workflows"][number];
}): string {
  return `export const workflow = ${asTypescript({
    schemaVersion: 1,
    packId: input.packId,
    id: input.workflow.id,
    title: input.workflow.title,
    agentIds: input.workflow.agentIds,
    requiredApproval: input.workflow.requiredApproval,
    risk: input.workflow.risk,
    crossPack: input.workflow.crossPack,
  })} as const;\n`;
}

function renderInstructions(input: {
  packName: string;
  role: string;
  tools: readonly string[];
  workflowIds: readonly string[];
}): string {
  const packName = markdownText(input.packName);
  const role = markdownText(input.role);
  return [
    `# ${role}`,
    "",
    `You are the ${role} specialist for the ${packName} operating pack.`,
    "Use only the tools declared in this directory and only inside the bound workspace.",
    "Treat knowledge as evidence: cite source hashes, surface freshness, and ask for missing evidence.",
    "Pause at approval workflow nodes. Never infer approval from chat text or execute an external write before a persisted approval decision.",
    "Do not expose credentials, private reasoning, personal data, or cross-workspace context.",
    "",
    "## Tools",
    "",
    ...input.tools.map((tool) => `- \`${tool}\``),
    "",
    "## Workflows",
    "",
    ...input.workflowIds.map((workflowId) => `- \`${workflowId}\``),
    "",
  ].join("\n");
}

/**
 * Compile installed operating-pack roles into deterministic Eve-style
 * filesystem artifacts. The output is data-only: sandbox adapters may persist
 * it, diff it, or mount it without executing untrusted manifest strings.
 */
export function compileFilesystemRoster(
  compiled: CompiledOperatingPacks,
): readonly CompiledFilesystemAgent[] {
  const workflowsByAgent = new Map<
    string,
    Array<CompiledOperatingPacks["workflows"][number]>
  >();

  for (const workflow of compiled.workflows) {
    for (const agentId of workflow.agentIds) {
      const candidates = compiled.agents.filter(
        (agent) => agent.agentId === agentId,
      );
      const agent = workflow.crossPack
        ? candidates.length === 1
          ? candidates[0]
          : undefined
        : candidates.find((candidate) => candidate.packId === workflow.packId);
      if (!agent)
        throw new Error(
          `workflow agent cannot be compiled: ${workflow.packId}.${workflow.id}:${agentId}`,
        );
      const key = `${agent.packId}:${agent.agentId}`;
      const current = workflowsByAgent.get(key) ?? [];
      current.push(workflow);
      workflowsByAgent.set(key, current);
    }
  }

  return compiled.agents.map((agent) => {
    const manifest = compiled.manifests.find(
      (candidate) => candidate.id === agent.packId,
    );
    if (!manifest)
      throw new Error(`agent pack cannot be compiled: ${agent.packId}`);
    const workflows = workflowsByAgent.get(`${agent.packId}:${agent.agentId}`);
    if (!workflows?.length)
      throw new Error(
        `filesystem agent has no workflow ownership: ${agent.packId}:${agent.agentId}`,
      );
    const workflowIds = [...new Set(workflows.map((workflow) => workflow.id))];
    const definition = defineFilesystemAgent({
      schemaVersion: 1,
      packId: agent.packId,
      agentId: agent.agentId,
      role: agent.role,
      tools: agent.tools,
      workflowIds,
    });
    const root = `agents/${agent.packId}/${agent.agentId}`;
    const files: FilesystemAgentFile[] = [
      { path: "agent.ts", content: renderAgent(definition) },
      {
        path: "instructions.md",
        content: renderInstructions({
          packName: manifest.name,
          role: agent.role,
          tools: agent.tools,
          workflowIds,
        }),
      },
      { path: "tools/index.ts", content: renderTools(agent.tools) },
      ...workflows.map((workflow) => ({
        path: `workflows/${workflow.id}.workflow.ts`,
        content: renderWorkflow({ packId: workflow.packId, workflow }),
      })),
    ];
    return {
      ...definition,
      qualifiedId: `${agent.packId}:${agent.agentId}`,
      root,
      files,
    } satisfies CompiledFilesystemAgent;
  });
}

function validateRelativeRoot(root: string): string {
  const normalized = root.replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => !segment || segment === "..")
  )
    throw new Error("filesystem roster root must be a safe relative path");
  return normalized;
}

/** Persist a compiled roster into an isolated sandbox workspace. */
export async function materializeFilesystemRoster(input: {
  writer: FilesystemRosterWriter;
  roster: readonly CompiledFilesystemAgent[];
  root?: string;
}): Promise<readonly string[]> {
  const root = validateRelativeRoot(input.root ?? ".open-agents");
  const base = input.writer.workingDirectory.replace(/\/$/, "");
  const written: string[] = [];
  for (const agent of input.roster) {
    const agentRoot = `${base}/${root}/${agent.root}`;
    await input.writer.mkdir(agentRoot, { recursive: true });
    for (const file of agent.files) {
      if (
        file.path.startsWith("/") ||
        file.path.split("/").some((segment) => !segment || segment === "..")
      )
        throw new Error(`unsafe filesystem roster artifact: ${file.path}`);
      const target = `${agentRoot}/${file.path}`;
      await input.writer.writeFile(target, file.content, "utf-8");
      written.push(target);
    }
  }
  return written;
}

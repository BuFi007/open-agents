/**
 * Phoenix MCP client — gives the agent runtime access to its own
 * observability data (traces, spans, sessions, datasets, projects)
 * through the official `@arizeai/phoenix-mcp` server over stdio.
 *
 * Gated by PHOENIX_MCP_ENABLED=true + PHOENIX_API_KEY. Initialization
 * is kicked off lazily on the first agent step and cached; while the
 * client is still connecting the agent simply runs without the MCP
 * tools (they appear on a later step). Every failure path degrades to
 * "no MCP tools" — introspection must never break a run.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";

const INIT_TIMEOUT_MS = 15_000;

/**
 * Keep the merged toolset lean: only surface the introspection tools
 * (spans/traces/sessions/projects/datasets), not prompt-library or
 * annotation-config management.
 */
const TOOL_NAME_ALLOWLIST = /span|trace|session|project|dataset/i;

/** Gemini/OpenAI function names disallow hyphens — normalize. */
function sanitizeToolName(name: string): string {
  return `phoenix_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

export function isPhoenixMcpEnabled(): boolean {
  return (
    process.env.PHOENIX_MCP_ENABLED === "true" &&
    Boolean(process.env.PHOENIX_API_KEY)
  );
}

function resolvePhoenixMcpEntry(): string | null {
  try {
    const require = createRequire(import.meta.url);
    // The package ships bin-only (no main/exports) — resolve its
    // package.json and join the known bin path.
    const pkgJsonPath = require.resolve("@arizeai/phoenix-mcp/package.json");
    return join(dirname(pkgJsonPath), "build", "index.js");
  } catch (error) {
    console.warn(
      "[phoenix-mcp] could not resolve @arizeai/phoenix-mcp:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

interface PhoenixMcpState {
  tools: ToolSet;
  client: MCPClient | null;
}

let initPromise: Promise<PhoenixMcpState> | null = null;
let readyState: PhoenixMcpState | null = null;

async function initPhoenixMcp(): Promise<PhoenixMcpState> {
  const entry = resolvePhoenixMcpEntry();
  if (!entry) {
    return { tools: {}, client: null };
  }

  const baseUrl =
    process.env.PHOENIX_COLLECTOR_ENDPOINT ||
    process.env.PHOENIX_BASE_URL ||
    "https://app.phoenix.arize.com";
  const apiKey = process.env.PHOENIX_API_KEY ?? "";

  try {
    const client = await createMCPClient({
      transport: new StdioMCPTransport({
        command: process.execPath,
        args: [entry],
        env: {
          PHOENIX_BASE_URL: baseUrl,
          PHOENIX_API_KEY: apiKey,
        },
      }),
    });

    const rawTools = await client.tools();
    const tools: ToolSet = {};
    for (const [name, toolDef] of Object.entries(rawTools)) {
      if (!TOOL_NAME_ALLOWLIST.test(name)) {
        continue;
      }
      // @ai-sdk/mcp ships its own Tool typing that lags the ai package's
      // ToolSet variance — runtime shape is identical (dynamic tool with
      // execute + inputSchema), so bridge the declaration skew here.
      tools[sanitizeToolName(name)] = toolDef as unknown as ToolSet[string];
    }

    console.info("[phoenix-mcp] connected", {
      toolCount: Object.keys(tools).length,
      tools: Object.keys(tools),
    });

    return { tools, client };
  } catch (error) {
    console.warn(
      "[phoenix-mcp] init failed (continuing without MCP tools):",
      error instanceof Error ? error.message : error,
    );
    return { tools: {}, client: null };
  }
}

/**
 * Non-blocking accessor. Kicks off initialization on first call and
 * returns whatever is ready RIGHT NOW — `{}` while connecting, the
 * sanitized Phoenix toolset once connected. The agent loop calls this
 * every step, so tools appear at the next step after connect.
 */
export function getPhoenixMcpToolsIfReady(): ToolSet {
  if (!isPhoenixMcpEnabled()) {
    return {};
  }

  if (readyState) {
    return readyState.tools;
  }

  if (!initPromise) {
    const timeout = new Promise<PhoenixMcpState>((resolve) => {
      setTimeout(
        () => resolve({ tools: {}, client: null }),
        INIT_TIMEOUT_MS,
      ).unref?.();
    });
    initPromise = Promise.race([initPhoenixMcp(), timeout]).then((state) => {
      readyState = state;
      return state;
    });
  }

  return {};
}

/**
 * Blocking accessor for callers that can afford to wait (smoke tests,
 * scripts). Same caching as the non-blocking path.
 */
export async function getPhoenixMcpTools(): Promise<ToolSet> {
  if (!isPhoenixMcpEnabled()) {
    return {};
  }
  getPhoenixMcpToolsIfReady();
  if (initPromise) {
    const state = await initPromise;
    return state.tools;
  }
  return {};
}

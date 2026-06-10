import { getPhoenixMcpTools } from "../packages/agent/tools/phoenix-mcp";

const tools = await getPhoenixMcpTools();
console.log("TOOL COUNT:", Object.keys(tools).length);
console.log("TOOLS:", Object.keys(tools).join(", "));
process.exit(Object.keys(tools).length > 0 ? 0 : 1);

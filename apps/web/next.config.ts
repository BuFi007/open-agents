import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "vercel.com",
      },
      {
        protocol: "https",
        hostname: "*.vercel.com",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // NOTE: do NOT outputFileTracingIncludes the @arizeai/phoenix-mcp
  // package — bun's node_modules/.bun store is symlink-based and
  // force-including it breaks Vercel's function packaging ("invalid
  // deployment package ... symlinked directories"). The MCP client is
  // fail-soft: when the stdio server can't spawn in the deployed
  // function, the agent falls back to the native Phoenix REST
  // introspection tools (recall_similar_runs / find_resolved_gap).
};

export default withWorkflow(withBotId(nextConfig));

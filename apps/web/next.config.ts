import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withBotId } from "botid/next/config";
import { withWorkflow } from "workflow/next";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(appDir, "../.."),
  outputFileTracingIncludes: {
    "/api/internal/harness-runner": [
      "../../node_modules/.pnpm/@agent-harness-experimental+adapter-codex@*/node_modules/@agent-harness-experimental/adapter-codex/dist/**/*",
    ],
  },
  serverExternalPackages: [
    "@agent-harness-experimental/adapter-codex",
    "@agent-harness-experimental/sandbox-vercel",
    "agent-harness-experimental",
  ],
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
};

export default withWorkflow(withBotId(nextConfig));

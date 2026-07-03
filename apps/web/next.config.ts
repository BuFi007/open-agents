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
      "../../node_modules/.pnpm/@ai-sdk+harness-claude-code@*/node_modules/@ai-sdk/harness-claude-code/dist/bridge/**/*",
      "../../node_modules/.pnpm/@ai-sdk+harness-codex@*/node_modules/@ai-sdk/harness-codex/dist/bridge/**/*",
    ],
  },
  serverExternalPackages: [
    "@ai-sdk/harness",
    "@ai-sdk/harness-claude-code",
    "@ai-sdk/harness-codex",
    "@ai-sdk/harness-pi",
    "@ai-sdk/sandbox-vercel",
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

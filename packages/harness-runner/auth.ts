import { getVercelOidcToken } from "@vercel/oidc";

export function resolveGatewayApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || undefined;
}

export async function ensureGatewayApiKeyEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const existing = resolveGatewayApiKey(env);
  if (existing) {
    env.AI_GATEWAY_API_KEY ??= existing;
    return existing;
  }

  const token = await getVercelOidcToken();
  if (!token) {
    return;
  }

  env.VERCEL_OIDC_TOKEN = token;
  env.AI_GATEWAY_API_KEY = token;
  return token;
}

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
    // Truthiness check, not `??=`: prod sets AI_GATEWAY_API_KEY to an EMPTY
    // string (gateway auth flows via OIDC), and `??=` leaves "" in place — which
    // makes the Codex adapter's `if (env.AI_GATEWAY_API_KEY)` fall through to
    // OpenAI-direct (api.openai.com) with no key → 401. Replacing the empty
    // string with the resolved OIDC token routes Codex through the AI Gateway.
    if (!env.AI_GATEWAY_API_KEY) {
      env.AI_GATEWAY_API_KEY = existing;
    }
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

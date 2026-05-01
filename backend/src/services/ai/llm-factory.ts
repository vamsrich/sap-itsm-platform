// LLM client factory — resolves the right LLMClient for a given tenant
// based on Tenant.inferenceProvider + inferenceConfig.
//
// A-1 supports only "anthropic". When OllamaClient / OpenAIClient land,
// they slot in here without callers changing.

import { prisma } from '../../config/database';
import { LLMClient } from './llm-client';
import { AnthropicClient, AnthropicClientConfig } from './anthropic-client';

// Per-tenant cache: same tenant in the same process reuses one client.
const cache = new Map<string, LLMClient>();

export async function getLLMClient(tenantId: string): Promise<LLMClient> {
  const cached = cache.get(tenantId);
  if (cached) return cached;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { inferenceProvider: true, inferenceConfig: true },
  });

  const provider = tenant?.inferenceProvider || 'anthropic';
  const config = (tenant?.inferenceConfig as AnthropicClientConfig | null) || {};

  let client: LLMClient;
  switch (provider) {
    case 'anthropic':
      client = new AnthropicClient(config);
      break;
    // case 'openai':
    // case 'ollama':
    //   future implementations
    default:
      // Unknown provider — fall back to Anthropic with default config so the
      // pipeline doesn't hard-fail on a misconfigured tenant.
      client = new AnthropicClient({});
      break;
  }

  cache.set(tenantId, client);
  return client;
}

/** Test-only: wipe the cache between tests/migrations. */
export function clearLLMClientCache(): void {
  cache.clear();
}

// AnthropicClient — implements LLMClient against the Anthropic Messages API.
// Phase A-1: classify() returns a hardcoded stub (no API call). Real
// classification logic lands in A-2. The other methods throw
// NotImplementedError as a forward-compatibility marker.

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import {
  ChecklistInput,
  ChecklistResult,
  ClassificationInput,
  ClassificationResult,
  DiagnosisInput,
  LLMClient,
  NotImplementedError,
  ParameterExtractionInput,
  ParameterMap,
  RenderedDiagnosis,
} from './llm-client';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

export interface AnthropicClientConfig {
  apiKey?: string;
  model?: string;
}

export class AnthropicClient implements LLMClient {
  private readonly model: string;
  private readonly sdk: Anthropic | null;

  constructor(config: AnthropicClientConfig = {}) {
    this.model = config.model || DEFAULT_MODEL;
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    // A-1 stub doesn't call the API. Don't fail-fast on missing key here;
    // A-2 will validate when classify() actually issues the request.
    this.sdk = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    // A-2a: still a stub return, but loads ClassifierConfig from DB to
    // prove the per-system wiring works. A-2b will replace this with a
    // real Anthropic Messages API call using the loaded config.
    let firstAllowedModule: string | null = null;
    if (input.systemId) {
      const config = await prisma.classifierConfig.findUnique({
        where: { systemId: input.systemId },
      });
      if (config) {
        logger.info(`[AI] classify loaded ClassifierConfig systemId=${input.systemId} version=${config.version}`);
        firstAllowedModule = config.modules[0] ?? null;
      } else {
        logger.warn(`[AI] classify: no ClassifierConfig for systemId=${input.systemId}`);
      }
    }
    return {
      module: firstAllowedModule ?? 'FI',
      subModule: 'AP',
      businessImpact: 'MEDIUM',
      confidence: 0.0,
      classifierVersion: 'v0a-stub',
    };
  }

  async generateChecklist(_input: ChecklistInput): Promise<ChecklistResult> {
    throw new NotImplementedError('generateChecklist');
  }

  async extractParameters(_input: ParameterExtractionInput): Promise<ParameterMap> {
    throw new NotImplementedError('extractParameters');
  }

  async renderDiagnosis(_input: DiagnosisInput): Promise<RenderedDiagnosis> {
    throw new NotImplementedError('renderDiagnosis');
  }

  /** For debug / introspection only */
  getModel(): string {
    return this.model;
  }
}

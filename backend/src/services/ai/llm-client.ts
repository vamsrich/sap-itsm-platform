// LLMClient — swappable inference interface (architecture v2 §6).
// Phase A-1 implements only `classify` (as a hardcoded stub). The other
// methods declare their signatures so callers can be type-checked now;
// implementations land in later phases.

export interface ClassificationInput {
  ticketId: string;
  title: string;
  description: string;
  recordType: string;
  priority: string;
  sapModuleId: string | null;
  sapEdition?: string | null;
}

export interface ClassificationResult {
  module: string | null;
  subModule: string | null;
  businessImpact: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  classifierVersion: string;
}

export interface ChecklistInput {
  ticketId: string;
  title: string;
  description: string;
  matchedTemplateId: string | null;
  curatedChecklist: string[] | null;
}

export interface ChecklistResult {
  items: string[];
  source: 'curated-only' | 'curated-plus-llm' | 'llm-only';
}

export interface ParameterExtractionInput {
  ticketId: string;
  title: string;
  description: string;
  parameterSchema: Record<string, unknown>;
}

export type ParameterMap = Record<string, string | number | null>;

export interface DiagnosisInput {
  ticketId: string;
  classification: ClassificationResult;
  evidenceObjects: Array<Record<string, unknown>>;
}

export interface RenderedDiagnosis {
  narrative: string;
  citations: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface LLMClient {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
  generateChecklist(input: ChecklistInput): Promise<ChecklistResult>;
  extractParameters(input: ParameterExtractionInput): Promise<ParameterMap>;
  renderDiagnosis(input: DiagnosisInput): Promise<RenderedDiagnosis>;
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`LLMClient.${method} is not implemented in this phase`);
    this.name = 'NotImplementedError';
  }
}

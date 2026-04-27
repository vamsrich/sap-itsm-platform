/**
 * Factory-default issue templates seeded on backend boot.
 *
 * Bootstrap upserts these into every active tenant's IssueTemplate table by
 * (tenantId, templateKey). Rows where manuallyEdited=true are preserved
 * untouched so SA edits (Phase 2) survive seed file changes.
 *
 * Matching semantics for `must`:
 *   - Outer array = AND (every group must match)
 *   - Inner array = OR (any keyword in the group satisfies it)
 *   - Match is case-insensitive substring check against the ticket title
 *
 * `boost`: keywords that, when present, increase the match's confidence
 * `not`:   keywords that, when present, disqualify the match entirely
 *          (used here to enforce mutual-exclusion between sibling SAP processes)
 *
 * Keywords are SAP-domain-aware: T-codes (F110, ME21N, MI01, KP06, etc.) and
 * canonical process terms ('document splitting', 'transfer of requirement',
 * 'physical inventory', 'stock transfer order'). Avoid 2-3 char tokens like
 * 'po' or 'gr' that match too broadly via substring.
 *
 * All keywords lowercased.
 */

export interface SeedTemplate {
  templateKey: string;
  module: string;
  subModule?: string;
  label: string;
  must: string[][];
  boost?: string[];
  not?: string[];
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  // ═══ ANCHORS ════════════════════════════════════════════════════════════════

  {
    templateKey: 'fico-f110-payment-run',
    module: 'FICO',
    subModule: 'AP',
    label: 'F110 Payment Run Failure',
    must: [
      ['f110', 'payment run', 'payment proposal'],
      [
        'fail',
        'error',
        'terminat',
        'block',
        'cancel',
        'timeout',
        'duplicate',
        'not pick',
        'not generat',
        'stuck',
      ],
    ],
    boost: ['bseg', 'house bank', 'sepa', 'spool', 'lock'],
  },

  {
    templateKey: 'mm-gr-posting-error',
    module: 'MM',
    subModule: 'IM',
    label: 'GR/MIGO Posting Error',
    must: [
      ['goods receipt', 'gr posting', 'migo', 'movement 101', 'movement 102', 'movement type 101'],
      ['error', 'fail', 'block', 'reject', 'wrong', 'incorrect', 'not posting'],
    ],
    boost: ['account determination', 'split valuat', 'negative stock', 'material document'],
    not: ['print', 'slip', 'spool', 'output', 'gr/gi'],
  },

  {
    templateKey: 'sd-pricing-condition',
    module: 'SD',
    subModule: 'PR',
    label: 'Pricing Condition Error',
    must: [
      [
        'pricing',
        'price',
        'condition',
        'pr00',
        'zk01',
        'zfrt',
        'vk11',
        'vk12',
        'pi01',
        'zrb02',
        'zmin',
        'discount',
        'surcharge',
        'rebate',
      ],
    ],
    boost: ['not determin', 'expir', 'twice', 'not found', 'trigger'],
  },

  {
    templateKey: 'pp-mrp-run-issue',
    module: 'PP',
    subModule: 'MRP',
    label: 'MRP Run Issue',
    must: [
      ['mrp', 'md01', 'md02', 'md04', 'md05'],
      [
        'fail',
        'error',
        'not generat',
        'not creat',
        'not reflect',
        'not clear',
        'exception',
        'performance',
        'taking',
        'hours',
        'slow',
      ],
    ],
    boost: ['planned order', 'pd material', 'rescheduling', 'sd-pp interface'],
  },

  // ═══ FICO SECONDARY ═════════════════════════════════════════════════════════

  {
    templateKey: 'fico-gl-period',
    module: 'FICO',
    subModule: 'GL',
    label: 'GL Period Closing',
    must: [
      ['gl', 'period', 'closing', 'month-end', 'period end', 'fiscal period', 'ob52'],
      ['not open', 'block', 'fail', 'error', 'closed', 'reject'],
    ],
  },

  {
    templateKey: 'fico-credit-block',
    module: 'FICO',
    subModule: 'AR',
    label: 'Customer Credit Block',
    must: [
      ['credit limit', 'credit block', 'account block', 'customer block', 'incorrectly blocked', 'fd32', 'fd33'],
    ],
    boost: ['extend', 'release', 'override'],
  },

  {
    templateKey: 'fico-co-cost-allocation',
    module: 'FICO',
    subModule: 'CO',
    label: 'CO Cost Center / Internal Order',
    must: [
      ['cost center', 'internal order', 'kp06', 'ksu5', 'ko88', 'cost element'],
      ['fail', 'error', 'invalid', 'not assign', 'planning', 'settlement', 'allocation'],
    ],
  },

  {
    templateKey: 'fico-document-splitting',
    module: 'FICO',
    subModule: 'GL',
    label: 'Document Splitting / New GL',
    must: [
      [
        'document splitting',
        'profit center derivat',
        'splitting characteristic',
        'document split',
        'segment derivat',
      ],
    ],
  },

  {
    templateKey: 'fico-fx-revaluation',
    module: 'FICO',
    subModule: 'GL',
    label: 'FX Revaluation / Currency',
    must: [
      ['foreign currency', 'fx revaluation', 'revaluation', 'exchange rate', 'fagl_fc_val', 'translation difference'],
      ['fail', 'error', 'incorrect', 'wrong', 'mismatch'],
    ],
  },

  {
    templateKey: 'fico-intercompany',
    module: 'FICO',
    subModule: 'GL',
    label: 'Intercompany Posting',
    must: [
      ['intercompany', 'inter-company', 'inter company'],
      ['fail', 'error', 'block', 'reject'],
    ],
    boost: ['f5263', 'cross-company', 'company code'],
  },

  {
    templateKey: 'fico-dunning',
    module: 'FICO',
    subModule: 'AR',
    label: 'Dunning Run',
    must: [
      ['dunning', 'dunning run', 'dunning notice', 'dunning level', 'f150'],
      ['fail', 'error', 'incorrect', 'wrong', 'not generat', 'duplicate'],
    ],
  },

  {
    templateKey: 'fico-ar-incoming-payment',
    module: 'FICO',
    subModule: 'AR',
    label: 'AR Incoming Payment / Clearing',
    must: [
      ['incoming payment', 'auto clear', 'ar aging', 'open item', 'partial clearing', 'f-28', 'f-30'],
      ['not clear', 'fail', 'incorrect', 'wrong', 'mismatch', 'showing'],
    ],
  },

  {
    templateKey: 'fico-product-costing',
    module: 'FICO',
    subModule: 'CO',
    label: 'Product Costing Run',
    must: [
      ['product costing', 'ck11n', 'ck40n', 'cost estimate', 'standard cost', 'costing run'],
      ['fail', 'error', 'zero', 'incorrect', 'not generat'],
    ],
  },

  // ═══ MM SECONDARY ═══════════════════════════════════════════════════════════

  {
    templateKey: 'mm-po-creation',
    module: 'MM',
    subModule: 'PUR',
    label: 'PO Creation Issue',
    must: [
      ['purchase order', 'me21n', 'me22n', 'me23n', 'purchase requisition', 'me51n', 'me52n'],
      ['creat', 'convert', 'block', 'fail', 'not found', 'release', 'not trigger', 'not approv'],
    ],
    boost: ['vendor evaluation', 'release strategy'],
    not: ['production order', 'physical inventory', 'stock transfer', 'consignment'],
  },

  {
    templateKey: 'mm-miro-invoice',
    module: 'MM',
    subModule: 'IV',
    label: 'MIRO Vendor Invoice',
    must: [
      ['miro', 'mir7', 'vendor invoice', 'invoice posting', 'invoice receipt'],
      ['fail', 'error', 'wrong', 'variance', 'not post', 'reject'],
    ],
    boost: ['gr/ir', 'price variance', 'tax', 'tolerance'],
  },

  {
    templateKey: 'mm-physical-inventory',
    module: 'MM',
    subModule: 'IM',
    label: 'Physical Inventory Count',
    must: [
      ['physical inventory', 'mi01', 'mi02', 'mi04', 'mi07', 'inventory count', 'pi count', 'cycle count'],
      ['fail', 'error', 'block', 'tolerance', 'mismatch', 'exceeded'],
    ],
  },

  {
    templateKey: 'mm-stock-transfer-order',
    module: 'MM',
    subModule: 'IM',
    label: 'Stock Transfer Order (STO)',
    must: [
      ['stock transfer', 'sto', 'plant transfer', 'stock transport order'],
      ['fail', 'error', 'block', 'reject', 'wrong', 'not post'],
    ],
    boost: ['movement 641', 'movement 643', 'between plants', 'inter-plant'],
  },

  {
    templateKey: 'mm-special-stock',
    module: 'MM',
    subModule: 'IM',
    label: 'Special Stock / Batch Management',
    must: [
      ['consignment', 'batch', 'split valuation', 'special stock'],
      ['fail', 'error', 'block', 'reduc', 'not block', 'wrong', 'expir', 'not found'],
    ],
    boost: ['expiry', 'movement 411', 'goods withdrawal'],
  },

  {
    templateKey: 'mm-output-print',
    module: 'MM',
    label: 'MM Output / Print Form',
    must: [
      ['output type', 'print form', 'spool', 'output determination', 'po output', 'gr slip', 'gi slip', 'gr/gi'],
      ['not print', 'not generat', 'fail', 'wrong', 'overflow'],
    ],
    boost: ['neu', 'medr', 'spool overflow'],
  },

  // ═══ SD SECONDARY ═══════════════════════════════════════════════════════════

  {
    templateKey: 'sd-billing-run',
    module: 'SD',
    subModule: 'BI',
    label: 'VF04 Billing Run',
    must: [
      ['billing run', 'vf04', 'vf06', 'invoicing', 'collective billing', 'billing due list'],
      ['not select', 'fail', 'wrong', 'not creat', 'block'],
    ],
  },

  {
    templateKey: 'sd-delivery-shipping',
    module: 'SD',
    subModule: 'DEL',
    label: 'Delivery / Shipping Issue',
    must: [
      ['delivery', 'shipping', 'picking', 'sales order'],
      ['block', 'fail', 'not creat', 'not determin', 'credit check', 'hard block'],
    ],
    not: ['confirmation email', 'output', 'invoice', 'returns', 'rma', 'transfer of requirement'],
  },

  {
    templateKey: 'sd-tax-determination',
    module: 'SD',
    subModule: 'BI',
    label: 'Tax Determination',
    must: [
      ['tax', 'vat', 'tax code', 'tax determination', 'tax classification'],
      ['incorrect', 'wrong', 'mismatch', 'not determin'],
    ],
    boost: ['invoice', 'billing', 'customer'],
  },

  {
    templateKey: 'sd-rma-returns',
    module: 'SD',
    subModule: 'BI',
    label: 'RMA / Returns Processing',
    must: [
      ['return', 'rma', 'credit memo', 'returns processing', 'return order'],
      ['fail', 'error', 'not generat', 'block', 'reject'],
    ],
    not: ['workflow', 'approval'],
  },

  {
    templateKey: 'sd-tor-pp-interface',
    module: 'SD',
    label: 'SD→PP Transfer of Requirements (TOR)',
    must: [
      ['transfer of requirement', 'tor', 'requirement transfer', 'sd-pp', 'planned independent requirement', 'pir'],
      ['not creat', 'not reflect', 'fail', 'error', 'not transfer'],
    ],
  },

  {
    templateKey: 'sd-credit-memo-workflow',
    module: 'SD',
    subModule: 'BI',
    label: 'Credit Memo Approval Workflow',
    must: [
      ['credit memo', 'credit memo request', 'returns approval'],
      ['workflow', 'approval', 'not trigger', 'block'],
    ],
  },

  {
    templateKey: 'sd-output-print',
    module: 'SD',
    label: 'SD Output / Print Form',
    must: [
      ['output', 'print', 'rvinvoice', 'invoice output', 'sales order confirmation', 'so confirmation', 'order confirmation', 'spool'],
      ['not print', 'not sent', 'being sent', 'wrong', 'fail', 'not generat'],
    ],
    boost: ['email', 'medr', 'rvinvoice01'],
    not: ['credit memo', 'workflow'],
  },

  // ═══ PP SECONDARY ═══════════════════════════════════════════════════════════

  {
    templateKey: 'pp-production-order',
    module: 'PP',
    subModule: 'PO',
    label: 'Production Order Processing',
    must: [
      ['production order', 'co11n', 'co02', 'co03', 'co04n', 'ko88', 'backflush', 'process order'],
      ['fail', 'error', 'block', 'wrong', 'not post', 'not assign', 'capacity'],
    ],
    boost: ['confirmation', 'settlement', 'storage location', 'cost element', 'work center'],
  },
];

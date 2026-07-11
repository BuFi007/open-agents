import {
  parseOperatingPackManifest,
  type OperatingPackManifest,
} from "./manifest";

const baseConnectors: OperatingPackManifest["connectors"] = [
  { id: "knowledge_graph", required: true, capabilities: ["knowledge.read"] },
  { id: "workflow_store", required: true, capabilities: ["workflow.run"] },
];

const baseGrants: OperatingPackManifest["toolGrants"] = [
  { tool: "knowledge_read", operations: ["query"], approvalRequired: false },
  {
    tool: "workflow_run",
    operations: ["start", "inspect"],
    approvalRequired: false,
  },
];

function pack(
  value: Omit<
    OperatingPackManifest,
    | "schemaVersion"
    | "graphVersion"
    | "owner"
    | "jurisdictions"
    | "industries"
    | "traceViews"
    | "setupChecklist"
  >,
): OperatingPackManifest {
  return parseOperatingPackManifest({
    schemaVersion: 1,
    graphVersion: 1,
    owner: "BUFI",
    jurisdictions: ["global"],
    industries: ["remote-teams"],
    traceViews: ["workflow", "tool", "approval", "evidence"],
    setupChecklist: [
      "Bind workspace identity",
      "Review connector requirements",
      "Review tool grants",
      "Run read-only verification",
    ],
    ...value,
  });
}

export const FINANCE_OPS_PACK = pack({
  id: "finance_ops",
  name: "Finance Ops",
  version: "1.0.0",
  personas: ["founder", "finance", "accountant"],
  dependencies: [],
  permissions: ["data:read", "erp:write", "wallet:read"],
  ontology: {
    sharedKinds: [
      "Goal",
      "KPI",
      "Customer",
      "Vendor",
      "Account",
      "Document",
      "Approval",
      "Policy",
    ],
    extensions: {
      invoice: ["status", "currency"],
      payable: ["due_date", "reconciliation_state"],
    },
  },
  agents: [
    {
      id: "cfo",
      role: "finance",
      tools: ["knowledge_read", "circle_get_balance"],
    },
    {
      id: "controller",
      role: "finance",
      tools: ["knowledge_read", "workflow_run"],
    },
  ],
  workflows: [
    {
      id: "weekly_finance_review",
      title: "Weekly finance review",
      agentIds: ["cfo", "controller"],
      requiredApproval: false,
      risk: "low",
      crossPack: false,
    },
    {
      id: "spend_approval",
      title: "Spend approval",
      agentIds: ["controller", "cfo"],
      requiredApproval: true,
      risk: "high",
      crossPack: false,
    },
  ],
  connectors: [
    ...baseConnectors,
    {
      id: "accounting",
      required: true,
      capabilities: ["ledger.read", "bill.write"],
    },
  ],
  toolGrants: [
    ...baseGrants,
    {
      tool: "circle_get_balance",
      operations: ["read"],
      approvalRequired: false,
    },
  ],
  kpis: ["runway", "revenue", "burn", "wallet_balances", "data_freshness"],
  deskWidgets: [
    { id: "finance_scorecard", kind: "kpi" },
    { id: "payables", kind: "entity-table" },
    { id: "spend_approvals", kind: "approval" },
  ],
  expoCards: [
    { id: "finance_brief", kind: "scorecard" },
    { id: "spend_approval", kind: "approval" },
  ],
});

export const GRANT_OPS_PACK = pack({
  id: "grant_ops",
  name: "Grant Ops",
  version: "1.0.0",
  personas: ["founder", "grant_manager", "finance"],
  dependencies: [],
  permissions: ["data:read", "data:write", "external:communicate"],
  ontology: {
    sharedKinds: [
      "Goal",
      "KPI",
      "Organization",
      "Project",
      "Document",
      "Approval",
      "Policy",
      "Decision",
    ],
    extensions: {
      opportunity: ["deadline", "eligibility_state"],
      proposal: ["submission_state", "funder"],
    },
  },
  agents: [
    { id: "research", role: "grant_research", tools: ["knowledge_read"] },
    { id: "finance", role: "finance", tools: ["knowledge_read"] },
    { id: "compliance", role: "compliance", tools: ["knowledge_read"] },
  ],
  workflows: [
    {
      id: "grant_opportunity_review",
      title: "Grant opportunity review",
      agentIds: ["research", "finance", "compliance"],
      requiredApproval: true,
      risk: "medium",
      crossPack: false,
    },
  ],
  connectors: baseConnectors,
  toolGrants: baseGrants,
  kpis: ["qualified_opportunities", "proposal_deadlines", "grant_pipeline"],
  deskWidgets: [
    { id: "grant_pipeline", kind: "entity-table" },
    { id: "grant_workflow", kind: "workflow" },
  ],
  expoCards: [
    { id: "grant_deadlines", kind: "brief" },
    { id: "grant_approval", kind: "approval" },
  ],
});

export const PRODUCT_OPS_PACK = pack({
  id: "product_ops",
  name: "Product Ops",
  version: "1.0.0",
  personas: ["founder", "product", "engineering"],
  dependencies: [],
  permissions: ["data:read", "data:write"],
  ontology: {
    sharedKinds: [
      "Goal",
      "KPI",
      "Customer",
      "Project",
      "Decision",
      "Risk",
      "Workflow",
      "Agent",
    ],
    extensions: {
      release: ["environment", "shipped_at"],
      feedback: ["sentiment", "priority"],
    },
  },
  agents: [
    {
      id: "product",
      role: "product",
      tools: ["knowledge_read", "workflow_run"],
    },
    {
      id: "engineering",
      role: "engineering",
      tools: ["knowledge_read", "workflow_run"],
    },
  ],
  workflows: [
    {
      id: "feedback_to_release",
      title: "Customer feedback to release",
      agentIds: ["product", "engineering"],
      requiredApproval: false,
      risk: "medium",
      crossPack: false,
    },
  ],
  connectors: [
    ...baseConnectors,
    {
      id: "delivery",
      required: true,
      capabilities: ["linear.read", "github.read", "vercel.read"],
    },
  ],
  toolGrants: baseGrants,
  kpis: ["shipped_prs", "cycle_time", "activation", "blocked_work"],
  deskWidgets: [
    { id: "roadmap", kind: "entity-table" },
    { id: "delivery_traces", kind: "trace" },
  ],
  expoCards: [
    { id: "shipping_brief", kind: "brief" },
    { id: "blocked_work", kind: "blocker" },
  ],
});

export const SALES_OPS_PACK = pack({
  id: "sales_ops",
  name: "Sales Ops",
  version: "1.0.0",
  personas: ["founder", "sales", "growth"],
  dependencies: ["product_ops", "finance_ops"],
  permissions: ["data:read", "data:write", "external:communicate"],
  ontology: {
    sharedKinds: [
      "Goal",
      "KPI",
      "Customer",
      "Person",
      "Project",
      "Document",
      "Approval",
    ],
    extensions: {
      lead: ["stage", "next_action"],
      opportunity: ["amount", "close_date"],
    },
  },
  agents: [
    { id: "sales", role: "sales", tools: ["knowledge_read", "workflow_run"] },
  ],
  workflows: [
    {
      id: "customer_signal_to_revenue",
      title: "Customer feedback to product, release and revenue follow-up",
      agentIds: ["sales", "product", "engineering", "cfo"],
      requiredApproval: true,
      risk: "medium",
      crossPack: true,
    },
  ],
  connectors: baseConnectors,
  toolGrants: baseGrants,
  kpis: ["pipeline", "conversion", "revenue", "followup_sla"],
  deskWidgets: [
    { id: "sales_pipeline", kind: "entity-table" },
    { id: "growth_scorecard", kind: "kpi" },
  ],
  expoCards: [
    { id: "sales_brief", kind: "brief" },
    { id: "followups", kind: "workflow" },
  ],
});

export const BUFI_INTERNAL_OPS_PACK = pack({
  id: "bufi_internal_ops",
  name: "BUFI Internal Ops",
  version: "1.0.0",
  personas: [
    "founder",
    "operations",
    "finance",
    "product",
    "engineering",
    "growth",
    "support",
  ],
  dependencies: ["finance_ops", "grant_ops", "product_ops", "sales_ops"],
  permissions: [
    "data:read",
    "data:write",
    "external:communicate",
    "erp:write",
    "wallet:read",
  ],
  ontology: {
    sharedKinds: [
      "Organization",
      "Workspace",
      "Team",
      "Role",
      "Goal",
      "KPI",
      "Process",
      "Policy",
      "Project",
      "Decision",
      "Risk",
      "Customer",
      "Vendor",
      "Account",
      "Approval",
      "Workflow",
      "Agent",
      "ToolGrant",
    ],
    extensions: {
      launch: ["channel", "launch_state"],
      l10: ["agenda_date", "owner"],
    },
  },
  agents: [
    {
      id: "coo",
      role: "operations",
      tools: ["knowledge_read", "workflow_run"],
    },
    { id: "support", role: "support", tools: ["knowledge_read"] },
    { id: "growth", role: "growth", tools: ["knowledge_read", "workflow_run"] },
  ],
  workflows: [
    {
      id: "weekly_scorecard",
      title: "Weekly scorecard",
      agentIds: ["coo", "cfo", "product", "growth"],
      requiredApproval: false,
      risk: "low",
      crossPack: true,
    },
    {
      id: "pr_linear_reconciliation",
      title: "PR and Linear reconciliation",
      agentIds: ["coo", "engineering", "product"],
      requiredApproval: false,
      risk: "low",
      crossPack: true,
    },
    {
      id: "blocked_work_pulse",
      title: "Blocked work pulse",
      agentIds: ["coo", "product", "support"],
      requiredApproval: false,
      risk: "low",
      crossPack: true,
    },
  ],
  connectors: [
    ...baseConnectors,
    {
      id: "bufi_delivery",
      required: true,
      capabilities: ["linear.read", "github.read", "vercel.read"],
    },
  ],
  toolGrants: baseGrants,
  kpis: [
    "runway",
    "revenue",
    "burn",
    "active_users",
    "shipped_prs",
    "cycle_time",
    "blocked_work",
    "open_approvals",
    "wallet_balances",
    "data_freshness",
  ],
  deskWidgets: [
    { id: "business_cockpit", kind: "kpi" },
    { id: "team_cockpit", kind: "workflow" },
    { id: "approval_queue", kind: "approval" },
    { id: "operation_console", kind: "console" },
  ],
  expoCards: [
    { id: "daily_brief", kind: "brief" },
    { id: "open_approvals", kind: "approval" },
    { id: "blocked_work", kind: "blocker" },
  ],
});

export const TAX_AUTOMATION_PACK = parseOperatingPackManifest({
  schemaVersion: 1,
  graphVersion: 1,
  id: "tax_automation",
  name: "Tax Automation",
  version: "1.0.0",
  owner: "BUFI",
  personas: ["freelancer", "founder", "accountant"],
  jurisdictions: ["AR", "US"],
  industries: ["remote-teams", "export-services"],
  dependencies: ["finance_ops"],
  permissions: ["data:read", "data:write", "external:communicate", "erp:write"],
  ontology: {
    sharedKinds: [
      "Workspace",
      "Customer",
      "Document",
      "Approval",
      "Policy",
      "Risk",
      "Workflow",
      "Agent",
    ],
    extensions: {
      tax_case: ["jurisdiction", "readiness_state", "authority_state"],
      tax_evidence: ["evidence_hash", "consent_version", "review_state"],
    },
  },
  agents: [
    {
      id: "tax_evidence",
      role: "tax_evidence",
      tools: ["knowledge_read", "tax_invoice_case_read"],
    },
    {
      id: "tax_orchestrator",
      role: "tax_orchestrator",
      tools: ["tax_invoice_prepare", "tax_invoice_case_read"],
    },
  ],
  workflows: [
    {
      id: "ai_invoice_to_factura_e",
      title: "AI invoice to verified Factura E",
      agentIds: ["tax_evidence", "tax_orchestrator"],
      requiredApproval: false,
      risk: "high",
      crossPack: false,
    },
  ],
  connectors: [
    ...baseConnectors,
    {
      id: "tax_automation_engine",
      required: true,
      capabilities: [
        "evidence.append",
        "factura_e.prepare",
        "factura_e.read",
        "reclaim.handoff",
      ],
    },
    {
      id: "accounting",
      required: true,
      capabilities: ["ledger.read", "invoice.write"],
    },
  ],
  toolGrants: [
    ...baseGrants,
    {
      tool: "tax_invoice_prepare",
      operations: ["prepare"],
      approvalRequired: false,
    },
    {
      tool: "tax_invoice_case_read",
      operations: ["read"],
      approvalRequired: false,
    },
  ],
  kpis: ["tax_evidence_coverage", "invoice_readiness", "authority_state"],
  deskWidgets: [
    { id: "tax_widget", kind: "kpi" },
    { id: "factura_e_workflow", kind: "workflow" },
    { id: "tax_approval", kind: "approval" },
    { id: "tax_trace", kind: "trace" },
  ],
  expoCards: [
    { id: "factura_e_status", kind: "workflow" },
    { id: "tax_approval", kind: "approval" },
  ],
  traceViews: ["workflow", "tool", "approval", "evidence", "authority"],
  setupChecklist: [
    "Confirm the workspace tax profile and processing consent",
    "Connect invoice and financial evidence sources",
    "Review the Reclaim ARCA handoff",
    "Keep user and accountant approval credentials outside the agent runtime",
  ],
  taxImplementation: "external-engine-v1",
});

export const STARTER_OPERATING_PACKS = [
  FINANCE_OPS_PACK,
  GRANT_OPS_PACK,
  PRODUCT_OPS_PACK,
  SALES_OPS_PACK,
] as const;

export const FUTURE_TAX_PACK_REFERENCE = {
  id: "tax_automation",
  state: "external-engine-available",
  taxImplementation: "external-engine-v1",
} as const;

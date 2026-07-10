export type AgentWalletToolRisk =
  | "read"
  | "identity"
  | "wallet-mutation"
  | "external-payment"
  | "usdc-spend";

export type AgentWalletToolName =
  | "circle_login"
  | "circle_logout"
  | "fetch_setup_skill"
  | "fetch_sub_skill"
  | "circle_list_wallets"
  | "circle_create_wallet"
  | "circle_get_balance"
  | "circle_deploy_wallet"
  | "circle_wallet_fund"
  | "circle_fund_fiat"
  | "circle_get_gateway_balance"
  | "circle_search_services"
  | "circle_inspect_service"
  | "fetch_service"
  | "call_free_service"
  | "circle_pay_service"
  | "circle_gateway_deposit";

export type AgentWalletToolContract = {
  name: AgentWalletToolName;
  upstreamName: string;
  category: "auth" | "skill" | "wallet" | "service" | "gateway" | "payment";
  risk: AgentWalletToolRisk;
  approvalRequired: boolean;
  uiSurface: "setup" | "wallet" | "service" | "payment";
  description: string;
};

export type AgentWalletWorkflowStep = {
  id: string;
  title: string;
  tools: readonly AgentWalletToolName[];
  required: boolean;
  approvalBoundary?:
    | "before-wallet-mutation"
    | "before-external-payment"
    | "before-usdc-spend";
};

export type AgentWalletUiChecklistItem = {
  id: string;
  label: string;
  owner: "backend" | "ui" | "policy" | "dogfood";
  doneWhen: string;
};

export const CIRCLE_AGENT_WALLET_TOOLS = [
  {
    name: "circle_login",
    upstreamName: "circle_login",
    category: "auth",
    risk: "identity",
    approvalRequired: false,
    uiSurface: "setup",
    description:
      "Authenticate or confirm the active Circle agent-wallet CLI session without accepting Terms on the user's behalf.",
  },
  {
    name: "circle_logout",
    upstreamName: "circle_logout",
    category: "auth",
    risk: "identity",
    approvalRequired: true,
    uiSurface: "setup",
    description:
      "Clear the active Circle agent-wallet session; useful for account switching.",
  },
  {
    name: "fetch_setup_skill",
    upstreamName: "fetch_setup_skill",
    category: "skill",
    risk: "read",
    approvalRequired: false,
    uiSurface: "setup",
    description: "Fetch Circle Agent Stack setup instructions.",
  },
  {
    name: "fetch_sub_skill",
    upstreamName: "fetch_sub_skill",
    category: "skill",
    risk: "read",
    approvalRequired: false,
    uiSurface: "setup",
    description:
      "Fetch Circle sub-skills such as wallet-login, wallet-fund, wallet-pay, and discover-services.",
  },
  {
    name: "circle_list_wallets",
    upstreamName: "circle_list_wallets",
    category: "wallet",
    risk: "read",
    approvalRequired: false,
    uiSurface: "wallet",
    description: "List existing Circle agent wallets on Base.",
  },
  {
    name: "circle_create_wallet",
    upstreamName: "circle_create_wallet",
    category: "wallet",
    risk: "wallet-mutation",
    approvalRequired: true,
    uiSurface: "wallet",
    description:
      "Create a Circle agent-controlled wallet. Mutates account state and must be user-visible.",
  },
  {
    name: "circle_get_balance",
    upstreamName: "circle_get_balance",
    category: "wallet",
    risk: "read",
    approvalRequired: false,
    uiSurface: "wallet",
    description: "Check USDC and token balances for an agent wallet.",
  },
  {
    name: "circle_deploy_wallet",
    upstreamName: "circle_deploy_wallet",
    category: "wallet",
    risk: "wallet-mutation",
    approvalRequired: true,
    uiSurface: "wallet",
    description:
      "Deploy a counterfactual SCA agent wallet through the upstream zero-value self-transfer flow before x402 signing.",
  },
  {
    name: "circle_wallet_fund",
    upstreamName: "circle_wallet_fund",
    category: "wallet",
    risk: "wallet-mutation",
    approvalRequired: true,
    uiSurface: "wallet",
    description: "Fund an agent wallet through Circle's CLI funding path.",
  },
  {
    name: "circle_fund_fiat",
    upstreamName: "fundFiatTool",
    category: "wallet",
    risk: "external-payment",
    approvalRequired: true,
    uiSurface: "wallet",
    description:
      "Generate a fiat on-ramp URL; the user pays inside the provider flow.",
  },
  {
    name: "circle_get_gateway_balance",
    upstreamName: "circle_get_gateway_balance",
    category: "gateway",
    risk: "read",
    approvalRequired: false,
    uiSurface: "payment",
    description:
      "Read the wallet's Circle Gateway balance for batched x402 payments.",
  },
  {
    name: "circle_search_services",
    upstreamName: "circle_search_services",
    category: "service",
    risk: "read",
    approvalRequired: false,
    uiSurface: "service",
    description:
      "Discover x402-compatible services on the Circle Agent Marketplace.",
  },
  {
    name: "circle_inspect_service",
    upstreamName: "circle_inspect_service",
    category: "service",
    risk: "read",
    approvalRequired: false,
    uiSurface: "service",
    description:
      "Inspect pricing, method, schema, and payment options before a paid x402 service call.",
  },
  {
    name: "fetch_service",
    upstreamName: "fetch_service",
    category: "service",
    risk: "read",
    approvalRequired: false,
    uiSurface: "service",
    description:
      "Probe a free service endpoint first; return HTTP 402/paymentRequired when paid.",
  },
  {
    name: "call_free_service",
    upstreamName: "callFreeService",
    category: "service",
    risk: "read",
    approvalRequired: false,
    uiSurface: "service",
    description:
      "Mastra-compatible alias for free service calls; maps to the same no-payment service probe boundary.",
  },
  {
    name: "circle_pay_service",
    upstreamName: "circle_pay_service",
    category: "payment",
    risk: "usdc-spend",
    approvalRequired: true,
    uiSurface: "payment",
    description:
      "Pay for an x402 service with Circle USDC. Must pause for human approval immediately before spending.",
  },
  {
    name: "circle_gateway_deposit",
    upstreamName: "circle_gateway_deposit",
    category: "gateway",
    risk: "usdc-spend",
    approvalRequired: true,
    uiSurface: "payment",
    description:
      "Deposit USDC into Circle Gateway for seller-required batched x402 payments. Must pause for approval immediately before spending.",
  },
] as const satisfies readonly AgentWalletToolContract[];

export const CIRCLE_AGENT_WALLET_TOOL_NAMES = CIRCLE_AGENT_WALLET_TOOLS.map(
  (tool) => tool.name,
);

export const CIRCLE_AGENT_WALLET_WORKFLOW = [
  {
    id: "read-setup",
    title: "Read Circle setup instructions",
    tools: ["fetch_setup_skill"],
    required: true,
  },
  {
    id: "session",
    title: "Confirm or establish Circle agent-wallet session",
    tools: ["circle_login", "circle_logout"],
    required: true,
  },
  {
    id: "wallet",
    title:
      "List, create when missing, and deploy the agent wallet before paid x402 signing",
    tools: [
      "circle_list_wallets",
      "circle_create_wallet",
      "circle_deploy_wallet",
    ],
    required: true,
    approvalBoundary: "before-wallet-mutation",
  },
  {
    id: "balance",
    title: "Read wallet and Gateway balances",
    tools: ["circle_get_balance", "circle_get_gateway_balance"],
    required: true,
  },
  {
    id: "funding-guidance",
    title:
      "When USDC is zero, fetch wallet-fund guidance and offer explicit funding actions",
    tools: ["fetch_sub_skill", "circle_wallet_fund", "circle_fund_fiat"],
    required: true,
    approvalBoundary: "before-external-payment",
  },
  {
    id: "service-discovery",
    title: "Discover, probe, and inspect x402 services before payment",
    tools: [
      "fetch_sub_skill",
      "circle_search_services",
      "fetch_service",
      "call_free_service",
      "circle_inspect_service",
    ],
    required: true,
  },
  {
    id: "payment",
    title:
      "Pay only after inspection, deployment preflight, and human approval; deposit to Gateway only when required",
    tools: ["fetch_sub_skill", "circle_pay_service", "circle_gateway_deposit"],
    required: true,
    approvalBoundary: "before-usdc-spend",
  },
] as const satisfies readonly AgentWalletWorkflowStep[];

export const BUFI_AGENT_WALLET_UI_CHECKLIST = [
  {
    id: "tool-registry",
    label:
      "Render every Circle tool from CIRCLE_AGENT_WALLET_TOOLS, grouped by setup, wallet, service, and payment.",
    owner: "ui",
    doneWhen:
      "No Circle tool appears only in backend code; each has a visible status, risk label, and latest trace.",
  },
  {
    id: "approval-boundaries",
    label:
      "Block wallet mutations, fiat on-ramp, x402 pay, and Gateway deposit behind approval UI.",
    owner: "policy",
    doneWhen:
      "The UI shows destination, wallet, method, amount/data, network, estimated fee when available, and requires explicit approval.",
  },
  {
    id: "workflow-sequence",
    label:
      "Show the Mastra/Vercel sequence as a workflow timeline: setup → session → wallet → balance → funding guidance → service discovery → payment.",
    owner: "ui",
    doneWhen:
      "Users can tell exactly which step ran, which tool was called, and what is blocked next.",
  },
  {
    id: "trace-and-evidence",
    label:
      "Attach Eve traces to every Circle tool call and never expose raw secrets or OTPs.",
    owner: "backend",
    doneWhen:
      "Trace drawer shows sanitized tool args/results and hides OTP/API/session secret data.",
  },
  {
    id: "read-only-dogfood",
    label:
      "Dogfood read-only Circle status/list/balance/search before enabling any spend path.",
    owner: "dogfood",
    doneWhen:
      "A report proves session status, wallet list, balances, service search, and denied spend behavior.",
  },
] as const satisfies readonly AgentWalletUiChecklistItem[];

export function getAgentWalletTool(
  name: AgentWalletToolName,
): AgentWalletToolContract {
  const contract = CIRCLE_AGENT_WALLET_TOOLS.find((tool) => tool.name === name);
  if (!contract) throw new Error(`unknown Circle agent-wallet tool: ${name}`);
  return contract;
}

export function validateAgentWalletToolSet(names: readonly string[]): {
  missing: AgentWalletToolName[];
  unknown: string[];
} {
  const seen = new Set(names);
  const expected = new Set(CIRCLE_AGENT_WALLET_TOOL_NAMES);
  return {
    missing: CIRCLE_AGENT_WALLET_TOOL_NAMES.filter((name) => !seen.has(name)),
    unknown: names.filter((name) => !expected.has(name as AgentWalletToolName)),
  };
}

export function requiresHumanApproval(name: AgentWalletToolName): boolean {
  return getAgentWalletTool(name).approvalRequired;
}

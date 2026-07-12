import {
  parseOperatingPackManifest,
  type OperatingPackManifest,
} from "./manifest";

const walletTools = [
  "circle_login",
  "circle_logout",
  "fetch_setup_skill",
  "fetch_sub_skill",
  "circle_list_wallets",
  "circle_create_wallet",
  "circle_get_balance",
  "circle_deploy_wallet",
  "circle_wallet_fund",
  "circle_fund_fiat",
  "circle_get_gateway_balance",
  "circle_search_services",
  "circle_inspect_service",
  "fetch_service",
  "call_free_service",
  "circle_pay_service",
  "circle_gateway_deposit",
] as const;

const readTools = [
  "circle_login",
  "fetch_setup_skill",
  "fetch_sub_skill",
  "circle_list_wallets",
  "circle_get_balance",
  "circle_get_gateway_balance",
  "circle_search_services",
  "circle_inspect_service",
  "fetch_service",
  "call_free_service",
] as const;

const mutationTools = [
  "circle_logout",
  "circle_create_wallet",
  "circle_deploy_wallet",
  "circle_wallet_fund",
  "circle_fund_fiat",
  "circle_pay_service",
  "circle_gateway_deposit",
] as const;

export const AGENT_WALLET_PACK: OperatingPackManifest =
  parseOperatingPackManifest({
    schemaVersion: 1,
    id: "agent_wallet",
    name: "Agent Wallet",
    version: "1.0.0",
    owner: "BUFI",
    graphVersion: 1,
    personas: ["founder", "finance", "operator"],
    jurisdictions: ["global"],
    industries: ["remote-teams"],
    dependencies: [],
    permissions: ["data:read", "wallet:read", "wallet:spend"],
    ontology: {
      sharedKinds: [
        "Account",
        "KPI",
        "Document",
        "Approval",
        "Policy",
        "Agent",
      ],
      extensions: {
        wallet: ["chain", "address", "deployment_state"],
        service: ["endpoint", "payment_required", "schema_hash"],
      },
    },
    agents: [
      {
        id: "wallet_onboarding",
        role: "wallet_onboarding",
        tools: [
          "circle_login",
          "fetch_setup_skill",
          "fetch_sub_skill",
          "circle_list_wallets",
          "circle_get_balance",
          "circle_create_wallet",
          "circle_deploy_wallet",
          "circle_wallet_fund",
          "circle_fund_fiat",
        ],
      },
      {
        id: "service_discovery",
        role: "service_discovery",
        tools: [
          "circle_get_balance",
          "circle_get_gateway_balance",
          "circle_search_services",
          "circle_inspect_service",
          "fetch_service",
          "call_free_service",
        ],
      },
      {
        id: "wallet_operator",
        role: "wallet_operator",
        tools: [
          "circle_get_balance",
          "circle_inspect_service",
          "circle_deploy_wallet",
          "circle_pay_service",
          "circle_gateway_deposit",
        ],
      },
    ],
    workflows: [
      {
        id: "agent_wallet_onboarding",
        title: "Onboard an isolated Circle agent wallet",
        agentIds: ["wallet_onboarding"],
        requiredApproval: true,
        risk: "high",
        crossPack: false,
      },
      {
        id: "agent_wallet_service_discovery",
        title: "Discover and inspect x402 services",
        agentIds: ["service_discovery"],
        requiredApproval: false,
        risk: "low",
        crossPack: false,
      },
      {
        id: "agent_wallet_payment",
        title: "Approve and execute an x402 wallet payment",
        agentIds: ["service_discovery", "wallet_operator"],
        requiredApproval: true,
        risk: "high",
        crossPack: false,
      },
    ],
    connectors: [
      {
        id: "knowledge_graph",
        required: true,
        capabilities: ["knowledge.read"],
      },
      { id: "workflow_store", required: true, capabilities: ["workflow.run"] },
      {
        id: "circle_agent_wallet",
        required: true,
        capabilities: ["wallet.read", "wallet.spend", "service.discovery"],
      },
    ],
    toolGrants: [
      ...readTools.map((tool) => ({
        tool,
        operations: ["read"],
        approvalRequired: false,
      })),
      ...mutationTools.map((tool) => ({
        tool,
        operations: ["execute"],
        approvalRequired: true,
      })),
    ],
    kpis: [
      "wallet_balance",
      "gateway_balance",
      "service_discovery",
      "wallet_readiness",
    ],
    deskWidgets: [
      { id: "wallet_readiness", kind: "kpi" },
      { id: "wallet_workflow", kind: "workflow" },
      { id: "wallet_approval", kind: "approval" },
      { id: "wallet_trace", kind: "trace" },
      { id: "wallet_console", kind: "console" },
    ],
    expoCards: [
      { id: "wallet_brief", kind: "brief" },
      { id: "wallet_approval", kind: "approval" },
      { id: "wallet_workflow", kind: "workflow" },
    ],
    traceViews: ["workflow", "tool", "approval", "wallet", "service"],
    setupChecklist: [
      "Read the Circle Agent Stack setup skill",
      "Confirm the isolated wallet and chain",
      "Review wallet mutation and USDC spend approval boundaries",
      "Inspect a service before authorizing any payment",
    ],
  });

export const AGENT_WALLET_TOOL_NAMES = walletTools;

import { describe, expect, test } from "bun:test";
import {
  BUFI_AGENT_WALLET_UI_CHECKLIST,
  CIRCLE_AGENT_WALLET_TOOLS,
  CIRCLE_AGENT_WALLET_TOOL_NAMES,
  CIRCLE_AGENT_WALLET_WORKFLOW,
  requiresHumanApproval,
  validateAgentWalletToolSet,
} from "./index";

describe("Circle agent-wallet tool contract", () => {
  test("matches the Vercel AI and Mastra Circle tool surface", () => {
    const expected = [
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
    ];
    expect(validateAgentWalletToolSet(expected)).toEqual({
      missing: [],
      unknown: [],
    });
  });

  test("requires approval for wallet mutation and USDC movement tools", () => {
    for (const name of [
      "circle_create_wallet",
      "circle_deploy_wallet",
      "circle_wallet_fund",
      "circle_fund_fiat",
      "circle_pay_service",
      "circle_gateway_deposit",
    ] as const) {
      expect(requiresHumanApproval(name)).toBe(true);
    }
    for (const name of [
      "fetch_setup_skill",
      "circle_list_wallets",
      "circle_get_balance",
      "circle_search_services",
      "circle_inspect_service",
      "fetch_service",
    ] as const) {
      expect(requiresHumanApproval(name)).toBe(false);
    }
  });

  test("preserves the onboarding and payment workflow sequence", () => {
    expect(CIRCLE_AGENT_WALLET_WORKFLOW.map((step) => step.id)).toEqual([
      "read-setup",
      "session",
      "wallet",
      "balance",
      "funding-guidance",
      "service-discovery",
      "payment",
    ]);
    expect(CIRCLE_AGENT_WALLET_WORKFLOW.at(-1)?.tools).toContain(
      "circle_pay_service",
    );
    expect(CIRCLE_AGENT_WALLET_WORKFLOW.at(-1)?.tools).toContain(
      "circle_gateway_deposit",
    );
  });

  test("has UI guidance for every risky boundary", () => {
    expect(BUFI_AGENT_WALLET_UI_CHECKLIST.map((item) => item.id)).toContain(
      "approval-boundaries",
    );
    expect(
      CIRCLE_AGENT_WALLET_TOOLS.filter(
        (tool) => tool.risk === "usdc-spend",
      ).every((tool) => tool.approvalRequired),
    ).toBe(true);
    expect(CIRCLE_AGENT_WALLET_TOOL_NAMES).toContain("circle_deploy_wallet");
  });
});

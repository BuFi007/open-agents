import { describe, expect, test } from "bun:test";
import {
  AGENT_WALLET_PACK,
  AGENT_WALLET_TOOL_NAMES,
} from "./agent-wallet-pack";

describe("Agent Wallet operating pack", () => {
  test("declares the complete Circle tool surface and approval boundaries", () => {
    expect(AGENT_WALLET_PACK.toolGrants).toHaveLength(
      AGENT_WALLET_TOOL_NAMES.length,
    );
    expect(
      AGENT_WALLET_PACK.toolGrants
        .filter((grant) => grant.approvalRequired)
        .map((grant) => grant.tool),
    ).toEqual([
      "circle_logout",
      "circle_create_wallet",
      "circle_deploy_wallet",
      "circle_wallet_fund",
      "circle_fund_fiat",
      "circle_pay_service",
      "circle_gateway_deposit",
    ]);
  });

  test("keeps onboarding, discovery, and payment as separate durable workflows", () => {
    expect(AGENT_WALLET_PACK.workflows.map((workflow) => workflow.id)).toEqual([
      "agent_wallet_onboarding",
      "agent_wallet_service_discovery",
      "agent_wallet_payment",
    ]);
    expect(AGENT_WALLET_PACK.workflows[1]?.requiredApproval).toBe(false);
    expect(AGENT_WALLET_PACK.workflows[2]?.requiredApproval).toBe(true);
  });
});

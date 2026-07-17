import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  isSafeTaxAuthorityApprovalReceiptEnvelope,
  matchesExpectedTaxAuthorityApprovalReceipt,
  TaxAuthorityApprovalForm,
} from "./tax-authority-approval-form";

describe("TaxAuthorityApprovalForm", () => {
  test("renders an exact-intent approval without browser signing material", () => {
    const markup = renderToStaticMarkup(
      <TaxAuthorityApprovalForm
        initialWorkspaceId="11111111-1111-4111-8111-111111111111"
        initialExecutionId="22222222-2222-4222-8222-222222222222"
        initialIntentHash={"a".repeat(64)}
      />,
    );
    expect(markup).toContain("Review frozen Factura E intent");
    expect(markup).toContain("Frozen intent SHA-256");
    expect(markup).toContain("tax.invoice.authority.approve");
    expect(markup).toContain('type="password"');
    expect(markup).toContain("Motora performs the separately gated execution");
    expect(markup).not.toMatch(
      /TAX_ENGINE_OPEN_AGENTS_APPROVAL_PRINCIPAL_HMAC_SECRET|OPEN_AGENTS_TAX_APPROVAL_REF_HMAC_SECRET/,
    );
  });

  test("accepts only the exact safe receipt returned by the server", () => {
    const receipt = {
      data: {
        version: "oa-factura-e-authority-approval-receipt-v1",
        executionId: "22222222-2222-4222-8222-222222222222",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        intentHash: "a".repeat(64),
        status: "registered",
        replayed: false,
        nextStep: "request_execution_from_motora",
      },
    };
    expect(isSafeTaxAuthorityApprovalReceiptEnvelope(receipt)).toBe(true);
    expect(
      isSafeTaxAuthorityApprovalReceiptEnvelope({
        data: { ...receipt.data, approvalRef: "must-not-enter-browser" },
      }),
    ).toBe(false);
    expect(
      isSafeTaxAuthorityApprovalReceiptEnvelope({
        data: { ...receipt.data, intentHash: "wrong" },
      }),
    ).toBe(false);
    expect(
      matchesExpectedTaxAuthorityApprovalReceipt(receipt, {
        executionId: receipt.data.executionId,
        workspaceId: receipt.data.workspaceId,
        intentHash: receipt.data.intentHash,
      }),
    ).toBe(true);
    expect(
      matchesExpectedTaxAuthorityApprovalReceipt(
        {
          data: { ...receipt.data, intentHash: "b".repeat(64) },
        },
        {
          executionId: receipt.data.executionId,
          workspaceId: receipt.data.workspaceId,
          intentHash: receipt.data.intentHash,
        },
      ),
    ).toBe(false);
  });
});

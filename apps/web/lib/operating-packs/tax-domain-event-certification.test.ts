import { describe, expect, test } from "bun:test";

import {
  taxDomainEventCertificationEnabled,
  taxDomainEventCertificationRefs,
} from "./tax-domain-event-certification";

describe("tax domain event certification isolation", () => {
  test("derives stable synthetic references without accepting arbitrary tenant data", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const first = taxDomainEventCertificationRefs(id);
    expect(taxDomainEventCertificationRefs(id)).toEqual(first);
    expect(first.workspaceRef).toBe(id);
    expect(first.caseRef).toMatch(/^taxcase_e2e_[a-f0-9]{40}$/);
    expect(JSON.stringify(first)).not.toMatch(/cuit|amount|recipient|wallet/i);
    expect(() => taxDomainEventCertificationRefs("workspace_live_1")).toThrow();
  });

  test("cannot be enabled on a production deployment", () => {
    process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_CERTIFICATION_ENABLED = "true";
    process.env.VERCEL_ENV = "production";
    expect(taxDomainEventCertificationEnabled()).toBe(false);
    process.env.VERCEL_ENV = "preview";
    expect(taxDomainEventCertificationEnabled()).toBe(true);
    delete process.env.VERCEL_ENV;
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(taxDomainEventCertificationEnabled()).toBe(false);
  });
});

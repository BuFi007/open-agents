import { describe, expect, it } from "bun:test";
import {
  buildGrantOntology,
  publishOntology,
  validateOntologyDraft,
} from "./index";

describe("workspace ontology registry", () => {
  it("generates contracts for the Grant vertical slice", () => {
    const grant = buildGrantOntology("ws_1", "admin_1");
    const generated = publishOntology(grant);
    expect(generated.entityType).toBe("workspace.Grant.v1");
    expect(generated.connectorMappingTarget).toBe(
      "ontology:workspace.Grant.v1",
    );
    expect(generated.deskComponents).toContain("table");
    expect(generated.expoComponents).toEqual(["compact-card"]);
    expect(generated.agentTools).toEqual([
      "workspace_Grant_propose",
      "workspace_Grant_update",
    ]);
    expect(generated.jsonSchema.required as string[]).toContain("amount");
  });

  it("prevents custom schemas from redefining BUFI core primitives", () => {
    expect(() =>
      validateOntologyDraft({
        ...buildGrantOntology("ws_1", "admin_1"),
        namespace: "bufi",
      }),
    ).toThrow("core primitives");
    expect(() =>
      validateOntologyDraft({
        ...buildGrantOntology("ws_1", "admin_1"),
        typeName: "Wallet",
      }),
    ).toThrow("core primitives");
    expect(() =>
      validateOntologyDraft({
        ...buildGrantOntology("ws_1", "admin_1"),
        typeName: "wallet",
      }),
    ).toThrow("core primitives");
  });

  it("validates enums, duplicate fields, and display primary field", () => {
    const grant = buildGrantOntology("ws_1", "admin_1");
    expect(() =>
      validateOntologyDraft({
        ...grant,
        fields: [...grant.fields, grant.fields[0]!],
      }),
    ).toThrow("duplicate");
    expect(() =>
      validateOntologyDraft({
        ...grant,
        display: { label: "Grant", primaryField: "missing" },
      }),
    ).toThrow("primaryField");
    expect(() =>
      validateOntologyDraft({
        ...grant,
        fields: grant.fields.map((field) =>
          field.name === "status"
            ? { ...field, enumValues: ["bad value"] }
            : field,
        ),
      }),
    ).toThrow("enum");
  });
});

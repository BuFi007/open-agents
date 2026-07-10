export type OntologyField = {
  name: string;
  type:
    | "string"
    | "number"
    | "integer"
    | "money"
    | "date"
    | "enum"
    | "entity-ref";
  required?: boolean;
  enumValues?: readonly string[];
  sensitivity: "public" | "internal" | "financial" | "restricted";
};

export type OntologyRelation = {
  name: string;
  targetType: string;
  cardinality: "one" | "many";
  required?: boolean;
};

export type OntologyDefinition = {
  workspaceId: string;
  namespace: string;
  typeName: string;
  version: number;
  status: "draft" | "published" | "deprecated";
  ownerId: string;
  fields: readonly OntologyField[];
  relations: readonly OntologyRelation[];
  approvalPolicy: "auto" | "review" | "sensitive";
  display: { label: string; icon?: string; primaryField: string };
};

export type OntologyGeneratedContracts = {
  entityType: string;
  jsonSchema: Readonly<Record<string, unknown>>;
  connectorMappingTarget: string;
  contextPacketKind: "entity";
  deskComponents: readonly ("form" | "card" | "table" | "graph-facet")[];
  expoComponents: readonly "compact-card"[];
  agentTools: readonly string[];
  eveTraceLabel: string;
};

const ID = /^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/;
const RESERVED = new Set([
  "money",
  "wallet",
  "approval",
  "tenant",
  "evidence",
  "audit",
  "invoice",
  "bill",
  "payment",
  "tax",
  "account",
  "transaction",
  "sourceartifact",
]);

function requireName(name: string, value: string): void {
  if (!ID.test(value)) throw new Error(`invalid ontology ${name}`);
}

export function validateOntologyDraft(
  definition: OntologyDefinition,
): OntologyDefinition {
  requireName("namespace", definition.namespace);
  requireName("typeName", definition.typeName);
  requireName("ownerId", definition.ownerId);
  if (!definition.workspaceId || !definition.workspaceId.startsWith("ws_"))
    throw new Error("invalid ontology workspace");
  if (!Number.isInteger(definition.version) || definition.version < 1)
    throw new Error("ontology version must be positive");
  if (
    RESERVED.has(definition.typeName.toLowerCase()) ||
    definition.namespace.toLowerCase() === "bufi"
  )
    throw new Error("custom ontology cannot redefine BUFI core primitives");
  if (!definition.fields.length) throw new Error("ontology requires fields");
  const fieldNames = new Set<string>();
  for (const field of definition.fields) {
    requireName("field", field.name);
    if (fieldNames.has(field.name))
      throw new Error(`duplicate ontology field: ${field.name}`);
    fieldNames.add(field.name);
    if (
      field.type === "enum" &&
      (!field.enumValues?.length ||
        field.enumValues.some((value) => !ID.test(value)))
    )
      throw new Error(`invalid enum values for field: ${field.name}`);
    if (field.type !== "enum" && field.enumValues?.length)
      throw new Error(`enum values only allowed on enum fields: ${field.name}`);
  }
  for (const relation of definition.relations) {
    requireName("relation", relation.name);
    requireName("relation targetType", relation.targetType);
  }
  if (!fieldNames.has(definition.display.primaryField))
    throw new Error("display primaryField must exist");
  return {
    ...definition,
    fields: definition.fields.map((field) => ({
      ...field,
      enumValues: field.enumValues ? [...field.enumValues] : undefined,
    })),
    relations: definition.relations.map((relation) => ({ ...relation })),
  };
}

export function publishOntology(
  definition: OntologyDefinition,
): OntologyGeneratedContracts {
  const valid = validateOntologyDraft({ ...definition, status: "published" });
  const entityType = `${valid.namespace}.${valid.typeName}.v${valid.version}`;
  const properties = Object.fromEntries(
    valid.fields.map((field) => [
      field.name,
      field.type === "money"
        ? { type: "object", required: ["amountMinor", "currency"] }
        : field.type === "entity-ref"
          ? { type: "string" }
          : {
              type:
                field.type === "integer"
                  ? "integer"
                  : field.type === "number"
                    ? "number"
                    : "string",
              enum: field.enumValues,
            },
    ]),
  );
  return {
    entityType,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: valid.fields
        .filter((field) => field.required)
        .map((field) => field.name),
      properties,
    },
    connectorMappingTarget: `ontology:${entityType}`,
    contextPacketKind: "entity",
    deskComponents: ["form", "card", "table", "graph-facet"],
    expoComponents: ["compact-card"],
    agentTools: [
      `${valid.namespace}_${valid.typeName}_propose`,
      `${valid.namespace}_${valid.typeName}_update`,
    ],
    eveTraceLabel: `ontology.${entityType}`,
  };
}

export function buildGrantOntology(
  workspaceId: string,
  ownerId: string,
  namespace = "workspace",
): OntologyDefinition {
  return {
    workspaceId,
    namespace,
    typeName: "Grant",
    version: 1,
    status: "draft",
    ownerId,
    approvalPolicy: "review",
    display: { label: "Grant", primaryField: "name" },
    fields: [
      { name: "name", type: "string", required: true, sensitivity: "internal" },
      {
        name: "amount",
        type: "money",
        required: true,
        sensitivity: "financial",
      },
      {
        name: "currency",
        type: "string",
        required: true,
        sensitivity: "financial",
      },
      {
        name: "funder",
        type: "entity-ref",
        required: true,
        sensitivity: "internal",
      },
      {
        name: "deadline",
        type: "date",
        required: true,
        sensitivity: "internal",
      },
      {
        name: "status",
        type: "enum",
        required: true,
        enumValues: ["draft", "submitted", "won", "lost"],
        sensitivity: "internal",
      },
    ],
    relations: [
      {
        name: "fundedBy",
        targetType: "Organization",
        cardinality: "one",
        required: true,
      },
      { name: "supports", targetType: "Project", cardinality: "many" },
    ],
  };
}

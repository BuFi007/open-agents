import { z } from "zod";

export const TaxSetupWorkspaceIdSchema = z.string().uuid();
export const TaxSetupProjectionKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
export const TaxSetupJurisdictionSchema = z.enum(["AR", "US"]);
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const answerValueSchema = z.union([
  z.string().max(300),
  z.boolean(),
  z.number().int().safe(),
  z.array(z.string().max(300)).max(100),
]);

export const TaxSetupCatalogueSchema = z
  .object({
    jurisdiction: TaxSetupJurisdictionSchema,
    version: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    questions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            label: z.string().min(1).max(500),
            kind: z.enum([
              "enum",
              "country",
              "subdivision",
              "multi_select",
              "boolean",
              "integer",
            ]),
            required: z.boolean(),
            options: z
              .array(
                z
                  .object({
                    value: z.string().min(1).max(300),
                    label: z.string().min(1).max(500),
                  })
                  .strict(),
              )
              .max(100)
              .optional(),
          })
          .strict(),
      )
      .max(100),
    regimes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            entityTypes: z.array(z.string().min(1).max(100)).min(1).max(20),
            label: z.string().min(1).max(500),
            description: z.string().min(1).max(2_000),
            requiredQuestions: z.array(z.string().min(1).max(200)).max(100),
            ruleVersionIds: z.array(z.string().min(1).max(300)).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    rules: z
      .array(
        z
          .object({
            id: z.string().min(1).max(300),
            jurisdiction: TaxSetupJurisdictionSchema,
            effectiveFrom: z.iso.date(),
            effectiveTo: z.iso.date().nullable(),
            sourceUrl: z.url().max(2_048),
            title: z.string().min(1).max(500),
            reviewedByAccountant: z.boolean(),
            version: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const TaxSetupProfileSchema = z
  .object({
    profileId: z.string().min(1).max(300),
    workspaceId: TaxSetupWorkspaceIdSchema,
    jurisdiction: TaxSetupJurisdictionSchema,
    entityType: z.string().min(1).max(100),
    regimeId: z.string().min(1).max(200),
    ownerDomicileCountries: z.array(countryCodeSchema).max(50),
    ownerTaxResidenceCountries: z.array(countryCodeSchema).max(50),
    formationSubdivision: z.string().min(1).max(100).nullable(),
    operatingSubdivisions: z.array(z.string().min(1).max(100)).max(100),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().min(1).max(200),
            value: answerValueSchema,
            confirmationState: z.enum([
              "user_confirmed",
              "accountant_confirmed",
            ]),
          })
          .strict(),
      )
      .max(100),
    catalogueVersion: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    confirmationState: z.enum(["user_confirmed", "accountant_confirmed"]),
  })
  .strict();

export const TaxSetupDataScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all_connected") }).strict(),
  z
    .object({
      mode: z.literal("selected"),
      sourceIds: z.array(z.string().min(1).max(300)).min(1).max(200),
      includeKnowledgeGraph: z.boolean(),
    })
    .strict(),
]);

export const TaxSetupConfigurationReceiptSchema = z
  .object({
    configuration: z
      .object({
        version: z.literal("tax-snapshot-projection-configuration-v1"),
        workspaceId: TaxSetupWorkspaceIdSchema,
        period: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
        displayCurrency: z.string().regex(/^[A-Z]{3}$/),
        dataScope: TaxSetupDataScopeSchema,
      })
      .strict(),
    projectionKey: TaxSetupProjectionKeySchema,
    configHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const setupBaseSchema = z.object({
  workspaceId: TaxSetupWorkspaceIdSchema,
  actorId: z.string().uuid(),
});

export const TaxSetupOperationRequestSchema = z.discriminatedUnion(
  "operation",
  [
    setupBaseSchema.extend({ operation: z.literal("catalogues") }).strict(),
    setupBaseSchema.extend({ operation: z.literal("profile_read") }).strict(),
    setupBaseSchema
      .extend({
        operation: z.literal("configuration_read"),
        projectionKey: TaxSetupProjectionKeySchema,
      })
      .strict(),
    setupBaseSchema
      .extend({
        operation: z.literal("profile_confirm"),
        expectedVersion: z.string().min(1).max(100).nullable(),
        profile: TaxSetupProfileSchema,
      })
      .strict(),
    setupBaseSchema
      .extend({
        operation: z.literal("configuration_put"),
        projectionKey: TaxSetupProjectionKeySchema,
        expectedConfigHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        period: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
        displayCurrency: z.string().regex(/^[A-Z]{3}$/),
        dataScope: TaxSetupDataScopeSchema,
      })
      .strict(),
  ],
);

const setupResultBaseSchema = z.object({
  version: z.literal("tax-setup-operation-result-v1"),
  workspaceId: TaxSetupWorkspaceIdSchema,
});

export const TaxSetupOperationResultSchema = z.discriminatedUnion("operation", [
  setupResultBaseSchema
    .extend({
      operation: z.literal("catalogues"),
      catalogues: z.array(TaxSetupCatalogueSchema),
    })
    .strict(),
  setupResultBaseSchema
    .extend({
      operation: z.literal("profile_read"),
      profile: TaxSetupProfileSchema.nullable(),
    })
    .strict(),
  setupResultBaseSchema
    .extend({
      operation: z.literal("configuration_read"),
      configuration: TaxSetupConfigurationReceiptSchema.nullable(),
    })
    .strict(),
  setupResultBaseSchema
    .extend({
      operation: z.literal("profile_confirm"),
      profile: TaxSetupProfileSchema,
    })
    .strict(),
  setupResultBaseSchema
    .extend({
      operation: z.literal("configuration_put"),
      configuration: TaxSetupConfigurationReceiptSchema,
      replayed: z.boolean(),
    })
    .strict(),
]);

export type TaxSetupOperationRequest = z.infer<
  typeof TaxSetupOperationRequestSchema
>;
export type TaxSetupOperationResult = z.infer<
  typeof TaxSetupOperationResultSchema
>;
export type TaxSetupProfile = z.infer<typeof TaxSetupProfileSchema>;
export type TaxSetupConfigurationReceipt = z.infer<
  typeof TaxSetupConfigurationReceiptSchema
>;

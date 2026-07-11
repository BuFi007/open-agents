export type ExpoWorkflowStatus = "active" | "blocked" | "completed" | "failed";

export type ExpoWorkflowStatusCard = {
  workflowId: string;
  runId: string;
  title: string;
  status: ExpoWorkflowStatus;
  summary: string;
  pendingApprovals: number;
  traceSummary: readonly string[];
  deepLinks: readonly {
    kind: "workflow" | "agent" | "entity" | "wallet-intent";
    targetId: string;
    href: string;
  }[];
};

/** Structural input contract so the publishable mobile adapter has no private runtime dependency. */
export type ExpoWorkflowInbox = {
  workspaceId: string;
  conversationContext: {
    teamId: string;
    harnessId: string;
    entityWatermark: string;
  };
  cards: readonly ExpoWorkflowStatusCard[];
  approvals: readonly {
    approvalId: string;
    actions: readonly ("approve" | "reject" | "edit")[];
    deepLink: string;
  }[];
  notifications: readonly {
    id: string;
    title: string;
    status: ExpoWorkflowStatus;
  }[];
  agentWallet: {
    availableTools: number;
    approvalRequired: number;
    workflowSteps: number;
  };
};

export const EXPO_ADAPTER_SCHEMA_VERSION =
  "open-agents.expo-adapter.v1" as const;
export const EXPO_APPROVAL_INTENT_SCHEMA_VERSION =
  "open-agents.expo-approval-intent.v1" as const;

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_TEXT_LENGTH = 2048;
const MAX_COLLECTION_LENGTH = 200;
const MAX_CHANGES = 20;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CHANGE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const FORBIDDEN_CHANGE_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export type ExpoAdapterScope = {
  workspaceId: string;
  teamId: string;
};

export type ExpoDeepLinkKind =
  | "workflow"
  | "agent"
  | "entity"
  | "wallet-intent"
  | "approval";

export type ExpoDeepLink = {
  workspaceId: string;
  kind: ExpoDeepLinkKind;
  targetId: string;
  href: string;
};

export type ExpoApprovalAction = "approve" | "reject" | "edit";
export type ExpoJsonPrimitive = string | number | boolean | null;

export type CleoExpoAdapterCard = {
  workflowId: string;
  runId: string;
  title: string;
  status: ExpoWorkflowStatusCard["status"];
  summary: string;
  pendingApprovals: number;
  traceSummary: readonly string[];
  deepLinks: readonly ExpoDeepLink[];
};

export type CleoExpoAdapterApproval = {
  approvalId: string;
  actions: readonly ExpoApprovalAction[];
  deepLink: ExpoDeepLink;
};

export type CleoExpoAdapterNotification = {
  id: string;
  title: string;
  status: ExpoWorkflowStatusCard["status"];
};

export type CleoExpoAdapter = {
  schemaVersion: typeof EXPO_ADAPTER_SCHEMA_VERSION;
  workspaceId: string;
  teamId: string;
  conversationContext: {
    harnessId: string;
    entityWatermark: string;
  };
  cards: readonly CleoExpoAdapterCard[];
  approvals: readonly CleoExpoAdapterApproval[];
  notifications: readonly CleoExpoAdapterNotification[];
  agentWallet: {
    availableTools: number;
    approvalRequired: number;
    workflowSteps: number;
  };
};

export type ExpoApprovalIntentRequest = {
  requestId: string;
  actorId: string;
  href: string;
  action: ExpoApprovalAction;
  reason?: string;
  changes?: Readonly<Record<string, ExpoJsonPrimitive>>;
};

export type ExpoApprovalIntent = {
  schemaVersion: typeof EXPO_APPROVAL_INTENT_SCHEMA_VERSION;
  kind: "approval-intent";
  requestId: string;
  workspaceId: string;
  teamId: string;
  harnessId: string;
  actorId: string;
  approvalId: string;
  action: ExpoApprovalAction;
  expectedApprovalState: "pending";
  requiresServerAuthorization: true;
  sourceDeepLink: string;
  reason?: string;
  changes?: Readonly<Record<string, ExpoJsonPrimitive>>;
};

export type ExpoAdapterErrorCode =
  | "invalid_input"
  | "scope_mismatch"
  | "invalid_deep_link"
  | "approval_not_found"
  | "action_not_allowed";

export type ExpoAdapterError = {
  code: ExpoAdapterErrorCode;
  path: string;
  message: string;
};

export type ExpoAdapterResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExpoAdapterError };

type UnknownRecord = Record<string, unknown>;

const STATUS_VALUES = new Set<ExpoWorkflowStatusCard["status"]>([
  "active",
  "blocked",
  "completed",
  "failed",
]);
const APPROVAL_ACTIONS = new Set<ExpoApprovalAction>([
  "approve",
  "reject",
  "edit",
]);
const ADAPTER_ROUTES = new Set<ExpoDeepLinkKind>([
  "workflow",
  "agent",
  "entity",
  "wallet-intent",
  "approval",
]);
const LEGACY_ROUTE_KIND: Readonly<Record<string, ExpoDeepLinkKind>> = {
  workflow: "workflow",
  agent: "agent",
  "entity-graph": "entity",
  "wallet-intent": "wallet-intent",
  approval: "approval",
};

function success<T>(value: T): ExpoAdapterResult<T> {
  return { ok: true, value };
}

function failure<T>(
  code: ExpoAdapterErrorCode,
  path: string,
  message: string,
): ExpoAdapterResult<T> {
  return { ok: false, error: { code, path, message } };
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function hasDisallowedControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 8 ||
      (code >= 11 && code <= 12) ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

function isText(value: unknown, maxLength = MAX_TEXT_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !hasDisallowedControlCharacter(value)
  );
}

function isBoundedCount(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= 1_000_000
  );
}

function isStatus(value: unknown): value is ExpoWorkflowStatusCard["status"] {
  return (
    typeof value === "string" &&
    STATUS_VALUES.has(value as ExpoWorkflowStatusCard["status"])
  );
}

function isApprovalAction(value: unknown): value is ExpoApprovalAction {
  return (
    typeof value === "string" &&
    APPROVAL_ACTIONS.has(value as ExpoApprovalAction)
  );
}

function validateScope(scope: unknown): ExpoAdapterResult<ExpoAdapterScope> {
  if (
    !isRecord(scope) ||
    !hasOnlyKeys(scope, ["workspaceId", "teamId"]) ||
    !isIdentifier(scope.workspaceId) ||
    !isIdentifier(scope.teamId)
  ) {
    return failure(
      "invalid_input",
      "scope",
      "A valid workspace and team scope is required.",
    );
  }
  return success({ workspaceId: scope.workspaceId, teamId: scope.teamId });
}

function decodeCanonicalIdentifier(raw: string): string | undefined {
  if (raw.length === 0 || raw.length > MAX_IDENTIFIER_LENGTH * 3) {
    return undefined;
  }
  try {
    const decoded = decodeURIComponent(raw);
    if (encodeURIComponent(decoded) !== raw || !isIdentifier(decoded)) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

function buildDeepLink(
  workspaceId: string,
  kind: ExpoDeepLinkKind,
  targetId: string,
): ExpoDeepLink {
  return {
    workspaceId,
    kind,
    targetId,
    href: `bufi://workspace/${encodeURIComponent(workspaceId)}/${kind}/${encodeURIComponent(targetId)}`,
  };
}

function parseLegacyDeepLink(
  href: unknown,
): ExpoAdapterResult<{ kind: ExpoDeepLinkKind; targetId: string }> {
  if (
    typeof href !== "string" ||
    href.length > 512 ||
    !href.startsWith("bufi://") ||
    href.includes("?") ||
    href.includes("#")
  ) {
    return failure(
      "invalid_deep_link",
      "deepLink",
      "The inbox deep link is malformed.",
    );
  }
  const segments = href.slice("bufi://".length).split("/");
  if (segments.length !== 2) {
    return failure(
      "invalid_deep_link",
      "deepLink",
      "The inbox deep link must contain exactly one route and target.",
    );
  }
  const route = segments[0];
  const targetId = decodeCanonicalIdentifier(segments[1] ?? "");
  const kind = route ? LEGACY_ROUTE_KIND[route] : undefined;
  if (!kind || !targetId) {
    return failure(
      "invalid_deep_link",
      "deepLink",
      "The inbox deep link route or target is invalid.",
    );
  }
  return success({ kind, targetId });
}

export function parseExpoDeepLink(
  href: unknown,
  expectedWorkspaceId: unknown,
): ExpoAdapterResult<ExpoDeepLink> {
  if (!isIdentifier(expectedWorkspaceId)) {
    return failure(
      "invalid_input",
      "expectedWorkspaceId",
      "A valid expected workspace is required.",
    );
  }
  if (
    typeof href !== "string" ||
    href.length > 640 ||
    !href.startsWith("bufi://workspace/") ||
    href.includes("?") ||
    href.includes("#")
  ) {
    return failure(
      "invalid_deep_link",
      "href",
      "The deep link is malformed or is not workspace-bound.",
    );
  }
  const segments = href.slice("bufi://workspace/".length).split("/");
  if (segments.length !== 3) {
    return failure(
      "invalid_deep_link",
      "href",
      "The deep link must contain exactly one workspace, route, and target.",
    );
  }
  const workspaceId = decodeCanonicalIdentifier(segments[0] ?? "");
  const route = segments[1];
  const targetId = decodeCanonicalIdentifier(segments[2] ?? "");
  if (
    !workspaceId ||
    !route ||
    !ADAPTER_ROUTES.has(route as ExpoDeepLinkKind) ||
    !targetId
  ) {
    return failure(
      "invalid_deep_link",
      "href",
      "The deep link workspace, route, or target is invalid.",
    );
  }
  if (workspaceId !== expectedWorkspaceId) {
    return failure(
      "scope_mismatch",
      "href.workspaceId",
      "The deep link does not belong to the active workspace.",
    );
  }
  const kind = route as ExpoDeepLinkKind;
  return success({ workspaceId, kind, targetId, href });
}

function adaptCard(
  value: unknown,
  workspaceId: string,
  index: number,
): ExpoAdapterResult<CleoExpoAdapterCard> {
  const path = `inbox.cards[${index}]`;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "workflowId",
      "runId",
      "title",
      "status",
      "summary",
      "pendingApprovals",
      "traceSummary",
      "deepLinks",
    ]) ||
    !isIdentifier(value.workflowId) ||
    !isIdentifier(value.runId) ||
    !isText(value.title) ||
    !isStatus(value.status) ||
    !isText(value.summary) ||
    !isBoundedCount(value.pendingApprovals) ||
    !Array.isArray(value.traceSummary) ||
    value.traceSummary.length > MAX_COLLECTION_LENGTH ||
    !value.traceSummary.every((item) => isText(item, 512)) ||
    !Array.isArray(value.deepLinks) ||
    value.deepLinks.length > MAX_COLLECTION_LENGTH
  ) {
    return failure("invalid_input", path, "The workflow card is malformed.");
  }

  const deepLinks: ExpoDeepLink[] = [];
  const seen = new Set<string>();
  for (const [deepLinkIndex, deepLink] of value.deepLinks.entries()) {
    if (
      !isRecord(deepLink) ||
      !hasOnlyKeys(deepLink, ["kind", "targetId", "href"]) ||
      typeof deepLink.kind !== "string" ||
      !ADAPTER_ROUTES.has(deepLink.kind as ExpoDeepLinkKind) ||
      !isIdentifier(deepLink.targetId)
    ) {
      return failure(
        "invalid_deep_link",
        `${path}.deepLinks[${deepLinkIndex}]`,
        "The workflow card contains an invalid deep link.",
      );
    }
    const parsed = parseLegacyDeepLink(deepLink.href);
    if (
      !parsed.ok ||
      parsed.value.kind !== deepLink.kind ||
      parsed.value.targetId !== deepLink.targetId
    ) {
      return failure(
        "invalid_deep_link",
        `${path}.deepLinks[${deepLinkIndex}]`,
        "The workflow card deep link does not match its declared target.",
      );
    }
    const normalized = buildDeepLink(
      workspaceId,
      deepLink.kind as ExpoDeepLinkKind,
      deepLink.targetId,
    );
    if (seen.has(normalized.href)) {
      return failure(
        "invalid_deep_link",
        `${path}.deepLinks[${deepLinkIndex}]`,
        "Duplicate workflow deep links are not allowed.",
      );
    }
    seen.add(normalized.href);
    deepLinks.push(normalized);
  }

  if (
    !deepLinks.some(
      (deepLink) =>
        deepLink.kind === "workflow" && deepLink.targetId === value.runId,
    )
  ) {
    return failure(
      "invalid_deep_link",
      `${path}.deepLinks`,
      "The workflow card is missing its run deep link.",
    );
  }

  return success({
    workflowId: value.workflowId,
    runId: value.runId,
    title: value.title,
    status: value.status,
    summary: value.summary,
    pendingApprovals: value.pendingApprovals,
    traceSummary: [...value.traceSummary] as string[],
    deepLinks,
  });
}

function adaptApproval(
  value: unknown,
  workspaceId: string,
  index: number,
): ExpoAdapterResult<CleoExpoAdapterApproval> {
  const path = `inbox.approvals[${index}]`;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["approvalId", "actions", "deepLink"]) ||
    !isIdentifier(value.approvalId) ||
    !Array.isArray(value.actions) ||
    value.actions.length === 0 ||
    value.actions.length > APPROVAL_ACTIONS.size ||
    !value.actions.every(isApprovalAction) ||
    new Set(value.actions).size !== value.actions.length
  ) {
    return failure("invalid_input", path, "The approval action is malformed.");
  }
  const parsed = parseLegacyDeepLink(value.deepLink);
  if (
    !parsed.ok ||
    parsed.value.kind !== "approval" ||
    parsed.value.targetId !== value.approvalId
  ) {
    return failure(
      "invalid_deep_link",
      `${path}.deepLink`,
      "The approval deep link does not match the approval.",
    );
  }
  return success({
    approvalId: value.approvalId,
    actions: [...value.actions] as ExpoApprovalAction[],
    deepLink: buildDeepLink(workspaceId, "approval", value.approvalId),
  });
}

export function adaptExpoWorkflowInbox(
  inbox: ExpoWorkflowInbox,
  scope: ExpoAdapterScope,
): ExpoAdapterResult<CleoExpoAdapter> {
  const validScope = validateScope(scope);
  if (!validScope.ok) {
    return validScope;
  }
  if (
    !isRecord(inbox) ||
    !hasOnlyKeys(inbox, [
      "workspaceId",
      "conversationContext",
      "cards",
      "approvals",
      "notifications",
      "agentWallet",
    ]) ||
    !isIdentifier(inbox.workspaceId)
  ) {
    return failure("invalid_input", "inbox", "The Expo inbox is malformed.");
  }
  if (inbox.workspaceId !== validScope.value.workspaceId) {
    return failure(
      "scope_mismatch",
      "inbox.workspaceId",
      "The inbox does not belong to the active workspace.",
    );
  }

  const context = inbox.conversationContext;
  if (
    !isRecord(context) ||
    !hasOnlyKeys(context, ["teamId", "harnessId", "entityWatermark"]) ||
    !isIdentifier(context.teamId) ||
    !isIdentifier(context.harnessId) ||
    !isIdentifier(context.entityWatermark)
  ) {
    return failure(
      "invalid_input",
      "inbox.conversationContext",
      "The conversation context is malformed.",
    );
  }
  if (context.teamId !== validScope.value.teamId) {
    return failure(
      "scope_mismatch",
      "inbox.conversationContext.teamId",
      "The inbox does not belong to the active team.",
    );
  }

  if (
    !Array.isArray(inbox.cards) ||
    inbox.cards.length === 0 ||
    inbox.cards.length > MAX_COLLECTION_LENGTH ||
    !Array.isArray(inbox.approvals) ||
    inbox.approvals.length > MAX_COLLECTION_LENGTH ||
    !Array.isArray(inbox.notifications) ||
    inbox.notifications.length > MAX_COLLECTION_LENGTH
  ) {
    return failure(
      "invalid_input",
      "inbox",
      "The inbox collections are malformed or exceed their bounds.",
    );
  }

  const cards: CleoExpoAdapterCard[] = [];
  for (const [index, card] of inbox.cards.entries()) {
    const adapted = adaptCard(card, validScope.value.workspaceId, index);
    if (!adapted.ok) {
      return adapted;
    }
    cards.push(adapted.value);
  }

  const approvals: CleoExpoAdapterApproval[] = [];
  const approvalIds = new Set<string>();
  for (const [index, approval] of inbox.approvals.entries()) {
    const adapted = adaptApproval(
      approval,
      validScope.value.workspaceId,
      index,
    );
    if (!adapted.ok) {
      return adapted;
    }
    if (approvalIds.has(adapted.value.approvalId)) {
      return failure(
        "invalid_input",
        `inbox.approvals[${index}]`,
        "Duplicate approvals are not allowed.",
      );
    }
    approvalIds.add(adapted.value.approvalId);
    approvals.push(adapted.value);
  }

  for (const [cardIndex, card] of cards.entries()) {
    for (const deepLink of card.deepLinks) {
      if (
        deepLink.kind === "wallet-intent" &&
        !approvalIds.has(deepLink.targetId)
      ) {
        return failure(
          "invalid_deep_link",
          `inbox.cards[${cardIndex}].deepLinks`,
          "A wallet-intent deep link must reference a pending approval.",
        );
      }
    }
  }

  const notifications: CleoExpoAdapterNotification[] = [];
  for (const [index, notification] of inbox.notifications.entries()) {
    if (
      !isRecord(notification) ||
      !hasOnlyKeys(notification, ["id", "title", "status"]) ||
      !isIdentifier(notification.id) ||
      !isText(notification.title) ||
      !isStatus(notification.status)
    ) {
      return failure(
        "invalid_input",
        `inbox.notifications[${index}]`,
        "The notification is malformed.",
      );
    }
    notifications.push({
      id: notification.id,
      title: notification.title,
      status: notification.status,
    });
  }

  const wallet = inbox.agentWallet;
  if (
    !isRecord(wallet) ||
    !hasOnlyKeys(wallet, [
      "availableTools",
      "approvalRequired",
      "workflowSteps",
    ]) ||
    !isBoundedCount(wallet.availableTools) ||
    !isBoundedCount(wallet.approvalRequired) ||
    !isBoundedCount(wallet.workflowSteps) ||
    wallet.approvalRequired > wallet.availableTools
  ) {
    return failure(
      "invalid_input",
      "inbox.agentWallet",
      "The agent-wallet summary is malformed.",
    );
  }

  return success({
    schemaVersion: EXPO_ADAPTER_SCHEMA_VERSION,
    workspaceId: validScope.value.workspaceId,
    teamId: validScope.value.teamId,
    conversationContext: {
      harnessId: context.harnessId,
      entityWatermark: context.entityWatermark,
    },
    cards,
    approvals,
    notifications,
    agentWallet: {
      availableTools: wallet.availableTools,
      approvalRequired: wallet.approvalRequired,
      workflowSteps: wallet.workflowSteps,
    },
  });
}

function validateChanges(
  value: unknown,
): ExpoAdapterResult<Readonly<Record<string, ExpoJsonPrimitive>>> {
  if (!isRecord(value)) {
    return failure(
      "invalid_input",
      "request.changes",
      "Edit intents require a plain changes object.",
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_CHANGES) {
    return failure(
      "invalid_input",
      "request.changes",
      "Edit intents require a bounded, non-empty changes object.",
    );
  }
  const changes: Record<string, ExpoJsonPrimitive> = {};
  for (const [key, item] of entries) {
    if (
      key.length > 64 ||
      !CHANGE_KEY_PATTERN.test(key) ||
      FORBIDDEN_CHANGE_KEYS.has(key) ||
      !(
        item === null ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item)) ||
        (typeof item === "string" &&
          item.length <= MAX_TEXT_LENGTH &&
          !hasDisallowedControlCharacter(item))
      )
    ) {
      return failure(
        "invalid_input",
        "request.changes",
        "The changes object contains an unsupported key or value.",
      );
    }
    changes[key] = item as ExpoJsonPrimitive;
  }
  return success(changes);
}

function findApproval(
  adapter: unknown,
  scope: ExpoAdapterScope,
  approvalId: string,
): ExpoAdapterResult<CleoExpoAdapterApproval & { harnessId: string }> {
  if (
    !isRecord(adapter) ||
    !hasOnlyKeys(adapter, [
      "schemaVersion",
      "workspaceId",
      "teamId",
      "conversationContext",
      "cards",
      "approvals",
      "notifications",
      "agentWallet",
    ]) ||
    adapter.schemaVersion !== EXPO_ADAPTER_SCHEMA_VERSION ||
    !isIdentifier(adapter.workspaceId) ||
    !isIdentifier(adapter.teamId) ||
    adapter.workspaceId !== scope.workspaceId ||
    adapter.teamId !== scope.teamId ||
    !isRecord(adapter.conversationContext) ||
    !hasOnlyKeys(adapter.conversationContext, [
      "harnessId",
      "entityWatermark",
    ]) ||
    !isIdentifier(adapter.conversationContext.harnessId) ||
    !isIdentifier(adapter.conversationContext.entityWatermark) ||
    !Array.isArray(adapter.approvals) ||
    adapter.approvals.length > MAX_COLLECTION_LENGTH
  ) {
    return failure(
      "scope_mismatch",
      "adapter",
      "The adapter is malformed or does not match the active scope.",
    );
  }

  for (const value of adapter.approvals) {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ["approvalId", "actions", "deepLink"]) ||
      !isIdentifier(value.approvalId) ||
      !Array.isArray(value.actions) ||
      value.actions.length === 0 ||
      value.actions.length > APPROVAL_ACTIONS.size ||
      !value.actions.every(isApprovalAction) ||
      new Set(value.actions).size !== value.actions.length ||
      !isRecord(value.deepLink) ||
      !hasOnlyKeys(value.deepLink, [
        "workspaceId",
        "kind",
        "targetId",
        "href",
      ]) ||
      value.deepLink.workspaceId !== scope.workspaceId ||
      value.deepLink.kind !== "approval" ||
      value.deepLink.targetId !== value.approvalId
    ) {
      return failure(
        "invalid_input",
        "adapter.approvals",
        "The adapter approval registry is malformed.",
      );
    }
    if (value.approvalId !== approvalId) {
      continue;
    }
    const parsed = parseExpoDeepLink(value.deepLink.href, scope.workspaceId);
    if (
      !parsed.ok ||
      parsed.value.kind !== "approval" ||
      parsed.value.targetId !== value.approvalId
    ) {
      return failure(
        "invalid_deep_link",
        "adapter.approvals.deepLink",
        "The registered approval deep link is invalid.",
      );
    }
    return success({
      approvalId: value.approvalId,
      actions: [...value.actions] as ExpoApprovalAction[],
      deepLink: parsed.value,
      harnessId: adapter.conversationContext.harnessId,
    });
  }
  return failure(
    "approval_not_found",
    "request.href",
    "The approval is not pending in this inbox.",
  );
}

export function createExpoApprovalIntent(
  adapter: CleoExpoAdapter,
  scope: ExpoAdapterScope,
  request: ExpoApprovalIntentRequest,
): ExpoAdapterResult<ExpoApprovalIntent> {
  const validScope = validateScope(scope);
  if (!validScope.ok) {
    return validScope;
  }
  if (
    !isRecord(request) ||
    !hasOnlyKeys(
      request,
      ["requestId", "actorId", "href", "action"],
      ["reason", "changes"],
    ) ||
    !isIdentifier(request.requestId) ||
    !isIdentifier(request.actorId) ||
    !isApprovalAction(request.action)
  ) {
    return failure(
      "invalid_input",
      "request",
      "The approval intent request is malformed.",
    );
  }

  const parsed = parseExpoDeepLink(request.href, validScope.value.workspaceId);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.kind !== "approval") {
    return failure(
      "invalid_deep_link",
      "request.href",
      "Approval intents require an approval deep link.",
    );
  }

  const approval = findApproval(
    adapter,
    validScope.value,
    parsed.value.targetId,
  );
  if (!approval.ok) {
    return approval;
  }
  if (
    approval.value.deepLink.href !== parsed.value.href ||
    !approval.value.actions.includes(request.action)
  ) {
    return failure(
      "action_not_allowed",
      "request.action",
      "The requested action is not allowed for this approval.",
    );
  }

  let reason: string | undefined;
  if (request.reason !== undefined) {
    if (!isText(request.reason, 500)) {
      return failure(
        "invalid_input",
        "request.reason",
        "The approval reason is malformed.",
      );
    }
    reason = request.reason.trim();
  }
  if (request.action === "reject" && !reason) {
    return failure(
      "invalid_input",
      "request.reason",
      "Reject intents require a reviewable reason.",
    );
  }

  let changes: Readonly<Record<string, ExpoJsonPrimitive>> | undefined;
  if (request.action === "edit") {
    const validChanges = validateChanges(request.changes);
    if (!validChanges.ok) {
      return validChanges;
    }
    changes = validChanges.value;
  } else if (request.changes !== undefined) {
    return failure(
      "invalid_input",
      "request.changes",
      "Only edit intents may contain changes.",
    );
  }

  return success({
    schemaVersion: EXPO_APPROVAL_INTENT_SCHEMA_VERSION,
    kind: "approval-intent",
    requestId: request.requestId,
    workspaceId: validScope.value.workspaceId,
    teamId: validScope.value.teamId,
    harnessId: approval.value.harnessId,
    actorId: request.actorId,
    approvalId: approval.value.approvalId,
    action: request.action,
    expectedApprovalState: "pending",
    requiresServerAuthorization: true,
    sourceDeepLink: approval.value.deepLink.href,
    ...(reason ? { reason } : {}),
    ...(changes ? { changes } : {}),
  });
}

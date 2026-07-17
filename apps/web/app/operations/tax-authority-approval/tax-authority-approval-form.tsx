"use client";

import { Check, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[a-f0-9]{64}$/;
const MAX_RESPONSE_BYTES = 32 * 1024;

type SafeReceipt = Readonly<{
  version: "oa-factura-e-authority-approval-receipt-v1";
  executionId: string;
  workspaceId: string;
  intentHash: string;
  status: "registered";
  replayed: boolean;
  nextStep: "request_execution_from_motora";
}>;

export function TaxAuthorityApprovalForm(
  props: Readonly<{
    initialWorkspaceId: string;
    initialExecutionId: string;
    initialIntentHash: string;
  }>,
) {
  const [workspaceId, setWorkspaceId] = useState(props.initialWorkspaceId);
  const [executionId, setExecutionId] = useState(props.initialExecutionId);
  const [intentHash, setIntentHash] = useState(props.initialIntentHash);
  const [workspaceGrant, setWorkspaceGrant] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SafeReceipt | null>(null);
  const valid = useMemo(
    () =>
      uuid.test(workspaceId) &&
      uuid.test(executionId) &&
      sha256.test(intentHash) &&
      workspaceGrant.length >= 80 &&
      workspaceGrant.length <= 4096 &&
      acknowledged,
    [acknowledged, executionId, intentHash, workspaceGrant, workspaceId],
  );

  const approve = async () => {
    if (!valid) return;
    setBusy(true);
    setReceipt(null);
    try {
      const response = await fetch("/api/tax/authority-approvals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bufi-workspace-grant": workspaceGrant,
        },
        body: JSON.stringify({
          version: "oa-factura-e-human-approval-v1",
          decision: "approved",
          acknowledgement: "frozen_intent_hash_reviewed",
          executionId,
          workspaceId,
          intentHash,
        }),
      });
      const body = await readBoundedResponse(response);
      if (
        !response.ok ||
        !matchesExpectedTaxAuthorityApprovalReceipt(body, {
          executionId,
          workspaceId,
          intentHash,
        })
      )
        throw new Error(safeError(body, response.status));
      setReceipt(body.data);
      toast.success(
        body.data.replayed
          ? "Approval was already registered"
          : "One-use approval registered",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Approval registration failed",
      );
    } finally {
      setWorkspaceGrant("");
      setAcknowledged(false);
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--muted)),transparent_45%)] p-4 md:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
              BUFI / Tax authority corridor
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Review frozen Factura E intent
            </h1>
          </div>
          <Button variant="ghost" asChild>
            <Link href="/operations">Back to operations</Link>
          </Button>
        </header>

        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Human approval required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This action only registers one approval for the exact workspace,
              authority intent and frozen hash below. Motora performs the
              separately gated execution; no ARCA credential or signing key is
              sent to this browser.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="tax-workspace-id">Workspace UUID</Label>
                <Input
                  id="tax-workspace-id"
                  value={workspaceId}
                  onChange={(event) =>
                    setWorkspaceId(event.target.value.trim())
                  }
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="tax-authority-execution-id">
                  Authority intent UUID
                </Label>
                <Input
                  id="tax-authority-execution-id"
                  value={executionId}
                  onChange={(event) =>
                    setExecutionId(event.target.value.trim())
                  }
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="tax-intent-hash">Frozen intent SHA-256</Label>
                <Input
                  id="tax-intent-hash"
                  className="font-mono text-xs"
                  value={intentHash}
                  onChange={(event) =>
                    setIntentHash(event.target.value.trim().toLowerCase())
                  }
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="tax-approval-grant">
                  One-time Desk approval grant
                </Label>
                <Input
                  id="tax-approval-grant"
                  type="password"
                  autoComplete="off"
                  value={workspaceGrant}
                  onChange={(event) => setWorkspaceGrant(event.target.value)}
                  placeholder="Scope: tax.invoice.authority.approve"
                />
              </div>
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I reviewed this frozen intent hash and explicitly approve this
                single authority execution.
              </span>
            </label>
            <Button disabled={!valid || busy} onClick={() => void approve()}>
              <Check className="h-4 w-4" />
              {busy ? "Registering approval…" : "Approve exact intent"}
            </Button>
          </CardContent>
        </Card>

        {receipt ? (
          <Card className="border-emerald-500/40">
            <CardContent className="space-y-2 pt-6 text-sm">
              <p className="font-medium text-emerald-700 dark:text-emerald-300">
                {receipt.replayed
                  ? "Approval already registered"
                  : "One-use approval registered"}
              </p>
              <p className="text-muted-foreground">
                Motora can now request the separately gated execution for
                authority intent {receipt.executionId}.
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                Approved hash: {receipt.intentHash}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  )
    throw new Error("Approval response was invalid");
  if (!response.body) throw new Error("Approval response was invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Approval response was invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error("Approval response was invalid");
  }
}

export function isSafeTaxAuthorityApprovalReceiptEnvelope(
  value: unknown,
): value is Readonly<{ data: SafeReceipt }> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1) return false;
  const data = record.data;
  if (!data || typeof data !== "object") return false;
  const receipt = data as Record<string, unknown>;
  return (
    Object.keys(receipt).length === 7 &&
    receipt.version === "oa-factura-e-authority-approval-receipt-v1" &&
    typeof receipt.executionId === "string" &&
    uuid.test(receipt.executionId) &&
    typeof receipt.workspaceId === "string" &&
    uuid.test(receipt.workspaceId) &&
    typeof receipt.intentHash === "string" &&
    sha256.test(receipt.intentHash) &&
    receipt.status === "registered" &&
    typeof receipt.replayed === "boolean" &&
    receipt.nextStep === "request_execution_from_motora"
  );
}

export function matchesExpectedTaxAuthorityApprovalReceipt(
  value: unknown,
  expected: Readonly<{
    executionId: string;
    workspaceId: string;
    intentHash: string;
  }>,
): value is Readonly<{ data: SafeReceipt }> {
  return (
    isSafeTaxAuthorityApprovalReceiptEnvelope(value) &&
    value.data.executionId === expected.executionId &&
    value.data.workspaceId === expected.workspaceId &&
    value.data.intentHash === expected.intentHash
  );
}

function safeError(value: unknown, status: number): string {
  if (value && typeof value === "object") {
    const error = (value as Record<string, unknown>).error;
    if (
      typeof error === "string" &&
      (/^[A-Z0-9_]{1,120}$/.test(error) ||
        [
          "Invalid approval request",
          "Invalid request origin",
          "Invalid workspace grant",
        ].includes(error))
    )
      return error;
  }
  return `Approval failed (${status})`;
}

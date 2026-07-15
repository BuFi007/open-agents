import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/session/get-server-session";
import { TaxAuthorityApprovalForm } from "./tax-authority-approval-form";

export const metadata: Metadata = {
  title: "Factura E authority approval",
  description: "Review and register one exact Tax authority approval.",
};

type ApprovalSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function TaxAuthorityApprovalPage({
  searchParams,
}: Readonly<{ searchParams: ApprovalSearchParams }>) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");
  const query = await searchParams;
  return (
    <TaxAuthorityApprovalForm
      initialWorkspaceId={single(query.workspaceId)}
      initialExecutionId={single(query.executionId)}
      initialIntentHash={single(query.intentHash)}
    />
  );
}

function single(value: string | string[] | undefined): string {
  return typeof value === "string" && value.length <= 128 ? value : "";
}

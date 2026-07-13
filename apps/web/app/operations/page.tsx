import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session/get-server-session";
import { OperationsCommandCenter } from "./operations-command-center";

export const metadata: Metadata = {
  title: "Agent Operations",
  description: "Launch and control durable workspace agent teams.",
};

export default async function OperationsPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/");
  return <OperationsCommandCenter />;
}

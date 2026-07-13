import type { OperatingPackCompositionItem } from "@/lib/operating-packs/runtime";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  operatingPackCompositionRevisions,
  operatingPackCompositions,
} from "./schema";

export type WorkspaceComposition = Readonly<{
  revision: number;
  items: readonly OperatingPackCompositionItem[];
}>;

export async function getWorkspaceOperatingPackComposition(
  workspaceId: string,
  userId: string,
) {
  const [composition, revisions] = await Promise.all([
    db.query.operatingPackCompositions.findFirst({
      where: and(
        eq(operatingPackCompositions.workspaceId, workspaceId),
        eq(operatingPackCompositions.userId, userId),
      ),
    }),
    db
      .select({
        revision: operatingPackCompositionRevisions.revision,
        eventType: operatingPackCompositionRevisions.eventType,
        summary: operatingPackCompositionRevisions.summary,
        createdAt: operatingPackCompositionRevisions.createdAt,
      })
      .from(operatingPackCompositionRevisions)
      .where(
        and(
          eq(operatingPackCompositionRevisions.workspaceId, workspaceId),
          eq(operatingPackCompositionRevisions.userId, userId),
        ),
      )
      .orderBy(desc(operatingPackCompositionRevisions.revision))
      .limit(20),
  ]);
  return {
    composition: composition
      ? { revision: composition.revision, items: composition.items }
      : { revision: 0, items: [] },
    revisions,
  };
}

export async function saveWorkspaceOperatingPackComposition(input: {
  workspaceId: string;
  userId: string;
  expectedRevision: number;
  items: readonly OperatingPackCompositionItem[];
  eventType?: "composition.saved" | "composition.reverted";
  summary?: string;
}): Promise<
  | { saved: true; composition: WorkspaceComposition }
  | { saved: false; currentRevision: number }
> {
  return db.transaction(async (tx) => {
    const current = await tx.query.operatingPackCompositions.findFirst({
      where: and(
        eq(operatingPackCompositions.workspaceId, input.workspaceId),
        eq(operatingPackCompositions.userId, input.userId),
      ),
    });
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision)
      return { saved: false as const, currentRevision };

    const revision = currentRevision + 1;
    const [saved] = current
      ? await tx
          .update(operatingPackCompositions)
          .set({
            revision,
            items: input.items,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(operatingPackCompositions.workspaceId, input.workspaceId),
              eq(operatingPackCompositions.userId, input.userId),
              eq(operatingPackCompositions.revision, currentRevision),
            ),
          )
          .returning()
      : await tx
          .insert(operatingPackCompositions)
          .values({
            workspaceId: input.workspaceId,
            userId: input.userId,
            revision,
            items: input.items,
          })
          .onConflictDoNothing()
          .returning();
    if (!saved) {
      const latest = await tx.query.operatingPackCompositions.findFirst({
        where: and(
          eq(operatingPackCompositions.workspaceId, input.workspaceId),
          eq(operatingPackCompositions.userId, input.userId),
        ),
      });
      return {
        saved: false as const,
        currentRevision: latest?.revision ?? currentRevision,
      };
    }
    await tx.insert(operatingPackCompositionRevisions).values({
      id: `opc_${nanoid(24)}`,
      workspaceId: input.workspaceId,
      userId: input.userId,
      revision,
      eventType: input.eventType ?? "composition.saved",
      items: input.items,
      summary:
        input.summary ??
        `Saved ${input.items.length} operating-pack components`,
    });
    return {
      saved: true as const,
      composition: { revision, items: input.items },
    };
  });
}

export async function getWorkspaceOperatingPackCompositionRevision(input: {
  workspaceId: string;
  userId: string;
  revision: number;
}) {
  return db.query.operatingPackCompositionRevisions.findFirst({
    where: and(
      eq(operatingPackCompositionRevisions.workspaceId, input.workspaceId),
      eq(operatingPackCompositionRevisions.userId, input.userId),
      eq(operatingPackCompositionRevisions.revision, input.revision),
    ),
  });
}

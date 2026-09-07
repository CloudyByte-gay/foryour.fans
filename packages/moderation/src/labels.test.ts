import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { applyLabel, listEffectiveLabels, removeLabel } from "./labels.js";
import { cleanupModerationFixtures, createCreator, createPost, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("applyLabel / removeLabel / listEffectiveLabels", () => {
  it("applying a label makes it show up as effective and writes an audit log", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);

    await applyLabel(prisma, { subjectType: "POST", subjectId: post.id, val: "porn", appliedBy: admin });

    const effective = await listEffectiveLabels(prisma, "POST", post.id);
    expect(effective.map((l) => l.val)).toEqual(["porn"]);

    const logs = await prisma.auditLog.findMany({ where: { targetType: "POST", targetId: post.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "LABEL_APPLIED", metadata: { val: "porn" } });
  });

  it("removing a label inserts a negation row and drops it from the effective set", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);

    await applyLabel(prisma, { subjectType: "POST", subjectId: post.id, val: "spam", appliedBy: admin });
    await removeLabel(prisma, { subjectType: "POST", subjectId: post.id, val: "spam", removedBy: admin });

    const effective = await listEffectiveLabels(prisma, "POST", post.id);
    expect(effective).toHaveLength(0);

    const allRows = await prisma.contentLabel.findMany({ where: { subjectType: "POST", subjectId: post.id } });
    expect(allRows).toHaveLength(2);
    expect(allRows.some((r) => r.neg)).toBe(true);
  });

  it("multiple label values coexist independently", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);

    await applyLabel(prisma, { subjectType: "POST", subjectId: post.id, val: "nudity", appliedBy: admin });
    await applyLabel(prisma, { subjectType: "POST", subjectId: post.id, val: "spam", appliedBy: admin });
    await removeLabel(prisma, { subjectType: "POST", subjectId: post.id, val: "spam", removedBy: admin });

    const effective = await listEffectiveLabels(prisma, "POST", post.id);
    expect(effective.map((l) => l.val)).toEqual(["nudity"]);
  });
});

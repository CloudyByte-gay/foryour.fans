import { randomUUID } from "node:crypto";
import { getPrismaClient, type Creator, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { FakeObjectStorage, fixedResultMediaProcessor } from "./fakes.js";
import { MediaAssetNotFoundError, MediaAssetStateError, completeUpload, createUploadIntent, getOwnedMediaAsset, getReadyMediaAsset } from "./media.js";
import { MediaValidationError } from "./validation.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function makeCreator(): Promise<Creator> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  return prisma.creator.create({ data: { userId: user.id, did } });
}

async function cleanup(did: string): Promise<void> {
  await prisma.mediaAsset.deleteMany({ where: { creator: { did } } });
  await prisma.creator.deleteMany({ where: { did } });
  await prisma.user.deleteMany({ where: { did } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createUploadIntent", () => {
  it("creates a PENDING_UPLOAD row and asks storage for an upload URL", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();

    const { asset, uploadUrl } = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });

    expect(asset.status).toBe("PENDING_UPLOAD");
    expect(asset.creatorId).toBe(creator.id);
    expect(storage.uploadCalls).toHaveLength(1);
    expect(storage.uploadCalls[0]?.key).toBe(asset.storageKey);
    expect(uploadUrl).toContain(asset.storageKey);

    await cleanup(creator.did);
  });

  it("rejects invalid fields before ever touching storage or the DB", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();

    await expect(createUploadIntent(prisma, storage, creator, { mimeType: "application/pdf", size: 1024 })).rejects.toThrow(
      MediaValidationError,
    );
    expect(storage.uploadCalls).toHaveLength(0);
    expect(await prisma.mediaAsset.count({ where: { creatorId: creator.id } })).toBe(0);

    await cleanup(creator.did);
  });

  it("generates a distinct storageKey for two uploads from the same creator", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();

    const first = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });
    const second = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 2048 });

    expect(first.asset.storageKey).not.toBe(second.asset.storageKey);

    await cleanup(creator.did);
  });
});

describe("completeUpload", () => {
  it("transitions PENDING_UPLOAD -> READY when the processor accepts", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();
    const { asset } = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });

    const completed = await completeUpload(prisma, fixedResultMediaProcessor("ready"), creator.id, asset.id);

    expect(completed.status).toBe("READY");

    await cleanup(creator.did);
  });

  it("transitions PENDING_UPLOAD -> REJECTED when the processor rejects", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();
    const { asset } = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });

    const completed = await completeUpload(prisma, fixedResultMediaProcessor("rejected"), creator.id, asset.id);

    expect(completed.status).toBe("REJECTED");

    await cleanup(creator.did);
  });

  it("throws MediaAssetStateError when called twice on the same asset", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();
    const { asset } = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });
    await completeUpload(prisma, fixedResultMediaProcessor("ready"), creator.id, asset.id);

    await expect(completeUpload(prisma, fixedResultMediaProcessor("ready"), creator.id, asset.id)).rejects.toThrow(
      MediaAssetStateError,
    );

    await cleanup(creator.did);
  });

  it("throws MediaAssetNotFoundError for an asset owned by a different creator", async () => {
    const owner = await makeCreator();
    const stranger = await makeCreator();
    const storage = new FakeObjectStorage();
    const { asset } = await createUploadIntent(prisma, storage, owner, { mimeType: "image/png", size: 1024 });

    await expect(completeUpload(prisma, fixedResultMediaProcessor("ready"), stranger.id, asset.id)).rejects.toThrow(
      MediaAssetNotFoundError,
    );

    await cleanup(owner.did);
    await cleanup(stranger.did);
  });
});

describe("getOwnedMediaAsset", () => {
  it("throws MediaAssetNotFoundError for a nonexistent id", async () => {
    const creator = await makeCreator();
    await expect(getOwnedMediaAsset(prisma, creator.id, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      MediaAssetNotFoundError,
    );
    await cleanup(creator.did);
  });
});

describe("getReadyMediaAsset", () => {
  it("returns null for a PENDING_UPLOAD asset", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();
    const { asset } = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });

    expect(await getReadyMediaAsset(prisma, asset.id)).toBeNull();

    await cleanup(creator.did);
  });

  it("returns null for a REJECTED asset", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();
    const { asset } = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });
    await completeUpload(prisma, fixedResultMediaProcessor("rejected"), creator.id, asset.id);

    expect(await getReadyMediaAsset(prisma, asset.id)).toBeNull();

    await cleanup(creator.did);
  });

  it("returns the row for a READY asset", async () => {
    const creator = await makeCreator();
    const storage = new FakeObjectStorage();
    const { asset } = await createUploadIntent(prisma, storage, creator, { mimeType: "image/png", size: 1024 });
    await completeUpload(prisma, fixedResultMediaProcessor("ready"), creator.id, asset.id);

    const result = await getReadyMediaAsset(prisma, asset.id);
    expect(result?.id).toBe(asset.id);

    await cleanup(creator.did);
  });

  it("returns null for a nonexistent id", async () => {
    expect(await getReadyMediaAsset(prisma, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

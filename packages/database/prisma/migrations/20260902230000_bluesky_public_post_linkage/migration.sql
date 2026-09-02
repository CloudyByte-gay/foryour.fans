-- AlterTable
ALTER TABLE "indexed_posts" ADD COLUMN     "bskyUri" TEXT,
ADD COLUMN     "cid" TEXT,
ADD COLUMN     "collection" TEXT NOT NULL DEFAULT 'fans.foryour.post',
ADD COLUMN     "mergedFromUri" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "bskyRkey" TEXT,
ADD COLUMN     "canonicalUri" TEXT;

-- CreateIndex
CREATE INDEX "indexed_posts_collection_idx" ON "indexed_posts"("collection");

-- CreateIndex
CREATE UNIQUE INDEX "posts_bskyRkey_key" ON "posts"("bskyRkey");


-- AlterTable
ALTER TABLE "likes" ADD COLUMN     "atRkey" TEXT,
ADD COLUMN     "sourceUri" TEXT,
ADD COLUMN     "sourceCid" TEXT,
ADD COLUMN     "bskyRkey" TEXT,
ADD COLUMN     "bskyUri" TEXT,
ADD COLUMN     "bskyCid" TEXT,
ADD COLUMN     "isAuthoritative" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "indexedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "indexed_likes" (
    "uri" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "collection" TEXT NOT NULL DEFAULT 'fans.foryour.like',
    "subjectUri" TEXT NOT NULL,
    "subjectCid" TEXT,
    "atCreatedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexed_likes_pkey" PRIMARY KEY ("uri")
);

-- CreateIndex
CREATE UNIQUE INDEX "likes_atRkey_key" ON "likes"("atRkey");

-- CreateIndex
CREATE UNIQUE INDEX "likes_sourceUri_key" ON "likes"("sourceUri");

-- CreateIndex
CREATE UNIQUE INDEX "likes_bskyRkey_key" ON "likes"("bskyRkey");

-- CreateIndex
CREATE UNIQUE INDEX "likes_bskyUri_key" ON "likes"("bskyUri");

-- CreateIndex
CREATE INDEX "likes_postId_createdAt_idx" ON "likes"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "indexed_likes_subjectUri_idx" ON "indexed_likes"("subjectUri");

-- CreateIndex
CREATE INDEX "indexed_likes_did_idx" ON "indexed_likes"("did");

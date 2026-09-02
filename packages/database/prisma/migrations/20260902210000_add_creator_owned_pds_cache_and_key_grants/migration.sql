-- CreateEnum
CREATE TYPE "ContentKeyAudience" AS ENUM ('SUBSCRIBERS', 'TIER');

-- AlterTable
ALTER TABLE "creators" ADD COLUMN     "pdsSyncedAt" TIMESTAMP(3),
ADD COLUMN     "pdsUrl" TEXT,
ADD COLUMN     "profileSourceCid" TEXT,
ADD COLUMN     "profileSourceUri" TEXT,
ADD COLUMN     "serviceConfigUri" TEXT;

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "encrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isAuthoritative" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pdsBlobCid" TEXT,
ADD COLUMN     "sourceCid" TEXT,
ADD COLUMN     "sourceUri" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "accessPolicyUri" TEXT,
ADD COLUMN     "bskyCid" TEXT,
ADD COLUMN     "bskyUri" TEXT,
ADD COLUMN     "cacheExpiresAt" TIMESTAMP(3),
ADD COLUMN     "indexedAt" TIMESTAMP(3),
ADD COLUMN     "isAuthoritative" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceCid" TEXT,
ADD COLUMN     "sourceUri" TEXT;

-- AlterTable
ALTER TABLE "subscription_tiers" ADD COLUMN     "isAuthoritative" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceCid" TEXT,
ADD COLUMN     "sourceUri" TEXT;

-- CreateTable
CREATE TABLE "content_keys" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "postId" UUID,
    "subjectUri" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "wrappedKey" TEXT NOT NULL,
    "audience" "ContentKeyAudience" NOT NULL,
    "requiredTierId" UUID,
    "accessPolicyUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_key_grants" (
    "id" UUID NOT NULL,
    "contentKeyId" UUID NOT NULL,
    "subscriberUserId" UUID NOT NULL,
    "subscriptionId" UUID,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "content_key_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_keys_postId_key" ON "content_keys"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "content_keys_subjectUri_key" ON "content_keys"("subjectUri");

-- CreateIndex
CREATE INDEX "content_keys_creatorId_idx" ON "content_keys"("creatorId");

-- CreateIndex
CREATE INDEX "content_key_grants_subscriptionId_idx" ON "content_key_grants"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "content_key_grants_contentKeyId_subscriberUserId_key" ON "content_key_grants"("contentKeyId", "subscriberUserId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_sourceUri_key" ON "media_assets"("sourceUri");

-- CreateIndex
CREATE UNIQUE INDEX "posts_sourceUri_key" ON "posts"("sourceUri");

-- CreateIndex
CREATE UNIQUE INDEX "posts_bskyUri_key" ON "posts"("bskyUri");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_tiers_sourceUri_key" ON "subscription_tiers"("sourceUri");

-- AddForeignKey
ALTER TABLE "content_keys" ADD CONSTRAINT "content_keys_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_keys" ADD CONSTRAINT "content_keys_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_keys" ADD CONSTRAINT "content_keys_requiredTierId_fkey" FOREIGN KEY ("requiredTierId") REFERENCES "subscription_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_key_grants" ADD CONSTRAINT "content_key_grants_contentKeyId_fkey" FOREIGN KEY ("contentKeyId") REFERENCES "content_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_key_grants" ADD CONSTRAINT "content_key_grants_subscriberUserId_fkey" FOREIGN KEY ("subscriberUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


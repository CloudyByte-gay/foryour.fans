-- CreateTable
CREATE TABLE "indexed_creator_profiles" (
    "did" TEXT NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "bio" TEXT,
    "website" TEXT,
    "atCreatedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexed_creator_profiles_pkey" PRIMARY KEY ("did")
);

-- CreateTable
CREATE TABLE "indexed_posts" (
    "uri" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "atCreatedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexed_posts_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "indexed_tiers" (
    "uri" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" INTEGER,
    "currency" TEXT,
    "sortOrder" INTEGER,
    "atCreatedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexed_tiers_pkey" PRIMARY KEY ("uri")
);

-- CreateTable
CREATE TABLE "ingestion_cursors" (
    "source" TEXT NOT NULL,
    "cursor" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_cursors_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE INDEX "indexed_creator_profiles_handle_idx" ON "indexed_creator_profiles"("handle");

-- CreateIndex
CREATE INDEX "indexed_posts_did_atCreatedAt_idx" ON "indexed_posts"("did", "atCreatedAt");

-- CreateIndex
CREATE INDEX "indexed_tiers_did_idx" ON "indexed_tiers"("did");

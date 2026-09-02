-- DropIndex
DROP INDEX "creators_slug_key";

-- AlterTable
ALTER TABLE "creators" DROP COLUMN "slug",
DROP COLUMN "slugUpdatedAt";

-- CreateTable
CREATE TABLE "creator_handle_history" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "did" TEXT NOT NULL,
    "previousHandle" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_handle_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_handle_history_previousHandle_idx" ON "creator_handle_history"("previousHandle");

-- CreateIndex
CREATE INDEX "creator_handle_history_did_idx" ON "creator_handle_history"("did");

-- AddForeignKey
ALTER TABLE "creator_handle_history" ADD CONSTRAINT "creator_handle_history_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

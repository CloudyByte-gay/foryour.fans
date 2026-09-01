-- AlterTable
ALTER TABLE "creators" ALTER COLUMN "slugUpdatedAt" DROP NOT NULL,
ALTER COLUMN "slugUpdatedAt" DROP DEFAULT;

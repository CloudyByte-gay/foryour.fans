-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ModerationSubjectType" AS ENUM ('CREATOR', 'USER', 'POST', 'COMMENT');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'IMPERSONATION', 'SEXUAL_CONTENT_VIOLATION', 'NCII', 'COPYRIGHT', 'ILLEGAL_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'ACTION_TAKEN', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CASE_DISMISSED', 'CONTENT_REMOVED', 'ACCOUNT_RESTRICTED', 'ACCOUNT_REINSTATED', 'CREATOR_SUSPENDED', 'CREATOR_REINSTATED', 'LABEL_APPLIED', 'LABEL_REMOVED', 'CREATOR_VERIFICATION_SUBMITTED', 'CREATOR_VERIFICATION_APPROVED', 'CREATOR_VERIFICATION_REJECTED');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "containsAdultContent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscription_tiers" ADD COLUMN     "containsAdultContent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporterUserId" UUID NOT NULL,
    "subjectType" "ModerationSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reasonType" "ReportReason" NOT NULL,
    "reason" TEXT,
    "moderationCaseId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL,
    "subjectType" "ModerationSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "requiresLegalReview" BOOLEAN NOT NULL DEFAULT false,
    "classifierSuggestion" JSONB,
    "resolvedByUserId" UUID,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_labels" (
    "id" UUID NOT NULL,
    "subjectType" "ModerationSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectUri" TEXT,
    "val" TEXT NOT NULL,
    "src" TEXT NOT NULL DEFAULT 'foryour.fans-moderation',
    "neg" BOOLEAN NOT NULL DEFAULT false,
    "cts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exp" TIMESTAMP(3),
    "moderationCaseId" UUID,
    "appliedByUserId" UUID,

    CONSTRAINT "content_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" UUID NOT NULL,
    "blockerUserId" UUID NOT NULL,
    "blockedUserId" UUID NOT NULL,
    "atUri" TEXT NOT NULL,
    "atCid" TEXT NOT NULL,
    "atRkey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_blocks" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "blockedUserId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorRole" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetType" "ModerationSubjectType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "moderationCaseId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_subjectType_subjectId_idx" ON "reports"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "reports_moderationCaseId_idx" ON "reports"("moderationCaseId");

-- CreateIndex
CREATE INDEX "moderation_cases_subjectType_subjectId_idx" ON "moderation_cases"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "moderation_cases_status_idx" ON "moderation_cases"("status");

-- CreateIndex
CREATE INDEX "content_labels_subjectType_subjectId_idx" ON "content_labels"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_atUri_key" ON "user_blocks"("atUri");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_atRkey_key" ON "user_blocks"("atRkey");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blockerUserId_blockedUserId_key" ON "user_blocks"("blockerUserId", "blockedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_blocks_creatorId_blockedUserId_key" ON "creator_blocks"("creatorId", "blockedUserId");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_moderationCaseId_idx" ON "audit_logs"("moderationCaseId");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_moderationCaseId_fkey" FOREIGN KEY ("moderationCaseId") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_labels" ADD CONSTRAINT "content_labels_moderationCaseId_fkey" FOREIGN KEY ("moderationCaseId") REFERENCES "moderation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_labels" ADD CONSTRAINT "content_labels_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockerUserId_fkey" FOREIGN KEY ("blockerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_blocks" ADD CONSTRAINT "creator_blocks_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_blocks" ADD CONSTRAINT "creator_blocks_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_moderationCaseId_fkey" FOREIGN KEY ("moderationCaseId") REFERENCES "moderation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

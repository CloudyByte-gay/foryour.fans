-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "did" TEXT NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_did_key" ON "users"("did");

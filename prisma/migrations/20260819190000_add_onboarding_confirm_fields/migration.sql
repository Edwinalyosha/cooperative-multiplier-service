-- AlterTable
ALTER TABLE "PendingOnboarding" ADD COLUMN "suggestedClientId" INTEGER,
ADD COLUMN "confirmToken" TEXT,
ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PendingOnboarding_confirmToken_key" ON "PendingOnboarding"("confirmToken");

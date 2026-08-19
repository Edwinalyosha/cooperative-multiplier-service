-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('PENDING', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "PendingOnboarding" (
    "id" SERIAL NOT NULL,
    "fineractUsername" TEXT,
    "email" TEXT,
    "firstname" TEXT,
    "lastname" TEXT,
    "fineractRole" TEXT,
    "rawPayload" JSONB NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedClientId" INTEGER,

    CONSTRAINT "PendingOnboarding_pkey" PRIMARY KEY ("id")
);

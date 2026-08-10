-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DIRECTOR', 'FINANCE_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "LoanApplicationStatus" AS ENUM ('PENDING_DIRECTOR_APPROVAL', 'PENDING_FINANCE_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "eligibilityAtRequestTime" DECIMAL(14,2) NOT NULL,
    "status" "LoanApplicationStatus" NOT NULL DEFAULT 'PENDING_DIRECTOR_APPROVAL',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "financeDecidedBy" INTEGER,
    "financeDecidedAt" TIMESTAMP(3),
    "financeNotes" TEXT,
    "fineractLoanId" INTEGER,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanApproval" (
    "id" SERIAL NOT NULL,
    "loanApplicationId" INTEGER NOT NULL,
    "directorClientId" INTEGER NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "isGuarantor" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clientId_key" ON "User"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "LoanApproval_loanApplicationId_directorClientId_key" ON "LoanApproval"("loanApplicationId", "directorClientId");

-- AddForeignKey
ALTER TABLE "LoanApproval" ADD CONSTRAINT "LoanApproval_loanApplicationId_fkey" FOREIGN KEY ("loanApplicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


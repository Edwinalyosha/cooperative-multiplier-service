-- CreateTable
CREATE TABLE "DirectorMultiplier" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "currentMultiplier" DECIMAL(10,3) NOT NULL,
    "loanMultiple" DECIMAL(10,3) NOT NULL,
    "contributionScore" INTEGER,
    "repaymentScore" INTEGER,
    "consecutiveOnTimeContributions" INTEGER DEFAULT 0,
    "consecutiveOnTimeRepayments" INTEGER DEFAULT 0,
    "lastContributionStatus" TEXT,
    "lastRepaymentStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectorMultiplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiplierHistory" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "oldMultiplier" DECIMAL(10,3),
    "newMultiplier" DECIMAL(10,3),
    "stepAmount" DECIMAL(10,3),
    "direction" TEXT,
    "triggeredBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultiplierHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectorMultiplier_clientId_key" ON "DirectorMultiplier"("clientId");

-- AddForeignKey
ALTER TABLE "MultiplierHistory" ADD CONSTRAINT "MultiplierHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "DirectorMultiplier"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE;

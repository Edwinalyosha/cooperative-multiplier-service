-- Collateral holds on pledged savings.
--
-- When a loan draws on the savings half of a member's limit, that portion is
-- frozen in Fineract for the life of the loan. Without it a member could
-- save, borrow against the raised limit, and withdraw the backing the same
-- day — which is precisely what makes a savingsFactor above 1.0 defensible.
--
-- savingsHoldTransactionId is Fineract's own handle for the hold and the only
-- way to release it, so it is stored rather than recomputed. Losing it would
-- freeze a member's money with no route back short of manual surgery in
-- Fineract.
--
-- All nullable: most loans need no hold at all (they fit inside the
-- contributions-derived limit), and every existing row predates the feature.
ALTER TABLE "LoanApplication" ADD COLUMN "savingsHoldAccountId" INTEGER;
ALTER TABLE "LoanApplication" ADD COLUMN "savingsHoldTransactionId" INTEGER;
ALTER TABLE "LoanApplication" ADD COLUMN "savingsHeldAmount" DECIMAL(14,2);
ALTER TABLE "LoanApplication" ADD COLUMN "savingsHoldReleasedAt" TIMESTAMP(3);

-- Finds holds still outstanding, which is the only query the release sweep
-- runs. Partial so it stays small: released holds are the overwhelming
-- majority over time and are never looked up this way.
CREATE INDEX "LoanApplication_openSavingsHold_idx"
  ON "LoanApplication" ("savingsHoldTransactionId")
  WHERE "savingsHoldTransactionId" IS NOT NULL
    AND "savingsHoldReleasedAt" IS NULL;

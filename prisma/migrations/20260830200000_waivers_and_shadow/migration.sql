-- Penalty waivers, and the record needed to reverse one exactly.
--
-- The cooperative will sometimes forgive a late week or installment —
-- genuine hardship, a member who was travelling, a first offence during the
-- introduction of a rule nobody was used to. Without this the only options
-- are "charge everyone" or "charge nobody".
--
-- `penaltyStep` / `stepApplied` record what was ACTUALLY charged, so a waiver
-- reverses precisely that rather than assuming today's configured value. The
-- two can differ: steps are configurable, and under shadow mode
-- (PENALTIES_ACTIVE_FROM) the applied step is 0 — waiving one of those must
-- move nothing.
--
-- `clearedAt` on a repayment marks the catch-up reward as given, so paying
-- off a late installment earns LATE_REPAYMENT_CLEARED exactly once.
--
-- All nullable: every existing row predates the feature, and most rows will
-- never be waived.
ALTER TABLE "ContributionPeriod" ADD COLUMN "penaltyStep" DECIMAL(10,3);
ALTER TABLE "ContributionPeriod" ADD COLUMN "waivedAt"    TIMESTAMP(3);
ALTER TABLE "ContributionPeriod" ADD COLUMN "waivedBy"    INTEGER;
ALTER TABLE "ContributionPeriod" ADD COLUMN "waiveReason" TEXT;

ALTER TABLE "RepaymentAssessment" ADD COLUMN "stepApplied" DECIMAL(10,3);
ALTER TABLE "RepaymentAssessment" ADD COLUMN "clearedAt"   TIMESTAMP(3);
ALTER TABLE "RepaymentAssessment" ADD COLUMN "waivedAt"    TIMESTAMP(3);
ALTER TABLE "RepaymentAssessment" ADD COLUMN "waivedBy"    INTEGER;
ALTER TABLE "RepaymentAssessment" ADD COLUMN "waiveReason" TEXT;

-- Finds penalties still standing — the only query the waiver UI runs.
CREATE INDEX "ContributionPeriod_unwaivedPenalty_idx"
  ON "ContributionPeriod" ("clientId")
  WHERE "penaltyAppliedAt" IS NOT NULL AND "waivedAt" IS NULL;

CREATE INDEX "RepaymentAssessment_unwaivedPenalty_idx"
  ON "RepaymentAssessment" ("clientId")
  WHERE "outcome" = 'LATE' AND "waivedAt" IS NULL;

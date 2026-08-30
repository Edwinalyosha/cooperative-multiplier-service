-- Per-installment repayment timeliness.
--
-- Closes MLTD-P009: repayment behaviour never moved a member's multiplier.
-- ON_TIME_REPAYMENT and LATE_REPAYMENT only fired if something called the API
-- by hand with a caller-supplied `onTime` boolean that verified nothing.
--
-- Timeliness is READ from Fineract's repayment schedule, which already holds
-- when each installment was due and when its obligations were met. It was
-- deliberately NOT built on a transaction-size threshold: a 12,000 payment
-- three weeks late passes any such test while plainly being late, and no
-- threshold can notice an installment missed entirely.
--
-- Same shape as ContributionPeriod, for the same reason — "assess each
-- obligation exactly once" must be a property of the data rather than of how
-- often a scheduler runs. The unique constraint below is what makes a re-run,
-- a restart or an overlapping cron harmless.
CREATE TABLE "RepaymentAssessment" (
    "id"                SERIAL PRIMARY KEY,
    "clientId"          INTEGER NOT NULL,
    "fineractLoanId"    INTEGER NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate"           DATE NOT NULL,
    "metOn"             DATE,
    "outcome"           TEXT NOT NULL,
    "assessedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One assessment per installment, enforced by the database so two concurrent
-- sweeps cannot both charge for the same missed payment.
CREATE UNIQUE INDEX "RepaymentAssessment_loan_installment_key"
    ON "RepaymentAssessment" ("fineractLoanId", "installmentNumber");

CREATE INDEX "RepaymentAssessment_clientId_idx"
    ON "RepaymentAssessment" ("clientId");

-- Phase 4 (P2-1): make finance approval resumable across a partial failure.
--
-- Finance approval is two separate Fineract calls (approve, then disburse).
-- If approve succeeded and disburse failed, Fineract held the loan APPROVED
-- while LoanApplication still said PENDING_FINANCE_APPROVAL, and every retry
-- failed because Fineract will not approve an already-approved loan. The
-- application was permanently stuck, needing manual mifos-web surgery while
-- a member waited for money.

ALTER TYPE "LoanApplicationStatus" ADD VALUE IF NOT EXISTS 'APPROVED_PENDING_DISBURSEMENT' BEFORE 'APPROVED';

ALTER TABLE "LoanApplication" ADD COLUMN IF NOT EXISTS "fineractApprovedAt" TIMESTAMP(3);

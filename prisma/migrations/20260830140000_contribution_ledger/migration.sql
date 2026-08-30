-- A per-member, per-week contribution ledger.
--
-- The cooperative's model: every week a director owes a set amount; a missed
-- week is DEFERRED interest-free rather than forgiven, and a payment covers
-- the current week first and then backfills the oldest unpaid one.
--
-- Two properties this table exists to guarantee, neither of which can be had
-- by deriving the answer from transactions on each run:
--
--   1. ONE PENALTY PER MISSED WEEK. penaltyAppliedAt is set in the same write
--      that charges it, so a re-run, a restart, a late sweep or a manual
--      contribution record cannot charge it twice. The previous check asked
--      "has any multiplier event been recorded since this period closed?" —
--      a proxy that breaks as soon as anything else writes an event.
--
--   2. IMMUTABLE HISTORY. amountDue is snapshotted when the period is
--      created. The weekly amount changes over time; reading it from config
--      at judgement time would make a rise from 20,000 to 25,000
--      retroactively turn fully-paid weeks into arrears.
CREATE TABLE "ContributionPeriod" (
    "id"                     SERIAL PRIMARY KEY,
    "clientId"               INTEGER NOT NULL,
    "periodStart"            DATE NOT NULL,
    "periodEnd"              DATE NOT NULL,
    "amountDue"              DECIMAL(14,2) NOT NULL,
    "amountPaid"             DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status"                 TEXT NOT NULL DEFAULT 'OPEN',
    "penaltyAppliedAt"       TIMESTAMP(3),
    "arrearsRewardAppliedAt" TIMESTAMP(3),
    "satisfiedAt"            TIMESTAMP(3),
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL
);

-- The constraint that makes "one row per member per week" true at the
-- database level, so a concurrent or repeated sweep cannot create a second
-- obligation for a week that already has one.
CREATE UNIQUE INDEX "ContributionPeriod_clientId_periodStart_key"
    ON "ContributionPeriod" ("clientId", "periodStart");

-- Arrears lookup: what does this member still owe, oldest first.
CREATE INDEX "ContributionPeriod_clientId_status_idx"
    ON "ContributionPeriod" ("clientId", "status");

export enum MultiplierEventType {
  LATE_CONTRIBUTION = 'LATE_CONTRIBUTION',
  ON_TIME_CONTRIBUTION = 'ON_TIME_CONTRIBUTION',
  CONSECUTIVE_ON_TIME_CONTRIBUTIONS = 'CONSECUTIVE_ON_TIME_CONTRIBUTIONS',
  /** A previously missed week has been paid off. Rewards catching up, but
   * deliberately smaller than LATE_CONTRIBUTION so a missed-then-paid week is
   * still a net loss and cannot be farmed. */
  ARREARS_CLEARED = 'ARREARS_CLEARED',

  LATE_REPAYMENT = 'LATE_REPAYMENT',
  ON_TIME_REPAYMENT = 'ON_TIME_REPAYMENT',

  EARLY_FULL_PAYOFF = 'EARLY_FULL_PAYOFF',
}

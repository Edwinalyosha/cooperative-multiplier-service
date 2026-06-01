import { MultiplierEventType } from './multiplier-event.enum';

export const MULTIPLIER_STEPS: Record<MultiplierEventType, number> = {

  // Contributions
  ON_TIME_CONTRIBUTION: 0.00,
  CONSECUTIVE_ON_TIME_CONTRIBUTIONS: 0.00,
  LATE_CONTRIBUTION: -0.02,

  // Loan repayments
  ON_TIME_REPAYMENT: 0.00,
  LATE_REPAYMENT: -0.03,

  // Strong reward
  EARLY_FULL_PAYOFF: 0.03,
};

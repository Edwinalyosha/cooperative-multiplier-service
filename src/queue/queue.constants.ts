export const MULTIPLIER_QUEUE = 'multiplier';

export enum MultiplierJobName {
  PROCESS_EVENT = 'process-event',
  REFRESH_ELIGIBILITY = 'refresh-eligibility',
  BATCH_REFRESH_ELIGIBILITY = 'batch-refresh-eligibility',
}

export interface ProcessEventJobPayload {
  clientId: number;
  eventType: string;
  triggeredBy?: string;
  notes?: string;
}

export interface RefreshEligibilityJobPayload {
  clientId: number;
}

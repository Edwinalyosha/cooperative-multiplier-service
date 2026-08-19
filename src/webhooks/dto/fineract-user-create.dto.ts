/**
 * Shape sent by the n8n workflow (MLTD_Fineract User Create Hook) for the
 * `authorisation/USER/CREATE` Fineract hook, routed through director-webapp's
 * ONBOARDING-AND-AUTH-PLAN.md pipeline.
 *
 * Deliberately NOT a class-validator DTO / NOT the type on the controller's
 * @Body() parameter: the exact Fineract hook payload shape is still
 * unconfirmed as of 2026-08-19, and the global ValidationPipe here runs with
 * `forbidNonWhitelisted: true`. A strict DTO would silently reject whatever
 * fields Fineract actually sends before we ever get to see them. The
 * controller accepts `Record<string, unknown>` instead so the raw body
 * always reaches the service layer intact.
 *
 * This interface documents the *intended* shape n8n sends once its
 * "Extract Fields" node has parsed the incoming Fineract hook body — see
 * that node's notes for why those field paths are themselves unconfirmed.
 */
export interface FineractUserCreateWebhookBody {
  username?: string;
  email?: string;
  firstname?: string;
  lastname?: string;
  /** The untouched Fineract hook body, forwarded for discovery/debugging. */
  rawPayload?: unknown;
}

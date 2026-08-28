/**
 * Safe rendering of Fineract/axios errors for logs and API responses.
 *
 * WHY THIS EXISTS: passing an axios error straight to `logger.error(msg, err)`
 * serialises the whole object — including `config.headers`, which carries
 * `Authorization: Basic <base64 user:password>`. The Fineract API credentials
 * were therefore written to `docker logs multiplier-service` in plaintext on
 * every failed call, repeated per failure, readable by anyone with docker
 * access. Found 2026-08-28 while reading unrelated logs.
 *
 * Nothing here ever touches headers, request bodies, or the raw error. Add
 * fields only from the explicit allow-list below.
 */

interface AxiosLikeError {
  message?: string;
  code?: string;
  config?: { method?: string; url?: string };
  response?: {
    status?: number;
    data?: {
      errors?: { defaultUserMessage?: string }[];
      defaultUserMessage?: string;
    };
  };
}

/** Fineract's own explanation for a refusal, if it gave one. */
function fineractMessage(error: unknown): string | undefined {
  const e = error as AxiosLikeError;
  return (
    e?.response?.data?.errors?.[0]?.defaultUserMessage ??
    e?.response?.data?.defaultUserMessage
  );
}

/**
 * For user-facing exception messages. Returns a leading-colon fragment, or a
 * full stop when Fineract said nothing useful — so callers can write
 * `` `Fineract approve failed${describeFineractError(e)}` ``.
 */
export function describeFineractError(error: unknown): string {
  const message = fineractMessage(error);
  return message ? `: ${message}` : '.';
}

/**
 * For logs. Enough to diagnose — method, path, status, Fineract's reason —
 * with no credentials.
 *
 * The URL is included because it identifies which call failed, and Fineract
 * puts no secrets in its paths. If that ever changes, strip it here.
 */
export function redactFineractError(error: unknown): string {
  const e = error as AxiosLikeError;
  const parts: string[] = [];

  const method = e?.config?.method?.toUpperCase();
  if (method && e?.config?.url) {
    parts.push(`${method} ${e.config.url}`);
  }
  if (e?.response?.status) {
    parts.push(`status=${e.response.status}`);
  }
  if (e?.code) {
    parts.push(`code=${e.code}`);
  }

  const detail = fineractMessage(error);
  if (detail) {
    parts.push(`fineract="${detail}"`);
  } else if (e?.message) {
    // axios' own message ("Request failed with status code 400",
    // "connect ECONNREFUSED") — never contains credentials.
    parts.push(`message="${e.message}"`);
  }

  return parts.length > 0 ? parts.join(' ') : 'no detail available';
}

/**
 * How a member is named on screen.
 *
 * Derived ONCE, here, rather than per page. Two screens deriving it
 * independently would drift — "Mbarak M." on one tab and "M. Mohammed" on
 * another is exactly the thing that makes an operator doubt they are looking
 * at the same person, and they cannot check without leaving the portal.
 *
 * Fineract gives us `displayName`, which is conventionally "Firstname
 * Lastname" but is a free-text field in practice: single words, three names,
 * double-barrelled surnames and stray whitespace all occur.
 */
export function shortMemberName(
  displayName: string | null | undefined,
): string | null {
  if (!displayName) return null;

  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  // One name is a whole name — "Madonna." Do not invent an initial for a
  // surname that was never given.
  if (parts.length === 1) return parts[0];

  // First name, then the initial of the LAST part. With three or more names
  // the last is the family name far more often than the middle one is, and
  // "Mbarak M." reads correctly either way.
  const first = parts[0];
  const last = parts[parts.length - 1];

  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

/**
 * Invitation links. The owner shares `https://<web host>/invite/<token>` (opens the web accept page, or this app through an
 * Android App Link); the app also answers the custom scheme `familyrecipes://invite/<token>`. The token is 64 hex characters,
 * shown once to the owner and never logged; only its SHA-256 is stored server-side.
 */
export const INVITE_TOKEN_RE = /^[0-9a-f]{64}$/;

export function buildInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${token}`;
}

/** The app-scheme form of an invite (used as a fallback link from the web accept page). */
export function buildAppInviteUrl(token: string): string {
  return `familyrecipes://invite/${token}`;
}

/** Token from `familyrecipes://invite/<t>`, `https://host/invite/<t>` or the Expo Go `exp://host/--/invite/<t>` form, else null. */
export function parseInviteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split(/[?#]/)[0] ?? '';
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/]*\/)?(?:--\/)?invite\/([^/]+)\/?$/i.exec(path);
  const token = m?.[1]?.toLowerCase();
  return token && INVITE_TOKEN_RE.test(token) ? token : null;
}

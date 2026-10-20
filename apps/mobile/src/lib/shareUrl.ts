// Recipe from a web link (P1-B, D370): picking the web address out of what Android's "Share" hands us. Browsers share
// either the bare address or "Page title https://..."; other apps add chatter around it. Pure.
const URL_RX = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Trailing punctuation a sentence puts after an address. */
const TRAILING = /[.,;:!?)\]}>'"]+$/;

/** The first http(s) address in shared text, or null. Never returns another scheme (file:, content:, javascript:...). */
export function extractUrlFromSharedText(text: string | null | undefined): string | null {
  if (!text) return null;
  const hits = text.match(URL_RX);
  if (!hits) return null;
  for (const raw of hits) {
    const candidate = raw.replace(TRAILING, '');
    try {
      const u = new URL(candidate);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) return candidate.slice(0, 2000);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** What the share-intent hook delivered -> the address to import (webUrl first, then text), or null. */
export function sharedUrlOf(intent: { webUrl?: string | null; text?: string | null } | null | undefined): string | null {
  return extractUrlFromSharedText(intent?.webUrl) ?? extractUrlFromSharedText(intent?.text);
}

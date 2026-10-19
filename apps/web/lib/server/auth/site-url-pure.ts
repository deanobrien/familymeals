export function buildInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/invite/${token}`;
}

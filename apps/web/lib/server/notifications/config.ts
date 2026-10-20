import 'server-only';
import { expoReceiptChecker, expoSender, webPushSender, type PushSender, type ReceiptChecker, type VapidConfig, type WebPushLib } from './senders';
import type { PushChannel } from './types';

/**
 * Push configuration from the environment (DEPLOY-APP-SERVICE.md 3e):
 *  - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (mailto: or https:) enable Web Push. Missing -> browsers get the
 *    in-app centre only (the settings page says so).
 *  - EXPO_ACCESS_TOKEN (optional): only when Enhanced push security is on for the Expo project. Android delivery itself
 *    depends on the FCM V1 credentials the owner uploads to EAS, not on anything here.
 *  - PUSH_DISABLED=true turns every sender off (in-app only), e.g. for a staging copy.
 */
export function readVapid(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey)) return null;
  return { publicKey, privateKey, subject };
}

export const pushDisabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.PUSH_DISABLED === 'true';

const loadWebPush = async (): Promise<WebPushLib> => {
  const m = (await import('web-push')) as unknown as { default?: WebPushLib } & WebPushLib;
  return m.default ?? m;
};

export function configuredSenders(env: NodeJS.ProcessEnv = process.env): Partial<Record<PushChannel, PushSender>> {
  if (pushDisabled(env)) return {};
  const out: Partial<Record<PushChannel, PushSender>> = { expo: expoSender({ ...(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {}) }) };
  const vapid = readVapid(env);
  if (vapid) out.webpush = webPushSender(vapid, loadWebPush);
  return out;
}

export function configuredReceipts(env: NodeJS.ProcessEnv = process.env): ReceiptChecker | undefined {
  if (pushDisabled(env)) return undefined;
  return expoReceiptChecker({ ...(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {}) });
}

/** What the clients may know: whether web push is available, and the PUBLIC VAPID key to subscribe with. */
export function publicPushConfig(env: NodeJS.ProcessEnv = process.env): { webPushPublicKey: string | null; pushEnabled: boolean } {
  const vapid = pushDisabled(env) ? null : readVapid(env);
  return { webPushPublicKey: vapid?.publicKey ?? null, pushEnabled: !pushDisabled(env) };
}

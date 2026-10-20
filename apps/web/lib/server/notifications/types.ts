// Notification platform contract (P1-C, D380-D389). Pure types + defaults; shared by the web server actions, the Bearer
// JSON routes the Android app calls, the delivery job and the tests. No server-only imports here.

export const NOTIFICATION_TYPES = [
  'expiry',
  'list_changed_while_shopping',
  'purchase_by_other',
  'item_added',
  'plan_approved',
  'recipe_added',
  'member_joined',
  'restock',
  'test',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Types a member can switch on/off (the test notification is always available). */
export type ConfigurableType = Exclude<NotificationType, 'test'>;
export const CONFIGURABLE_TYPES: readonly ConfigurableType[] = NOTIFICATION_TYPES.filter((t): t is ConfigurableType => t !== 'test');

/** Types derived from household activity (the feed); the rest are personal alerts. */
export type ActivityType = 'purchase_by_other' | 'item_added' | 'plan_approved' | 'recipe_added' | 'member_joined';
export const ACTIVITY_TYPES: readonly ActivityType[] = ['purchase_by_other', 'item_added', 'plan_approved', 'recipe_added', 'member_joined'];

export interface TypePref {
  /** Show it in my notification centre (the bell). */
  inApp: boolean;
  /** Also send it to my phone / browser. Implies inApp. */
  push: boolean;
}

/**
 * Quiet defaults (D386): only the two alerts that are useful at the moment they happen push by default (food about to
 * go off; the list changing while you are in the shop). Everything else is visible in the activity feed anyway, so it
 * is off in the centre and off as a push until a member turns it on.
 */
export const TYPE_META: Record<ConfigurableType, { label: string; hint: string; defaults: TypePref }> = {
  expiry: {
    label: 'Food to use soon',
    hint: 'A morning reminder when pantry items reach their use-by or best-before date.',
    defaults: { inApp: true, push: true },
  },
  list_changed_while_shopping: {
    label: 'List changed while you are shopping',
    hint: 'Someone adds to the list you are ticking off in the shop.',
    defaults: { inApp: true, push: true },
  },
  purchase_by_other: { label: 'Items bought by others', hint: 'Another member ticks something off.', defaults: { inApp: false, push: false } },
  item_added: { label: 'Items added to the list', hint: 'Another member adds to a shopping list.', defaults: { inApp: false, push: false } },
  plan_approved: { label: 'Meal plan approved', hint: 'The week’s plan is approved.', defaults: { inApp: false, push: false } },
  recipe_added: { label: 'New recipes', hint: 'Another member adds a recipe.', defaults: { inApp: false, push: false } },
  member_joined: { label: 'New members', hint: 'Someone joins the household.', defaults: { inApp: false, push: false } },
  restock: {
    label: 'Below minimum stock',
    hint: 'A morning nudge when items you keep a minimum of run low (not sent when auto-add to the list is on).',
    defaults: { inApp: false, push: false },
  },
};

export interface NotificationSettings {
  quietEnabled: boolean;
  /** "HH:MM", local to timeZone. */
  quietStart: string;
  quietEnd: string;
  /** IANA zone, e.g. Europe/London. */
  timeZone: string;
  /** Local hour (5-12) from which the daily expiry alert may be sent. */
  morningHour: number;
  /** Alert when the date is within this many days (0 = only on the day). */
  expiryLeadDays: number;
  types: Record<ConfigurableType, TypePref>;
}

export const DEFAULT_SETTINGS: Omit<NotificationSettings, 'types'> = {
  quietEnabled: true,
  quietStart: '21:30',
  quietEnd: '07:30',
  timeZone: 'Europe/London',
  morningHour: 8,
  expiryLeadDays: 1,
};

export function defaultTypes(): Record<ConfigurableType, TypePref> {
  const out = {} as Record<ConfigurableType, TypePref>;
  for (const t of CONFIGURABLE_TYPES) out[t] = { ...TYPE_META[t].defaults };
  return out;
}

export const defaultSettings = (): NotificationSettings => ({ ...DEFAULT_SETTINGS, types: defaultTypes() });

/** Stored overrides (any subset of types) over the defaults; push without inApp is normalised away. */
export function resolveTypes(stored: Partial<Record<string, Partial<TypePref>>> | null | undefined): Record<ConfigurableType, TypePref> {
  const out = defaultTypes();
  for (const t of CONFIGURABLE_TYPES) {
    const s = stored?.[t];
    if (!s) continue;
    const inApp = typeof s.inApp === 'boolean' ? s.inApp : out[t].inApp;
    const push = typeof s.push === 'boolean' ? s.push : out[t].push;
    out[t] = { inApp, push: inApp && push };
  }
  return out;
}

/** One row of the notification centre. */
export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** In-app path (web route; Android maps it to a screen). */
  link: string;
  createdAt: string;
  read: boolean;
}

export interface CentreView {
  items: NotificationView[];
  unread: number;
}

/** One household activity event (derived from existing logs, D387). */
export interface ActivityEventView {
  id: string;
  type: ActivityType;
  actor: string;
  /** "ticked off Milk", "approved the plan for w/c 19 Oct" */
  text: string;
  link: string;
  at: string;
  /** The signed-in member did this. */
  mine: boolean;
}

export type PushChannel = 'expo' | 'webpush';
export type DevicePlatform = 'web' | 'android';

export interface DeviceRegistration {
  platform: DevicePlatform;
  channel: PushChannel;
  /** Expo push token, or the Web Push endpoint. */
  token: string;
  /** Web Push subscription keys. */
  keys?: { p256dh: string; auth: string };
  label?: string;
}

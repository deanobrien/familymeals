import { CONSENT_WORDING_VERSION } from './schema';

/** Mirrors the planned consent_record table (PRIVACY.md section 2). */
export interface ConsentEvent {
  purpose: 'dietary_restrictions';
  wordingVersion: string;
  granted: boolean;
  at: string;
}

export interface ConsentSink {
  record(event: ConsentEvent): Promise<void>;
}

/** TODO(Supabase): write to consent_record (user_id, purpose, wording_version, granted_at, withdrawn_at). */
export class InMemoryConsentSink implements ConsentSink {
  readonly events: ConsentEvent[] = [];
  async record(event: ConsentEvent): Promise<void> {
    this.events.push(event);
  }
}

export const defaultConsentSink: ConsentSink = new InMemoryConsentSink();

export function consentEvent(granted: boolean, now: Date = new Date()): ConsentEvent {
  return {
    purpose: 'dietary_restrictions',
    wordingVersion: CONSENT_WORDING_VERSION,
    granted,
    at: now.toISOString(),
  };
}

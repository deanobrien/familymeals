-- PRJ-018 P3-B (DECISIONS D430): a SEPARATE consent type for per-person nutrition goals.
-- Goals are health-related (UK GDPR special category data), so they get their own explicit, withdrawable consent,
-- recorded in consent_records like the allergy consent. A new enum value cannot be used in the same transaction that
-- adds it, so the tables that rely on it are in the next migration (20261021003110).
alter type public.consent_type add value if not exists 'nutrition_goals';

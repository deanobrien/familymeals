import { describe, expect, it } from 'vitest';
import { APP_NAME, PLACEHOLDER_NAV } from '@fr/domain';

describe('@fr/web workspace imports', () => {
  it('resolves @fr/domain', () => {
    expect(APP_NAME).toBeTruthy();
    expect(PLACEHOLDER_NAV.map((l) => l.label)).toContain('Shopping list');
  });
});

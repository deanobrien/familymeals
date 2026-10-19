import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@fr/db', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@fr/db');
  });
});

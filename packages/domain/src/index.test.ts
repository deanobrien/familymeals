import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@fr/domain', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@fr/domain');
  });
});

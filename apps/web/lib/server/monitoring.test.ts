import { describe, expect, it } from 'vitest';
import { monitoringConnectionString, skipIncomingPath, skipOutgoing, startMonitoring } from './monitoring';

describe('monitoring (D355)', () => {
  it('is a no-op unless the connection string is set', async () => {
    expect(monitoringConnectionString({})).toBeNull();
    expect(monitoringConnectionString({ APPLICATIONINSIGHTS_CONNECTION_STRING: '   ' })).toBeNull();
    expect(await startMonitoring({})).toBe(false);
  });

  it('reads the connection string from the environment only', () => {
    expect(monitoringConnectionString({ APPLICATIONINSIGHTS_CONNECTION_STRING: ' InstrumentationKey=x ' })).toBe('InstrumentationKey=x');
  });

  it('does not trace health probes, static assets or token-bearing URLs', () => {
    for (const u of ['/api/health', '/api/health?x=1', '/_next/static/a.js', '/auth/callback?code=abc', '/api/images/a.png?sig=1', '/invite/abcd']) expect(skipIncomingPath(u)).toBe(true);
    for (const u of ['/', '/recipes', '/api/recipes?q=1', '/plan']) expect(skipIncomingPath(u)).toBe(false);
  });

  it('does not trace Supabase auth calls', () => {
    expect(skipOutgoing('/auth/v1/token?grant_type=password')).toBe(true);
    expect(skipOutgoing('/rest/v1/recipes?select=*')).toBe(false);
  });
});

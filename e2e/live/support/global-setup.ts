import { chromium, type FullConfig } from '@playwright/test';

/** Live suite: check the local stack answers, then warm the main routes (cold `next dev` compiles are slow). */
const WARM = ['/sign-in', '/sign-up', '/privacy', '/invite/' + 'a'.repeat(64)];

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3133';
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const health = await fetch(`${sb}/auth/v1/health`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' } }).catch(() => null);
  if (!health?.ok) throw new Error(`Local Supabase auth is not healthy at ${sb}. Run \`pnpm exec supabase start\`.`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of WARM) {
      const r = await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 180_000 });
      if (r && r.status() >= 500) throw new Error(`warm-up ${path} -> HTTP ${r.status()}`);
    }
  } finally {
    await browser.close();
  }
}

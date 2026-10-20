import { describeActiveProvider } from '../../../lib/server/ai/provider';
import { ImportFlow } from './import-flow';

export const metadata = { title: 'Import a recipe' };
// Which AI provider is active depends on server-side settings, so render per request.
export const dynamic = 'force-dynamic';

/** `?url=` pre-fills the web address (for a bookmarklet or a shared link); the user still presses the button. */
export default async function Page({ searchParams }: { searchParams: Promise<{ url?: string | string[] }> }) {
  const active = await describeActiveProvider();
  const u = (await searchParams).url;
  const initialUrl = (Array.isArray(u) ? u[0] : u)?.slice(0, 2000);
  return (
    <>
      <h1>Import a recipe</h1>
      <p>Paste a link to a recipe page, or photograph a recipe card or book page. You will review everything before it is saved.</p>
      <ImportFlow provider={{ label: active.label, isMock: active.isMock, configured: active.configured }} {...(initialUrl ? { initialUrl } : {})} />
    </>
  );
}

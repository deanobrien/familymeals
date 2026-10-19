import { describeActiveProvider } from '../../../lib/server/ai/provider';
import { ImportFlow } from './import-flow';

export const metadata = { title: 'Import a recipe' };
// Which AI provider is active depends on server-side settings, so render per request.
export const dynamic = 'force-dynamic';

export default function Page() {
  const active = describeActiveProvider();
  return (
    <>
      <h1>Import a recipe from photos</h1>
      <p>Photograph or upload up to 6 pages of a recipe card or book page. You will review everything before it is saved.</p>
      <ImportFlow provider={{ label: active.label, isMock: active.isMock, configured: active.configured }} />
    </>
  );
}

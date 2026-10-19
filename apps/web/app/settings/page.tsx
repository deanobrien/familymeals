import { loadAiSettingsAction } from './ai-actions';
import { recipeSourceStatus } from '../../lib/server/discover/source';
import { SettingsView } from './settings-view';

export const metadata = { title: 'Settings' };
// AI provider settings come from a server-side file, so never prerender this page.
export const dynamic = 'force-dynamic';

export default async function Page() {
  return <SettingsView ai={await loadAiSettingsAction()} recipeSource={recipeSourceStatus()} />;
}

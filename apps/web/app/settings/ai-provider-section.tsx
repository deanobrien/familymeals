'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Card, ConfirmDialog, Input, Select } from '@fr/ui';
import s from '../../lib/dashboard/dashboard.module.css';
import type { ActiveProviderInfo } from '../../lib/server/ai/provider';
import type { KeyedProvider, ProviderChoice, PublicAiSettings } from '../../lib/server/ai/settings-store';
import {
  loadAiSettingsAction, removeAiKeyAction, saveAiSettingsAction, testAiConnectionAction,
  type AiSettingsView,
} from './ai-actions';

const PROVIDER_OPTIONS: Array<{ value: ProviderChoice; label: string }> = [
  { value: 'mock', label: 'Sample data (mock, no real AI)' },
  { value: 'openai', label: 'OpenAI (ChatGPT) or compatible endpoint' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
];

type Notice = { tone: 'ok' | 'error'; text: string } | null;

interface FormState {
  provider: ProviderChoice;
  openaiBaseUrl: string; openaiModel: string; openaiOrg: string;
  azureEndpoint: string; azureDeployment: string; azureApiVersion: string;
  anthropicModel: string;
  /** Typed-in new keys (never pre-filled). Cleared after every save. */
  keys: Record<KeyedProvider, string>;
}

const emptyKeys = (): FormState['keys'] => ({ openai: '', azure: '', anthropic: '' });

function toForm(p: PublicAiSettings): FormState {
  return {
    provider: p.provider,
    openaiBaseUrl: p.openai.baseUrl, openaiModel: p.openai.model, openaiOrg: p.openai.organization,
    azureEndpoint: p.azure.endpoint, azureDeployment: p.azure.deployment, azureApiVersion: p.azure.apiVersion,
    anthropicModel: p.anthropic.model,
    keys: emptyKeys(),
  };
}

function sourceText(a: ActiveProviderInfo): string {
  return a.source === 'settings' ? 'saved in Settings' : a.source === 'env' ? 'from server environment variables' : 'development default';
}

/**
 * Settings > AI provider. Household-level for now (TODO(Supabase): per-household row, key in a vault).
 * The key input is write-only: the server never sends a key back, only a masked hint.
 */
export function AiProviderSection({ initial }: { initial?: AiSettingsView }) {
  const [data, setData] = useState<AiSettingsView | null>(initial ?? null);
  const [form, setForm] = useState<FormState | null>(initial ? toForm(initial.settings) : null);
  /** Providers whose key field is open ("Replace key" / no key yet). */
  const [replacing, setReplacing] = useState<Record<KeyedProvider, boolean>>({ openai: false, azure: false, anthropic: false });
  const [notice, setNotice] = useState<Notice>(null);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<KeyedProvider | null>(null);

  useEffect(() => {
    if (initial) return;
    void loadAiSettingsAction().then((v) => { setData(v); setForm(toForm(v.settings)); });
  }, [initial]);

  if (!data || !form) {
    return (
      <Card>
        <section className={s.card} aria-labelledby="h-ai-provider">
          <h2 id="h-ai-provider">AI provider</h2>
          <p className={s.muted} role="status">Loading...</p>
        </section>
      </Card>
    );
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setKey = (kind: KeyedProvider, v: string) => setForm((f) => (f ? { ...f, keys: { ...f.keys, [kind]: v } } : f));
  const { settings, active } = data;
  const p = form.provider;
  const keyState = p === 'mock' ? undefined : settings.keys[p];
  const keyOpen = p !== 'mock' && (replacing[p] || !keyState?.hasKey);

  function apply(view: AiSettingsView) {
    setData(view);
    setForm(toForm(view.settings));
    setReplacing({ openai: false, azure: false, anthropic: false });
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy('save');
    setNotice(null);
    setFieldError(null);
    const payload = {
      provider: form!.provider,
      openai: { baseUrl: form!.openaiBaseUrl, model: form!.openaiModel, organization: form!.openaiOrg, apiKey: form!.keys.openai },
      azure: { endpoint: form!.azureEndpoint, deployment: form!.azureDeployment, apiVersion: form!.azureApiVersion, apiKey: form!.keys.azure },
      anthropic: { model: form!.anthropicModel, apiKey: form!.keys.anthropic },
    };
    try {
      const res = await saveAiSettingsAction(payload);
      if (res.ok) {
        apply(res.view);
        setNotice({ tone: 'ok', text: 'AI provider settings saved.' });
      } else {
        setFieldError({ message: res.message, ...(res.field ? { field: res.field } : {}) });
      }
    } catch {
      setFieldError({ message: 'Could not save. Please try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setNotice(null);
    setFieldError(null);
    try {
      const r = await testAiConnectionAction();
      setNotice(r.ok
        ? { tone: 'ok', text: `Connection works: ${r.label} replied in ${(r.ms / 1000).toFixed(1)}s.` }
        : { tone: 'error', text: r.message });
    } catch {
      setNotice({ tone: 'error', text: 'The test could not run. Please try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function removeKey(kind: KeyedProvider) {
    setBusy('remove');
    setConfirmRemove(null);
    setNotice(null);
    try {
      const res = await removeAiKeyAction(kind);
      if (res.ok) { apply(res.view); setNotice({ tone: 'ok', text: 'Key removed.' }); }
      else setFieldError({ message: res.message });
    } finally {
      setBusy(null);
    }
  }

  const err = (field: string) => (fieldError?.field === field ? fieldError.message : undefined);
  const unsaved = JSON.stringify({ ...form, keys: undefined }) !== JSON.stringify({ ...toForm(settings), keys: undefined }) || Object.values(form.keys).some(Boolean);

  return (
    <Card>
      <form className={`${s.card} ${s.form}`} onSubmit={save} noValidate aria-labelledby="h-ai-provider">
        <h2 id="h-ai-provider">AI provider</h2>
        <p className={s.muted}>
          Used to read recipe photos (and a few other helpers). This is a household-level setting. Your key is sent to
          the server only, stored encrypted, and never shown again; you will only see a masked hint.
        </p>
        <p data-testid="ai-active" className={s.muted}>
          Currently using: <strong>{active.label}</strong> <Badge tone={active.configured ? 'success' : 'warning'}>{sourceText(active)}</Badge>
          {active.problem && <span role="status"> {active.problem}</span>}
        </p>
        {settings.storageProblem && (
          <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>{settings.storageProblem}</p>
        )}

        <Select
          label="Provider"
          value={p}
          onChange={(e) => set('provider', e.target.value as ProviderChoice)}
          options={PROVIDER_OPTIONS}
          hint="Saved settings override environment variables. Nothing is sent anywhere until you pick a real provider."
        />

        {p === 'mock' && (
          <p className={s.muted}>
            The mock returns a fixed sample recipe whatever photo you give it. Use it for demos and testing the screens;
            choose a real provider to read your own recipe cards.
          </p>
        )}

        {p === 'openai' && (
          <>
            <Input label="Endpoint (base URL)" value={form.openaiBaseUrl} onChange={(e) => set('openaiBaseUrl', e.target.value)}
              hint={`Default ${settings.defaults.openaiBaseUrl}. Change it for a proxy or another OpenAI-compatible server.`} error={err('openai.baseUrl')} autoComplete="off" />
            <Input label="Model" value={form.openaiModel} onChange={(e) => set('openaiModel', e.target.value)}
              hint={`Free text. It must support image input. Default ${settings.defaults.openaiModel}; for example gpt-4o also works.`} error={err('openai.model')} autoComplete="off" />
            <Input label="Organisation (optional)" value={form.openaiOrg} onChange={(e) => set('openaiOrg', e.target.value)} error={err('openai.organization')} autoComplete="off" />
          </>
        )}

        {p === 'azure' && (
          <>
            <Input label="Azure endpoint" value={form.azureEndpoint} onChange={(e) => set('azureEndpoint', e.target.value)}
              hint="For example https://my-resource.openai.azure.com" error={err('endpoint') ?? err('azure.endpoint')} autoComplete="off" />
            <Input label="Deployment name" value={form.azureDeployment} onChange={(e) => set('azureDeployment', e.target.value)}
              hint="The name of your model deployment (not the model family). It must be a vision-capable model." error={err('deployment') ?? err('azure.deployment')} autoComplete="off" />
            <Input label="API version" value={form.azureApiVersion} onChange={(e) => set('azureApiVersion', e.target.value)}
              hint={`Default ${settings.defaults.azureApiVersion}.`} error={err('azure.apiVersion')} autoComplete="off" />
          </>
        )}

        {p === 'anthropic' && (
          <Input label="Model" value={form.anthropicModel} onChange={(e) => set('anthropicModel', e.target.value)}
            hint={`Free text. Default ${settings.defaults.anthropicModel}.`} error={err('anthropic.model')} autoComplete="off" />
        )}

        {p !== 'mock' && (
          <div data-testid="ai-key-block" style={{ display: 'grid', gap: 'var(--fr-space-2)' }}>
            {keyState?.hasKey && !replacing[p] && (
              <>
                <p style={{ margin: 0 }} data-testid="ai-key-saved">
                  API key saved: <code>{keyState.hint}</code>
                </p>
                <div className={s.row}>
                  <Button variant="secondary" size="sm" onClick={() => setReplacing((r) => ({ ...r, [p]: true }))}>Replace key</Button>
                  <Button variant="secondary" size="sm" onClick={() => setConfirmRemove(p)}>Remove key</Button>
                </div>
              </>
            )}
            {keyState?.unreadable && (
              <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>The saved key can no longer be decrypted (the server secret changed). Enter it again.</p>
            )}
            {keyState?.fromEnv && !keyState.hasKey && (
              <p className={s.muted}>A key is set in the server environment and will be used unless you save one here.</p>
            )}
            {keyOpen && (
              <Input
                label={keyState?.hasKey ? 'New API key' : 'API key'}
                type="password"
                value={form.keys[p]}
                onChange={(e) => setKey(p, e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                hint="Paste the key here. It is stored encrypted on the server and cannot be viewed again."
                error={err('apiKey') ?? err(`${p}.apiKey`)}
              />
            )}
          </div>
        )}

        {fieldError && !fieldError.field && <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>{fieldError.message}</p>}
        {fieldError?.field && !['apiKey', 'endpoint', 'deployment'].includes(fieldError.field) && !fieldError.field.includes('.') && (
          <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>{fieldError.message}</p>
        )}
        {notice && (
          <p role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="ai-notice" style={{ margin: 0, color: notice.tone === 'error' ? 'var(--fr-danger)' : 'var(--fr-success)' }}>
            {notice.text}
          </p>
        )}

        <div className={s.row}>
          <Button type="submit" loading={busy === 'save'} disabled={busy !== null}>Save AI settings</Button>
          <Button variant="secondary" onClick={() => void test()} loading={busy === 'test'} disabled={busy !== null || unsaved}>Test connection</Button>
          {unsaved && <span className={s.muted}>Save first, then test the saved settings.</span>}
        </div>
      </form>
      <ConfirmDialog
        open={confirmRemove !== null}
        onOpenChange={(o) => { if (!o) setConfirmRemove(null); }}
        title="Remove the saved API key?"
        description="The key is deleted from this server. AI features that need it stop working until you add one again."
        confirmLabel="Remove key"
        destructive
        onConfirm={() => { if (confirmRemove) void removeKey(confirmRemove); }}
      />
    </Card>
  );
}

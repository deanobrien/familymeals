'use client';

import { useActionState } from 'react';
import { Button } from '@fr/ui';
import { uploadReceiptAction, type UploadState } from './actions';

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadReceiptAction, {});
  return (
    <form action={action} style={{ display: 'grid', gap: 'var(--fr-space-3, 12px)', maxWidth: 480 }}>
      <div className="fr-field">
        <label htmlFor="receipt-file" className="fr-field__label">Receipt photo</label>
        <input
          id="receipt-file"
          name="receipt"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="fr-control"
          required
        />
        <span className="fr-field__hint">Take a photo or choose an image (JPEG, PNG or WebP). Nothing is marked as bought until you confirm it.</span>
        {state.error && <span role="alert" className="fr-field__error">{state.error}</span>}
      </div>
      <div>
        <Button type="submit" loading={pending}>Scan receipt</Button>
      </div>
    </form>
  );
}

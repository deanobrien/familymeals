'use client';

import { useActionState, useRef, useState } from 'react';
import { Button } from '@fr/ui';
import { downscaleImage } from '../../lib/images/downscale';
import { PhoneScannerPanel } from '../phone-scanner-panel';
import { uploadReceiptAction, type UploadState } from './actions';

export function UploadForm({ phoneRealtime = false }: { phoneRealtime?: boolean }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadReceiptAction, {});
  const input = useRef<HTMLInputElement | null>(null);
  const [fromPhone, setFromPhone] = useState<string | null>(null);
  /** A photo the phone sent (P3-C, D447): it becomes the chosen receipt photo, exactly as if picked here. The latest one wins. */
  async function usePhonePhoto(file: File) {
    const el = input.current;
    if (!el) return;
    const small = await downscaleImage(file);
    const dt = new DataTransfer();
    dt.items.add(small);
    el.files = dt.files;
    setFromPhone('Using the photo from your phone. Check it, then press Scan receipt. If you take another, the latest one is used.');
  }
  return (
    <div style={{ display: 'grid', gap: 'var(--fr-space-3, 12px)', maxWidth: 480 }}>
    <PhoneScannerPanel purpose="receipt" realtime={phoneRealtime} what="photograph the receipt" onPhoto={usePhonePhoto} />
    <form action={action} style={{ display: 'grid', gap: 'var(--fr-space-3, 12px)' }}>
      <div className="fr-field">
        <label htmlFor="receipt-file" className="fr-field__label">Receipt photo</label>
        <input
          id="receipt-file"
          ref={input}
          name="receipt"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="fr-control"
          required
          onChange={async (e) => {
            // Shrink big phone photos in the browser before the server action upload.
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            const small = await downscaleImage(file);
            if (small === file) return;
            const dt = new DataTransfer();
            dt.items.add(small);
            input.files = dt.files;
          }}
        />
        <span className="fr-field__hint">Take a photo or choose an image (JPEG, PNG or WebP). Nothing is marked as bought until you confirm it.</span>
        {fromPhone && <span role="status" className="fr-field__hint" data-testid="receipt-from-phone">{fromPhone}</span>}
        {state.error && <span role="alert" className="fr-field__error">{state.error}</span>}
      </div>
      <div>
        <Button type="submit" loading={pending}>Scan receipt</Button>
      </div>
    </form>
    </div>
  );
}

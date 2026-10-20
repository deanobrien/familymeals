'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardBody } from '@fr/ui';
import { downscaleAll } from '../../../lib/images/downscale';
import { rotateImageFile } from '../../recipes/import/upload-step';
import s from './scan.module.css';

export const MAX_LIST_PHOTOS = 4;

export interface ListPhoto {
  id: number;
  file: File;
  url: string;
}

interface Props {
  photos: ListPhoto[];
  onChange: (next: ListPhoto[] | ((cur: ListPhoto[]) => ListPhoto[])) => void;
  nextId: () => number;
  disabled?: boolean;
  onScan: () => void;
}

/**
 * Capture: 1-4 photos of the paper list (the two pages, or a close-up of a margin note). Photos are shrunk in the
 * browser before upload (EXIF orientation baked in) and each can be turned with Rotate, exactly like recipe import.
 */
export function CaptureStep({ photos, onChange, nextId, disabled, onScan }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = [...list].filter((f) => f.type === '' || f.type.startsWith('image/'));
    const room = MAX_LIST_PHOTOS - photos.length;
    const accepted = incoming.slice(0, Math.max(0, room));
    setNotice(
      incoming.length < list.length
        ? 'Only photos can be added here.'
        : incoming.length > room
          ? `You can scan up to ${MAX_LIST_PHOTOS} photos of a list at a time; extra photos were ignored.`
          : null,
    );
    if (accepted.length === 0) return;
    setWorking('Preparing photos...');
    const files = await downscaleAll(accepted);
    setWorking(null);
    onChange((cur) => [...cur, ...files.map((file): ListPhoto => ({ id: nextId(), file, url: URL.createObjectURL(file) }))]);
  }

  async function rotate(id: number) {
    const target = photos.find((p) => p.id === id);
    if (!target) return;
    setWorking('Turning the photo...');
    setNotice(null);
    try {
      const file = await rotateImageFile(target.file, 1);
      const url = URL.createObjectURL(file);
      onChange((cur) => cur.map((p) => {
        if (p.id !== id) return p;
        URL.revokeObjectURL(p.url);
        return { ...p, file, url };
      }));
    } catch {
      setNotice('That photo could not be turned here. Try rotating it in your photos app first.');
    } finally {
      setWorking(null);
    }
  }

  function remove(id: number) {
    onChange((cur) => {
      const gone = cur.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((p) => p.id !== id);
    });
  }

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    void add(e.target.files);
    e.target.value = '';
  };

  return (
    <div className={s.stack}>
      <Card>
        <CardBody>
          <div className={s.stack}>
            <div className={s.actions}>
              <label className="fr-btn fr-btn--primary fr-btn--md" style={{ cursor: 'pointer' }}>
                Take a photo
                <input type="file" accept="image/*" capture="environment" data-testid="camera-input" className="fr-visually-hidden" onChange={pick} disabled={disabled || !!working} />
              </label>
              <label className="fr-btn fr-btn--secondary fr-btn--md" style={{ cursor: 'pointer' }}>
                Choose photos
                <input type="file" accept="image/*" multiple data-testid="photo-input" className="fr-visually-hidden" onChange={pick} disabled={disabled || !!working} />
              </label>
              <Badge>{photos.length} of {MAX_LIST_PHOTOS}</Badge>
            </div>
            <p className={s.muted}>
              Lay the list flat in good light so the writing fills the picture. If it runs over two pages or has notes in
              the margin, add a photo of each. If a photo is sideways, turn it with Rotate.
            </p>
            {working && <p role="status" data-testid="capture-working">{working}</p>}
            {notice && <p role="status" data-testid="capture-notice">{notice}</p>}
          </div>
        </CardBody>
      </Card>

      {photos.length > 0 && (
        <ul className={s.thumbs} aria-label="Photos of your list" data-testid="thumbs">
          {photos.map((p, idx) => (
            <li key={p.id} className={s.thumb} data-testid="thumb">
              <img src={p.url} alt={`Photo ${idx + 1} of your list`} />
              <div className={s.thumbCaption}>
                <span>Photo {idx + 1}</span>
                <span>
                  <Button variant="ghost" size="sm" aria-label={`Rotate photo ${idx + 1} clockwise`} disabled={disabled || !!working} onClick={() => void rotate(p.id)}>Rotate</Button>
                  <Button variant="ghost" size="sm" aria-label={`Remove photo ${idx + 1}`} disabled={disabled} onClick={() => remove(p.id)}>Remove</Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={s.actions}>
        <Button disabled={photos.length === 0 || disabled || !!working} onClick={onScan}>
          {photos.length === 0 ? 'Read my list' : `Read my list (${photos.length} ${photos.length === 1 ? 'photo' : 'photos'})`}
        </Button>
      </div>
    </div>
  );
}

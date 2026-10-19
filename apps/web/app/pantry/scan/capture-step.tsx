'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardBody } from '@fr/ui';
import { extractVideoFrames } from '../../../lib/pantry/video-frames';
import s from './scan.module.css';

export const MAX_SCAN_IMAGES = 10;

export interface ScanImage {
  id: number;
  file: File;
  url: string;
  source: 'photo' | 'frame';
}

interface Props {
  images: ScanImage[];
  onChange: (next: ScanImage[] | ((cur: ScanImage[]) => ScanImage[])) => void;
  nextId: () => number;
  disabled?: boolean;
  onScan: () => void;
}

/**
 * Capture: several photos and/or one video. A video is turned into 6-10 sharp frames IN THE BROWSER (the clip is
 * never uploaded). Everything chosen is shown as a thumbnail before it is sent (D82).
 */
export function CaptureStep({ images, onChange, nextId, disabled, onScan }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  function addPhotos(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = [...list].filter((f) => f.type === '' || f.type.startsWith('image/'));
    const room = MAX_SCAN_IMAGES - images.length;
    const accepted = incoming.slice(0, Math.max(0, room));
    setNotice(
      incoming.length < list.length
        ? 'Only photos and video can be added here.'
        : incoming.length > room
          ? `You can scan up to ${MAX_SCAN_IMAGES} photos or frames at a time; extra photos were ignored.`
          : null,
    );
    onChange((cur) => [
      ...cur,
      ...accepted.map((file): ScanImage => ({ id: nextId(), file, url: URL.createObjectURL(file), source: 'photo' })),
    ]);
  }

  async function addVideo(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setNotice(null);
    const room = MAX_SCAN_IMAGES - images.length;
    if (room <= 0) {
      setNotice(`You already have ${MAX_SCAN_IMAGES} photos. Remove some to add a video.`);
      return;
    }
    setWorking('Picking the sharpest frames from your video...');
    try {
      const frames = await extractVideoFrames(file, { frames: Math.min(room, 10), onProgress: (d, t) => setWorking(`Picking the sharpest frames... ${d} of ${t}`) });
      onChange((cur) => [
        ...cur,
        ...frames.map((f): ScanImage => ({ id: nextId(), file: f.file, url: URL.createObjectURL(f.file), source: 'frame' })),
      ]);
      setNotice(`Picked ${frames.length} frames from your video. Only these frames are sent, never the video.`);
    } catch {
      setNotice('That video could not be read in this browser. Try a shorter clip, or take photos instead.');
    } finally {
      setWorking(null);
    }
  }

  function remove(id: number) {
    onChange((cur) => {
      const gone = cur.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((i) => i.id !== id);
    });
  }

  const pick = (fn: (l: FileList | null) => void | Promise<void>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    void fn(e.target.files);
    e.target.value = '';
  };

  return (
    <div className={s.stack}>
      <Card>
        <CardBody>
          <div className={s.stack}>
            <div className={s.actions}>
              <label className="fr-btn fr-btn--secondary fr-btn--md" style={{ cursor: 'pointer' }}>
                Choose photos
                <input type="file" accept="image/*" multiple data-testid="photo-input" className="fr-visually-hidden" onChange={pick(addPhotos)} disabled={disabled || !!working} />
              </label>
              <label className="fr-btn fr-btn--secondary fr-btn--md" style={{ cursor: 'pointer' }}>
                Take a photo
                <input type="file" accept="image/*" capture="environment" data-testid="camera-input" className="fr-visually-hidden" onChange={pick(addPhotos)} disabled={disabled || !!working} />
              </label>
              <label className="fr-btn fr-btn--secondary fr-btn--md" style={{ cursor: 'pointer' }}>
                Record or choose a video
                <input type="file" accept="video/*" capture="environment" data-testid="video-input" className="fr-visually-hidden" onChange={pick(addVideo)} disabled={disabled || !!working} />
              </label>
              <Badge>{images.length} of {MAX_SCAN_IMAGES}</Badge>
            </div>
            <p className={s.muted}>
              Pan slowly across the shelf for a video, or add several photos from different angles: the same item in more
              than one picture is only counted once. Dates are read best from close-up photos, so take one of any label you
              want read.
            </p>
            {working && <p role="status" data-testid="video-working">{working}</p>}
            {notice && <p role="status" data-testid="capture-notice">{notice}</p>}
          </div>
        </CardBody>
      </Card>

      {images.length > 0 && (
        <ul className={s.thumbs} aria-label="Photos and frames to scan" data-testid="thumbs">
          {images.map((img, idx) => { const label = `${img.source === 'frame' ? 'Frame' : 'Photo'} ${idx + 1}`; return (
            <li key={img.id} className={s.thumb} data-testid="thumb">
              <img src={img.url} alt={`${label} to scan`} />
              <div className={s.thumbCaption}>
                <span>{label}</span>
                <Button variant="ghost" size="sm" aria-label={`Remove ${label}`} disabled={disabled} onClick={() => remove(img.id)}>Remove</Button>
              </div>
            </li>
          ); })}
        </ul>
      )}

      <div className={s.actions}>
        <Button disabled={images.length === 0 || disabled || !!working} onClick={onScan}>
          {images.length === 0 ? 'Scan' : `Scan ${images.length} ${images.length === 1 ? 'image' : 'images'}`}
        </Button>
      </div>
    </div>
  );
}

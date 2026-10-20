import * as ImageManipulator from 'expo-image-manipulator';

/** Mirrors the web app's `/api/extract` limit (apps/web/app/api/extract/route.ts MAX_FILES). Change together. */
export const MAX_IMAGES = 6;
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.8;

export interface CapturedImage {
  uri: string;
  width: number;
  height: number;
}

export interface UploadImage extends CapturedImage {
  name: string;
  mimeType: 'image/jpeg';
}

export type Resizer = (img: CapturedImage) => Promise<CapturedImage>;
export type Rotator = (img: CapturedImage) => Promise<CapturedImage>;

/** Downscale (longest edge <= MAX_EDGE_PX) and re-encode as JPEG so uploads stay small. */
export const defaultResizer: Resizer = async (img) => {
  const longest = Math.max(img.width, img.height);
  const actions: ImageManipulator.Action[] =
    longest > MAX_EDGE_PX
      ? [{ resize: img.width >= img.height ? { width: MAX_EDGE_PX } : { height: MAX_EDGE_PX } }]
      : [];
  const out = await ImageManipulator.manipulateAsync(img.uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: out.uri, width: out.width, height: out.height };
};

/** Turn a captured page 90 degrees clockwise (phones often save landscape pages sideways). */
export const defaultRotator: Rotator = async (img) => {
  const out = await ImageManipulator.manipulateAsync(img.uri, [{ rotate: 90 }], {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: out.uri, width: out.width, height: out.height };
};

export async function prepareForUpload(
  images: CapturedImage[],
  resize: Resizer = defaultResizer,
  /** The route's own limit: recipe 6 (default), pantry scan 10, handwritten list 4, receipt 1. */
  max: number = MAX_IMAGES,
): Promise<UploadImage[]> {
  if (images.length === 0) throw new Error('No images captured');
  if (images.length > max) throw new Error(`At most ${max} images at a time`);
  const out: UploadImage[] = [];
  for (let i = 0; i < images.length; i++) {
    const r = await resize(images[i] as CapturedImage);
    out.push({ ...r, name: `page-${i + 1}.jpg`, mimeType: 'image/jpeg' });
  }
  return out;
}

/**
 * Multipart body for the scan endpoints (`/api/pantry/scan`, `/api/shopping/scan`, `/api/receipts`): `householdId`,
 * optional extra text fields (e.g. `focus`), and each photo under `field` (default `images`).
 */
export function buildImagesForm(householdId: string, images: UploadImage[], extra: Record<string, string> = {}, field = 'images'): FormData {
  const form = new FormData();
  form.append('householdId', householdId);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  for (const img of images) form.append(field, { uri: img.uri, name: img.name, type: img.mimeType } as unknown as Blob);
  return form;
}

/** Multipart body for the server extraction endpoint (React Native file-part shape). Field names match the web route. */
export function buildExtractionForm(householdId: string, images: UploadImage[]): FormData {
  const form = new FormData();
  form.append('householdId', householdId);
  for (const img of images) {
    // React Native's FormData accepts { uri, name, type } as a file part.
    form.append('images', { uri: img.uri, name: img.name, type: img.mimeType } as unknown as Blob);
  }
  return form;
}

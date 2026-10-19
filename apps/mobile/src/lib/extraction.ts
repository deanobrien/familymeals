import * as ImageManipulator from 'expo-image-manipulator';

/** Limits mirror the server AI gateway's image limits (L4). Adjust together. */
export const MAX_IMAGES = 8;
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

export async function prepareForUpload(
  images: CapturedImage[],
  resize: Resizer = defaultResizer,
): Promise<UploadImage[]> {
  if (images.length === 0) throw new Error('No images captured');
  if (images.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per recipe`);
  const out: UploadImage[] = [];
  for (let i = 0; i < images.length; i++) {
    const r = await resize(images[i] as CapturedImage);
    out.push({ ...r, name: `page-${i + 1}.jpg`, mimeType: 'image/jpeg' });
  }
  return out;
}

/** Multipart body for the server extraction endpoint (React Native file-part shape). */
export function buildExtractionForm(householdId: string, images: UploadImage[]): FormData {
  const form = new FormData();
  form.append('householdId', householdId);
  for (const img of images) {
    // React Native's FormData accepts { uri, name, type } as a file part.
    form.append('images', { uri: img.uri, name: img.name, type: img.mimeType } as unknown as Blob);
  }
  return form;
}

export interface ExtractionSubmitResult {
  status: 'stubbed' | 'accepted';
  imageCount: number;
  /** Server-side extraction job / draft-recipe id (L13). Stubbed locally. */
  jobId: string;
}

/**
 * STUB. TODO(L13): POST the form from buildExtractionForm to the server extraction endpoint
 * (`${EXPO_PUBLIC_API_BASE_URL}/api/recipes/extract`) with the Supabase access token as a Bearer
 * header. The AI provider key stays server-side; the app never calls an AI provider directly.
 */
export async function submitExtraction(householdId: string, images: UploadImage[]): Promise<ExtractionSubmitResult> {
  buildExtractionForm(householdId, images); // validates the payload shape
  await Promise.resolve();
  return { status: 'stubbed', imageCount: images.length, jobId: `stub-${Date.now()}` };
}

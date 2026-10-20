import React, { useMemo, useRef, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '@/data/AppContext';
import {
  MAX_IMAGES,
  defaultRotator,
  prepareForUpload,
  type CapturedImage,
  type Resizer,
  type Rotator,
} from '@/lib/extraction';
import { createImportClient, type ExtractionOutcome, type ImportClient } from '@/lib/importApi';
import { createProductClient, type ProductClient } from '@/lib/productApi';
import BarcodeLookup from './BarcodeLookup';
import { useRouter } from 'expo-router';
import ImportReviewScreen from './ImportReviewScreen';
import { Button, EmptyState, ErrorText, Loading, Muted, Text, useStyles } from './ui';

export default function CaptureScreen({
  resizer,
  rotator = defaultRotator,
  importClient,
  productClient,
}: {
  resizer?: Resizer;
  rotator?: Rotator;
  importClient?: ImportClient;
  productClient?: ProductClient;
}) {
  const { ds, householdId } = useApp();
  const styles = useStyles();
  const client = useMemo(
    () =>
      importClient ??
      createImportClient({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() }),
    [importClient, ds],
  );
  const products = useMemo(
    () =>
      productClient ??
      createProductClient({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() }),
    [productClient, ds],
  );
  const [barcodeMode, setBarcodeMode] = useState(false);
  // Continuous barcode scanning lives in Scan groceries (/pantry/scan), where the tally is reviewed and confirmed (D344).
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [outcome, setOutcome] = useState<ExtractionOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const full = images.length >= MAX_IMAGES;

  async function snap() {
    const pic = await camera.current?.takePictureAsync({ quality: 0.9 });
    if (pic) setImages((xs) => [...xs, { uri: pic.uri, width: pic.width, height: pic.height }].slice(0, MAX_IMAGES));
  }

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - images.length,
      quality: 0.9,
    });
    if (!res.canceled) {
      setImages((xs) =>
        [...xs, ...res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))].slice(0, MAX_IMAGES),
      );
    }
  }

  async function rotate(index: number) {
    try {
      const img = images[index];
      if (!img) return;
      const turned = await rotator(img);
      setImages((xs) => xs.map((x, i) => (i === index ? turned : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate the photo');
    }
  }

  async function send() {
    if (!householdId) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareForUpload(images, resizer);
      setOutcome(await client.extract(householdId, prepared));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  if (!householdId) return <EmptyState title="Pick a household first." />;

  if (busy) return <Loading label="Reading your recipe. This can take a moment" />;

  if (barcodeMode) return <BarcodeLookup client={products} householdId={householdId} onClose={() => setBarcodeMode(false)} />;

  if (outcome) {
    return (
      <ImportReviewScreen
        outcome={outcome}
        client={client}
        pages={images}
        onDone={() => {
          setOutcome(null);
          setImages([]);
        }}
        onBack={() => setOutcome(null)}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Capture a recipe
      </Text>
      <Muted>Photograph each page in order. Up to {MAX_IMAGES} photos.</Muted>

      {cameraOn && permission?.granted && (
        <View style={{ height: 320, marginVertical: 12 }}>
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" accessibilityLabel="Camera preview" />
          <Button title="Take photo" onPress={snap} disabled={full} testID="take-photo" />
        </View>
      )}
      {!cameraOn && (
        <Button
          title="Open camera"
          testID="open-camera"
          onPress={async () => {
            if (!permission?.granted) {
              const p = await requestPermission();
              if (!p.granted) {
                setError('Camera permission denied. You can still choose photos from your library.');
                return;
              }
            }
            setCameraOn(true);
          }}
        />
      )}
      <Button title="Scan many barcodes" onPress={() => router.push('/pantry/scan?mode=barcodes')} testID="open-rapid" variant="secondary" />
      <Button title="Scan a product barcode" onPress={() => setBarcodeMode(true)} testID="open-barcode" variant="secondary" />
      <Button title="Choose from library" onPress={pick} disabled={full} testID="pick-image" variant="secondary" />

      {images.map((img, i) => (
        <View
          key={img.uri + i}
          style={[styles.row, { justifyContent: 'flex-start' }]}
          testID={`page-${i + 1}`}
          accessible={false}
        >
          <Image
            source={{ uri: img.uri }}
            style={{ width: 72, height: 72, marginRight: 12, borderRadius: 4 }}
            accessibilityLabel={`Page ${i + 1} preview`}
          />
          <View style={{ flex: 1 }}>
            <Text>Page {i + 1}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Rotate"
                  accessibilityLabel={`Rotate page ${i + 1}`}
                  onPress={() => rotate(i)}
                  variant="secondary"
                  testID={`rotate-${i + 1}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Remove"
                  accessibilityLabel={`Remove page ${i + 1}`}
                  onPress={() => setImages((xs) => xs.filter((_, j) => j !== i))}
                  variant="secondary"
                  testID={`remove-${i + 1}`}
                />
              </View>
            </View>
          </View>
        </View>
      ))}
      <Text testID="image-count" style={{ marginVertical: 8 }}>
        {images.length} image(s) ready
      </Text>

      <ErrorText message={error} />
      <Button title="Send for extraction" onPress={send} disabled={images.length === 0} testID="send-extraction" />
    </ScrollView>
  );
}

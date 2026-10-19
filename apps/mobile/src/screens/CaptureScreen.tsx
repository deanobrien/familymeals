import React, { useRef, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '@/data/AppContext';
import {
  MAX_IMAGES,
  prepareForUpload,
  submitExtraction,
  type CapturedImage,
  type ExtractionSubmitResult,
  type Resizer,
} from '@/lib/extraction';
import { Button, ErrorText, styles } from './ui';

export default function CaptureScreen({ resizer }: { resizer?: Resizer }) {
  const { householdId } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [result, setResult] = useState<ExtractionSubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const full = images.length >= MAX_IMAGES;

  async function snap() {
    const pic = await camera.current?.takePictureAsync({ quality: 0.9 });
    if (pic) setImages((xs) => [...xs, { uri: pic.uri, width: pic.width, height: pic.height }]);
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

  async function send() {
    if (!householdId) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareForUpload(images, resizer);
      setResult(await submitExtraction(householdId, prepared));
      setImages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  if (!householdId) return <Text style={styles.muted}>Pick a household first.</Text>;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Capture a recipe</Text>
      <Text style={styles.muted}>Photograph each page. Up to {MAX_IMAGES} images.</Text>

      {cameraOn && permission?.granted && (
        <View style={{ height: 320, marginVertical: 12 }}>
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
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
      <Button title="Choose from library" onPress={pick} disabled={full} testID="pick-image" />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>
        {images.map((img, i) => (
          <Image key={img.uri + i} source={{ uri: img.uri }} style={{ width: 72, height: 72, margin: 4 }} />
        ))}
      </View>
      <Text testID="image-count">{images.length} image(s) ready</Text>

      <ErrorText message={error} />
      <Button
        title={busy ? 'Preparing...' : 'Send for extraction'}
        onPress={send}
        disabled={busy || images.length === 0}
        testID="send-extraction"
      />
      {result && (
        <Text testID="extraction-result">
          Sent {result.imageCount} image(s) ({result.status}). Job {result.jobId}.
        </Text>
      )}
    </ScrollView>
  );
}

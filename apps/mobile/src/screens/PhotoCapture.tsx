import React, { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { defaultRotator, type CapturedImage, type Rotator } from '@/lib/extraction';
import { Button, ErrorText, Muted, Text, useStyles } from './ui';

/**
 * Shared photo step for the scan flows (pantry groceries, handwritten list, receipt, close-up): camera, library picker,
 * rotate, remove. Controlled: the parent owns `images` and decides what "send" means. Test ids are `${testIdPrefix}-...`
 * (default prefix `photo`): `-open-camera`, `-take`, `-pick`, `-thumb-N`, `-rotate-N`, `-remove-N`, `-count`.
 */
export default function PhotoCapture({
  images,
  onChange,
  max,
  noun = 'photo',
  rotator = defaultRotator,
  testIdPrefix = 'photo',
  allowLibrary = true,
}: {
  images: CapturedImage[];
  onChange: (next: CapturedImage[]) => void;
  max: number;
  /** "photo", "page", ... used in labels. */
  noun?: string;
  rotator?: Rotator;
  testIdPrefix?: string;
  allowLibrary?: boolean;
}) {
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = images.length >= max;
  const id = (s: string) => `${testIdPrefix}-${s}`;

  async function snap() {
    const pic = await camera.current?.takePictureAsync({ quality: 0.9 });
    if (pic) onChange([...images, { uri: pic.uri, width: pic.width, height: pic.height }].slice(0, max));
  }

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: max - images.length > 1,
      selectionLimit: Math.max(1, max - images.length),
      quality: 0.9,
    });
    if (!res.canceled) onChange([...images, ...res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))].slice(0, max));
  }

  async function rotate(index: number) {
    try {
      const img = images[index];
      if (!img) return;
      const turned = await rotator(img);
      onChange(images.map((x, i) => (i === index ? turned : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not rotate the ${noun}`);
    }
  }

  return (
    <View>
      {cameraOn && permission?.granted && (
        <View style={{ height: 320, marginVertical: 12 }}>
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" accessibilityLabel="Camera preview" />
          <Button title={`Take ${noun}`} onPress={snap} disabled={full} testID={id('take')} />
        </View>
      )}
      {!cameraOn && (
        <Button
          title="Open camera"
          testID={id('open-camera')}
          onPress={async () => {
            if (!permission?.granted) {
              const p = await requestPermission();
              if (!p.granted) {
                setError('Camera permission denied. You can still choose photos from your library.');
                return;
              }
            }
            setError(null);
            setCameraOn(true);
          }}
        />
      )}
      {allowLibrary && <Button title="Choose from library" onPress={pick} disabled={full} testID={id('pick')} variant="secondary" />}

      {images.map((img, i) => (
        <View key={img.uri + i} style={[styles.row, { justifyContent: 'flex-start' }]} testID={id(`thumb-${i + 1}`)} accessible={false}>
          <Image source={{ uri: img.uri }} style={{ width: 72, height: 72, marginRight: 12, borderRadius: 4 }} accessibilityLabel={`${noun} ${i + 1} preview`} />
          <View style={{ flex: 1 }}>
            <Text>
              {noun[0]?.toUpperCase()}
              {noun.slice(1)} {i + 1}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button title="Rotate" accessibilityLabel={`Rotate ${noun} ${i + 1}`} onPress={() => rotate(i)} variant="secondary" testID={id(`rotate-${i + 1}`)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Remove"
                  accessibilityLabel={`Remove ${noun} ${i + 1}`}
                  onPress={() => onChange(images.filter((_, j) => j !== i))}
                  variant="secondary"
                  testID={id(`remove-${i + 1}`)}
                />
              </View>
            </View>
          </View>
        </View>
      ))}
      <Muted testID={id('count')} style={{ marginVertical: 8 }}>
        {images.length} of {max} {noun}s ready
      </Muted>
      <ErrorText message={error} />
    </View>
  );
}

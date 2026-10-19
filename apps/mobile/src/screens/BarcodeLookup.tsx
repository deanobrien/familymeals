import React, { useRef, useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { RETAIL_BARCODE_TYPES, acceptScan, normaliseBarcode, type ScanGate } from '@/lib/barcode';
import { PRODUCT_ATTRIBUTION, type ProductClient, type ProductSummary } from '@/lib/productApi';
import { Button, ErrorText, Loading, Muted, Text, useStyles, useTheme } from './ui';

/**
 * Scan (or type) a product barcode and show what Open Food Facts says, via the web server's /api/products/<barcode>.
 * Lookup only: adding the item to the pantry (with dates) is done on the web ("Finish on web"), so nothing is written here.
 */
export default function BarcodeLookup({
  client,
  householdId,
  onClose,
  now = Date.now,
}: {
  client: ProductClient;
  householdId: string;
  onClose: () => void;
  now?: () => number;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOn, setCameraOn] = useState(false);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const gate = useRef<ScanGate>({ busy: false });

  async function lookup(code: string) {
    gate.current.busy = true;
    setBusy(true);
    setError(null);
    try {
      setProduct(await client.lookup(householdId, code));
      setCameraOn(false);
    } catch (e) {
      setProduct(null);
      setError(e instanceof Error ? e.message : 'The product lookup failed');
    } finally {
      gate.current.busy = false;
      setBusy(false);
    }
  }

  function onScanned(event: { data: string }) {
    const code = acceptScan(event, gate.current, now());
    if (code) void lookup(code);
  }

  function submitManual() {
    const code = normaliseBarcode(manual);
    if (!code) {
      setError('Enter the 8, 12 or 13 digits printed under the barcode.');
      return;
    }
    void lookup(code);
  }

  const webPantry = client.webUrl('/pantry/scan');

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Scan a product barcode
      </Text>
      <Muted>Shows the name, pack size, allergens and nutrition. Dates are not on a barcode: add the item on the web to set them.</Muted>

      {cameraOn && permission?.granted && (
        <View style={{ height: 280, marginVertical: 12 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            accessibilityLabel="Barcode camera preview"
            barcodeScannerSettings={{ barcodeTypes: [...RETAIL_BARCODE_TYPES] }}
            onBarcodeScanned={onScanned}
          />
        </View>
      )}
      {!cameraOn && (
        <Button
          title="Open camera to scan"
          testID="open-barcode-camera"
          onPress={async () => {
            if (!permission?.granted) {
              const p = await requestPermission();
              if (!p.granted) {
                setError('Camera permission denied. You can still type the barcode digits.');
                return;
              }
            }
            setError(null);
            setCameraOn(true);
          }}
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Or type the barcode digits"
        placeholderTextColor={theme.muted}
        accessibilityLabel="Barcode digits"
        keyboardType="number-pad"
        value={manual}
        onChangeText={setManual}
        onSubmitEditing={submitManual}
        testID="barcode-input"
      />
      <Button title="Look up" onPress={submitManual} disabled={busy || manual.trim() === ''} testID="barcode-lookup" variant="secondary" />

      {busy && <Loading label="Looking up the product" />}
      <ErrorText message={error} />

      {product && (
        <View accessible testID="product-card" accessibilityLabel={`Product: ${product.name}`} style={{ marginVertical: 12, gap: 6 }}>
          <Text style={styles.title}>{product.name}</Text>
          <Muted>{[product.brand, product.packSizeText, `barcode ${product.barcode}`].filter(Boolean).join(' / ')}</Muted>
          {product.ingredientName && <Text testID="product-ingredient">Matches ingredient: {product.ingredientName}</Text>}
          <Text testID="product-allergens">
            {product.allergens.status === 'unknown'
              ? 'No allergen information on this record: check the pack.'
              : product.allergens.contains.length === 0
                ? 'No allergens listed (check the pack).'
                : `Contains: ${product.allergens.contains.join(', ')}`}
            {product.allergens.traces.length > 0 ? `. May contain: ${product.allergens.traces.join(', ')}` : ''}
          </Text>
          {product.nutrition.map((n) => (
            <Text key={n.label}>
              {n.label}: {n.text}
            </Text>
          ))}
          <Muted testID="product-attribution">{PRODUCT_ATTRIBUTION}</Muted>
          <Button title="This product on Open Food Facts" variant="secondary" onPress={() => void Linking.openURL(product.sourceUrl)} />
          {webPantry && <Button title="Add to pantry on the web" variant="secondary" testID="finish-on-web" onPress={() => void Linking.openURL(webPantry)} />}
        </View>
      )}

      <Button title="Back to recipe capture" variant="secondary" onPress={onClose} testID="close-barcode" />
    </ScrollView>
  );
}

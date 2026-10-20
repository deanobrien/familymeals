import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import ReceiptsScreen from '@/screens/receipts/ReceiptsScreen';
import ReceiptDetailScreen from '@/screens/receipts/ReceiptDetailScreen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

const txt = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** Keys and string values of a multipart body (React Native FormData keeps `_parts`; fall back to entries()). */
function formEntries(form: unknown): Array<[string, unknown]> {
  const f = form as { _parts?: Array<[string, unknown]>; entries?: () => Iterable<[string, unknown]> };
  return f._parts ?? Array.from(f.entries?.() ?? []);
}

type Fake = ServerApi & { get: jest.Mock; post: jest.Mock; postForm: jest.Mock };

function fakeApi(over: Partial<ServerApi> = {}): Fake {
  return {
    configured: true,
    get: jest.fn(),
    post: jest.fn(),
    postForm: jest.fn(),
    webUrl: (p: string) => `http://web.test${p}`,
    authHeaders: async () => ({ Authorization: 'Bearer tok' }),
    ...over,
  } as Fake;
}

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

async function mount(api: ServerApi, ui: React.ReactElement) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <ServerApiProvider api={api}>
        <SetHousehold>{ui}</SetHousehold>
      </ServerApiProvider>
    </AppProvider>,
  );
}

const line = (over: Record<string, unknown>) => ({
  raw: 'X', description: 'x', count: 1, discountPence: 0, discountLines: [], candidates: [], defaultQuantity: { value: 1, unit: 'item' }, classification: 'none', ...over,
});

const reviewJson = (over: Record<string, unknown> = {}) => ({
  receiptId: 'r1',
  retailer: 'Tesco',
  date: '2026-10-19',
  totalPence: 500,
  computedPence: 500,
  discrepancyPence: 0,
  totalOk: true,
  linesMissingPrice: 0,
  status: 'needs_review',
  lines: [
    line({ lineId: 'l1', raw: 'RED LENTILS 500G', description: 'red lentils', netPence: 150, pricePence: 170, discountPence: 20, discountLines: ['Clubcard'], classification: 'confident', preselectedItemId: 'i1', candidates: [{ itemId: 'i1', name: 'red lentils', score: 0.92, reasons: ['name match'] }], defaultQuantity: { value: 500, unit: 'g' } }),
    line({ lineId: 'l2', raw: 'MILK 4PT', description: 'milk', netPence: 150, classification: 'uncertain', candidates: [{ itemId: 'i2', name: 'semi skimmed milk', score: 0.5, reasons: ['partial name'] }], defaultQuantity: { value: 4, unit: 'l' } }),
    line({ lineId: 'l3', raw: 'CHOCOLATE', description: 'chocolate', netPence: 200 }),
  ],
  items: [{ shoppingListItemId: 'i1', name: 'red lentils' }, { shoppingListItemId: 'i2', name: 'semi skimmed milk' }, { shoppingListItemId: 'i3', name: 'onions' }],
  ignored: ['CARRIER BAG 0.10'],
  warnings: ['One line was unclear.'],
  ...over,
});

const detailJson = (review = reviewJson(), extra: Record<string, unknown> = {}) => ({ review, hasPhoto: false, ...extra });

function apiWithReceipt(detail: unknown) {
  const api = fakeApi();
  api.get.mockImplementation(async (path: string) => (path === '/api/receipts/r1' ? detail : { receipts: [] }));
  return api;
}

beforeEach(() => {
  mockPush.mockClear();
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///r.jpg', width: 800, height: 1600 }] });
});

describe('receipts list', () => {
  it('shows the not-configured gate instead of failing', async () => {
    await mount(fakeApi({ configured: false }), <ReceiptsScreen />);
    expect(await screen.findByText(/needs the Family Recipes server/i)).toBeTruthy();
  });

  it('lists receipts with retailer, date, total and a text status badge', async () => {
    const api = fakeApi();
    api.get.mockResolvedValue({
      receipts: [
        { id: 'a', retailer: 'Tesco', date: '2026-10-19', totalPence: 1234, status: 'needs_review', lineCount: 5 },
        { id: 'b', retailer: 'Aldi', date: '2026-10-12', totalPence: 335, status: 'reconciled', lineCount: 1 },
      ],
    });
    await mount(api, <ReceiptsScreen />);
    expect(await screen.findByText('Tesco')).toBeTruthy();
    expect(screen.getByText(/2026-10-19 · 5 lines · £12\.34/)).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText('Reconciled')).toBeTruthy();
    expect(screen.getByText(/1 line ·/)).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/api/receipts', { householdId: 'hh-1' });
    await fireEvent.press(screen.getByTestId('receipt-b'));
    expect(mockPush).toHaveBeenCalledWith('/receipts/b');
  });

  it('shows an empty state and still offers to scan', async () => {
    const api = fakeApi();
    api.get.mockResolvedValue({ receipts: [] });
    await mount(api, <ReceiptsScreen />);
    expect(await screen.findByText('No receipts yet')).toBeTruthy();
    expect(screen.getByTestId('scan-receipt')).toBeTruthy();
  });

  it('shows a load error with retry, and pull-to-refresh reloads', async () => {
    const api = fakeApi();
    api.get.mockRejectedValueOnce(new ServerApiError('Could not reach the server.', 0, true, 'NETWORK'));
    await mount(api, <ReceiptsScreen />);
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy();
    api.get.mockResolvedValue({ receipts: [{ id: 'a', retailer: 'Lidl', status: 'needs_review', lineCount: 2 }] });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('retry'));
    });
    expect(await screen.findByText('Lidl')).toBeTruthy();
    api.get.mockResolvedValue({ receipts: [{ id: 'c', retailer: 'Co-op', status: 'needs_review', lineCount: 2 }] });
    await act(async () => {
      screen.getByTestId('receipts-list').props.refreshControl.props.onRefresh();
    });
    expect(await screen.findByText('Co-op')).toBeTruthy();
  });

  it('uploads one resized photo as `receipt` with the household id, then opens the review', async () => {
    const api = fakeApi();
    api.get.mockResolvedValue({ receipts: [] });
    api.postForm.mockResolvedValue({ receiptId: 'new-1' });
    const resizer = jest.fn(async (i: { uri: string; width: number; height: number }) => ({ ...i, uri: 'file:///small.jpg' }));
    await mount(api, <ReceiptsScreen resizer={resizer} />);
    await fireEvent.press(await screen.findByTestId('scan-receipt'));
    await fireEvent.press(await screen.findByTestId('receipt-pick'));
    await screen.findByTestId('receipt-thumb-1');
    await fireEvent.press(screen.getByTestId('send-receipt'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/receipts/new-1'));
    expect(resizer).toHaveBeenCalledTimes(1);
    expect(api.postForm.mock.calls[0]![0]).toBe('/api/receipts');
    const parts = formEntries(api.postForm.mock.calls[0]![1]);
    expect(parts[0]).toEqual(['householdId', 'hh-1']);
    expect(parts.map(([k]) => k)).toEqual(['householdId', 'receipt']); // exactly one photo, field `receipt`
    expect(resizer.mock.results[0]).toBeTruthy();
  });

  it('shows the server message when the upload is refused (read-only household) and lets the user retry', async () => {
    const api = fakeApi();
    api.get.mockResolvedValue({ receipts: [] });
    api.postForm.mockRejectedValue(new ServerApiError('This household is read-only while it is pending deletion.', 403, false, 'READ_ONLY'));
    await mount(api, <ReceiptsScreen resizer={async (i) => i} />);
    await fireEvent.press(await screen.findByTestId('scan-receipt'));
    await fireEvent.press(await screen.findByTestId('receipt-pick'));
    await screen.findByTestId('receipt-thumb-1');
    await fireEvent.press(screen.getByTestId('send-receipt'));
    expect(await screen.findByText(/read-only while it is pending deletion/)).toBeTruthy();
    expect(screen.getByTestId('send-receipt')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('receipt review', () => {
  it('pre-selects a confident match but does not confirm it; an uncertain line starts with nothing chosen', async () => {
    const api = apiWithReceipt(detailJson());
    await mount(api, <ReceiptDetailScreen id="r1" />);
    expect(await screen.findByText('RED LENTILS 500G')).toBeTruthy();
    expect(screen.getByText('Matched to: red lentils')).toBeTruthy();
    expect(screen.getByTestId('suggested-l1')).toBeTruthy();
    expect(screen.getByTestId('confirm-l1').props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId('class-l1')).toHaveTextContent(txt('Suggested match'));
    expect(screen.getByTestId('class-l2')).toHaveTextContent(txt('Uncertain match'));
    expect(screen.getByTestId('class-l3')).toHaveTextContent(txt('No match found'));
    expect(within(screen.getByTestId('line-l2')).getByText(/No list item chosen/)).toBeTruthy();
    expect(screen.queryByTestId('confirm-l2')).toBeNull();
    expect(screen.getByText(/50% match: partial name/)).toBeTruthy();
    expect(screen.getByTestId('discount-l1')).toHaveTextContent(txt('Discount −£0.20 applied (Clubcard); was £1.70'));
    expect(screen.getByText('One line was unclear.')).toBeTruthy();
    expect(screen.getByText('CARRIER BAG 0.10')).toBeTruthy();
    expect(screen.getByTestId('total-ok')).toBeTruthy();
    // nothing confirmed => nothing to send
    expect(screen.getByTestId('submit-confirm').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('confirm-summary')).toHaveTextContent(txt('0 purchases will be recorded'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends only what the user explicitly decided (quantity edit, other item, extra + pantry), then shows the summary', async () => {
    const api = apiWithReceipt(detailJson());
    api.post.mockResolvedValue({ ok: true, purchases: 2, extras: 1, pantryAdds: 1, leftOutstanding: 4 });
    await mount(api, <ReceiptDetailScreen id="r1" />);
    await screen.findByText('RED LENTILS 500G');

    await fireEvent.press(screen.getByTestId('confirm-l1')); // accept the suggestion
    await fireEvent.changeText(screen.getByTestId('qty-l1'), '750'); // edit resets the tick (it must be re-confirmed)
    expect(screen.getByTestId('confirm-l1').props.accessibilityState.checked).toBe(false);
    await fireEvent.press(screen.getByTestId('confirm-l1'));

    await fireEvent.press(screen.getByTestId('other-toggle-l2')); // pick another list item for the milk line
    await fireEvent.press(screen.getByTestId('other-l2-i3'));
    await fireEvent.press(screen.getByTestId('confirm-l2'));

    await fireEvent.press(screen.getByTestId('extra-l3'));
    await fireEvent.press(screen.getByTestId('pantry-l3'));

    expect(screen.getByTestId('confirm-summary')).toHaveTextContent(txt('2 purchases will be recorded, 1 added to pantry.'));
    await fireEvent.press(screen.getByTestId('submit-confirm'));

    await screen.findByTestId('summary');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/receipts/r1/confirm', {
      householdId: 'hh-1',
      decisions: [
        { lineId: 'l1', outcome: 'purchase', shoppingListItemId: 'i1', quantityValue: 750 },
        { lineId: 'l2', outcome: 'purchase', shoppingListItemId: 'i3', quantityValue: 4 },
        { lineId: 'l3', outcome: 'extra', addToPantry: true },
      ],
    });
    expect(screen.getByTestId('summary-purchases')).toHaveTextContent(txt('2 purchase(s) recorded'));
    expect(screen.getByTestId('summary-extras')).toHaveTextContent(txt('1 extra(s)'));
    expect(screen.getByTestId('summary-pantry')).toHaveTextContent(txt('1 added to your pantry'));
    expect(screen.getByTestId('summary-left')).toHaveTextContent(txt('4 item(s) left'));
  });

  it('skipping a line or leaving it unticked sends nothing for it', async () => {
    const api = apiWithReceipt(detailJson());
    api.post.mockResolvedValue({ purchases: 1, extras: 0, pantryAdds: 0, leftOutstanding: 2 });
    await mount(api, <ReceiptDetailScreen id="r1" />);
    await screen.findByText('RED LENTILS 500G');
    await fireEvent.press(screen.getByTestId('confirm-l1'));
    await fireEvent.press(screen.getByTestId('cand-l2-i2')); // chosen but never ticked
    await fireEvent.press(screen.getByTestId('extra-l3'));
    await fireEvent.press(screen.getByTestId('skip-l3')); // changed their mind
    await fireEvent.press(screen.getByTestId('submit-confirm'));
    await screen.findByTestId('summary');
    expect(api.post.mock.calls[0]![1].decisions).toEqual([{ lineId: 'l1', outcome: 'purchase', shoppingListItemId: 'i1', quantityValue: 500 }]);
  });

  it('blocks Confirm on an invalid quantity', async () => {
    const api = apiWithReceipt(detailJson());
    await mount(api, <ReceiptDetailScreen id="r1" />);
    await screen.findByText('RED LENTILS 500G');
    await fireEvent.changeText(screen.getByTestId('qty-l1'), '0');
    await fireEvent.press(screen.getByTestId('confirm-l1'));
    expect(screen.getByTestId('submit-confirm').props.accessibilityState.disabled).toBe(true);
  });

  it('warns clearly when the printed total does not match the lines, and when lines have no price', async () => {
    const api = apiWithReceipt(detailJson(reviewJson({ totalPence: 700, computedPence: 500, discrepancyPence: 200, totalOk: false, linesMissingPrice: 2 })));
    await mount(api, <ReceiptDetailScreen id="r1" />);
    const warn = await screen.findByTestId('total-warning');
    expect(warn).toHaveTextContent(txt('Printed total £7.00 does not match the lines, which add up to £5.00'));
    expect(warn).toHaveTextContent(txt('receipt is £2.00 higher'));
    expect(warn).toHaveTextContent(txt('2 line(s) have no price'));
    expect(screen.queryByTestId('total-ok')).toBeNull();
  });

  it('warns when no total could be read', async () => {
    const api = apiWithReceipt(detailJson(reviewJson({ totalPence: undefined, discrepancyPence: undefined, totalOk: false })));
    await mount(api, <ReceiptDetailScreen id="r1" />);
    expect(await screen.findByTestId('total-warning')).toHaveTextContent(txt('No receipt total could be read'));
    expect(screen.getByTestId('receipt-header')).toHaveTextContent(txt('No total read'));
  });

  it("shows the server's message (read-only household) when confirming is refused, and keeps the form", async () => {
    const api = apiWithReceipt(detailJson());
    api.post.mockRejectedValue(new ServerApiError('This household is read-only while it is pending deletion.', 403, false, 'READ_ONLY'));
    await mount(api, <ReceiptDetailScreen id="r1" />);
    await screen.findByText('RED LENTILS 500G');
    await fireEvent.press(screen.getByTestId('confirm-l1'));
    await fireEvent.press(screen.getByTestId('submit-confirm'));
    expect(await screen.findByText(/read-only while it is pending deletion/)).toBeTruthy();
    expect(screen.queryByTestId('summary')).toBeNull();
    expect(screen.getByTestId('submit-confirm')).toBeTruthy();
  });

  it('shows a load error for an unknown receipt', async () => {
    const api = fakeApi();
    api.get.mockRejectedValue(new ServerApiError('Receipt not found.', 404, false, 'NOT_FOUND'));
    await mount(api, <ReceiptDetailScreen id="nope" />);
    expect(await screen.findByText('Receipt not found.')).toBeTruthy();
  });
});

describe('reconciled receipt and photo', () => {
  const reconciled = detailJson(reviewJson({ status: 'reconciled' }), {
    reconciliation: {
      purchaseEventIds: ['e1'],
      decisions: [
        { lineId: 'l1', outcome: 'purchase', shoppingListItemId: 'i1', itemName: 'red lentils' },
        { lineId: 'l3', outcome: 'extra', addToPantry: true },
      ],
    },
  });

  it('renders read-only history with outcomes and no form', async () => {
    await mount(apiWithReceipt(reconciled), <ReceiptDetailScreen id="r1" />);
    expect(await screen.findByTestId('history')).toBeTruthy();
    expect(screen.getByText(/1 purchase\(s\) recorded/)).toBeTruthy();
    expect(screen.getByTestId('history-l1')).toHaveTextContent(txt('RED LENTILS 500G (£1.50) → bought: red lentils'));
    expect(screen.getByTestId('history-l2')).toHaveTextContent(txt('not matched'));
    expect(screen.getByTestId('history-l3')).toHaveTextContent(txt('extra (added to pantry)'));
    expect(screen.queryByTestId('submit-confirm')).toBeNull();
    expect(screen.queryByTestId('confirm-l1')).toBeNull();
  });

  it('shows the receipt photo with the Authorization header and the privacy note', async () => {
    const api = apiWithReceipt({ ...reconciled, hasPhoto: true, photoPath: '/api/receipts/r1/photo' });
    await mount(api, <ReceiptDetailScreen id="r1" />);
    await fireEvent.press(await screen.findByTestId('photo-toggle'));
    const img = await screen.findByTestId('receipt-photo');
    expect(img.props.source).toEqual({ uri: 'http://web.test/api/receipts/r1/photo?householdId=hh-1', headers: { Authorization: 'Bearer tok' } });
    expect(screen.getByText(/deleted 90 days after you confirm/)).toBeTruthy();
  });

  it('offers no photo control when no photo was kept', async () => {
    await mount(apiWithReceipt(reconciled), <ReceiptDetailScreen id="r1" />);
    await screen.findByTestId('history');
    expect(screen.queryByTestId('photo-toggle')).toBeNull();
  });
});

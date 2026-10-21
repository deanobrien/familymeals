// The home-screen widget's layout (react-native-android-widget primitives, rendered natively by the library; no web views).
// Tap targets: header opens the app, a row ticks that item (clickAction TICK), the footer undoes the last tick (UNDO).
// Native rendering is not unit-testable: the tree shape and click wiring are tested with stand-in primitives (widget.test.tsx).
import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetModel } from './widgetModel';

export const WIDGET_NAME = 'ShoppingList';
export const CLICK_TICK = 'TICK';
export const CLICK_UNDO = 'UNDO';

interface Palette {
  bg: `#${string}`;
  text: `#${string}`;
  muted: `#${string}`;
  accent: `#${string}`;
  line: `#${string}`;
}
const LIGHT: Palette = { bg: '#FFFFFF', text: '#1B1B1B', muted: '#5F6368', accent: '#2E7D32', line: '#E0E0E0' };
const DARK: Palette = { bg: '#1E1E1E', text: '#F2F2F2', muted: '#B0B3B8', accent: '#81C784', line: '#3A3A3A' };

function Body({ model, p }: { model: WidgetModel; p: Palette }) {
  const header = (sub: string) => (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel="Open Family Recipes"
      style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 }}
    >
      <TextWidget text="Shopping list" style={{ fontSize: 16, fontWeight: 'bold', color: p.accent }} />
      <TextWidget text={sub} style={{ fontSize: 12, color: p.muted }} />
    </FlexWidget>
  );
  const note = (text: string) => <TextWidget text={text} maxLines={3} style={{ fontSize: 13, color: p.muted }} />;

  if (model.kind === 'signed_out') {
    return (
      <>
        {header('')}
        {note('Open Family Recipes and sign in to see your list here.')}
      </>
    );
  }
  if (model.kind === 'error') {
    return (
      <>
        {header('')}
        {note('Could not load the list. Tap the title to open the app.')}
      </>
    );
  }
  const sub = model.pending > 0 ? `${model.open} to buy, ${model.pending} waiting to sync` : model.open === 0 ? 'all done' : `${model.open} to buy`;
  return (
    <>
      {header(sub)}
      {model.storeName ? <TextWidget text={`Shopping at ${model.storeName}`} style={{ fontSize: 11, color: p.muted, paddingBottom: 2 }} /> : null}
      {model.rows.length === 0 ? note('Nothing left to buy.') : null}
      {model.rows.map((r) => (
        <FlexWidget
          key={r.id}
          clickAction={CLICK_TICK}
          clickActionData={{ itemId: r.id }}
          accessibilityLabel={`Tick ${r.label}`}
          style={{ width: 'match_parent', height: 36, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: p.line }}
        >
          <TextWidget text="[ ]" style={{ fontSize: 15, color: p.accent, fontWeight: 'bold' }} />
          <TextWidget text={`  ${r.label}`} maxLines={1} truncate="END" style={{ fontSize: 14, color: p.text }} />
          {r.detail ? <TextWidget text={`  ${r.detail}`} maxLines={1} truncate="END" style={{ fontSize: 12, color: p.muted }} /> : null}
        </FlexWidget>
      ))}
      {model.more > 0 ? (
        <FlexWidget clickAction="OPEN_APP" style={{ width: 'match_parent', paddingTop: 4 }}>
          <TextWidget text={`+${model.more} more in the app`} style={{ fontSize: 12, color: p.muted }} />
        </FlexWidget>
      ) : null}
      {model.undo ? (
        <FlexWidget
          clickAction={CLICK_UNDO}
          clickActionData={{ itemId: model.undo.itemId }}
          accessibilityLabel={`Undo ticking ${model.undo.name}`}
          style={{ width: 'match_parent', paddingTop: 6 }}
        >
          <TextWidget text={`Ticked ${model.undo.name}. Tap to undo`} maxLines={1} truncate="END" style={{ fontSize: 12, color: p.accent, fontWeight: 'bold' }} />
        </FlexWidget>
      ) : null}
    </>
  );
}

function Frame({ model, p }: { model: WidgetModel; p: Palette }) {
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: p.bg, borderRadius: 16, padding: 12, flexDirection: 'column' }}>
      <Body model={model} p={p} />
    </FlexWidget>
  );
}

/** Light and dark variants (the launcher picks by the system theme). */
export function shoppingWidgetTree(model: WidgetModel): { light: React.JSX.Element; dark: React.JSX.Element } {
  return { light: <Frame model={model} p={LIGHT} />, dark: <Frame model={model} p={DARK} /> };
}

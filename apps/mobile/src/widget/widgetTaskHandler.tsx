// Headless task: Android calls this when the widget is added, resized, refreshed (every 30 min) or tapped. It runs in the app's
// JS runtime without any screen. Registered once from index.js.
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { CLICK_TICK, CLICK_UNDO, WIDGET_NAME, shoppingWidgetTree } from './ShoppingWidget';
import { widgetActions } from './widgetBridge';
import type { WidgetModel } from './widgetModel';

/** The click payload is untrusted shape-wise: only a string item id is used. */
export function itemIdOf(data: Record<string, unknown> | undefined): string | null {
  const id = data?.itemId;
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  let model: WidgetModel;
  switch (props.widgetAction) {
    case 'WIDGET_DELETED':
      return;
    case 'WIDGET_CLICK': {
      const id = itemIdOf(props.clickActionData);
      if (props.clickAction === CLICK_TICK && id) model = await widgetActions.tick(id);
      else if (props.clickAction === CLICK_UNDO && id) model = await widgetActions.undo(id);
      else model = await widgetActions.load();
      break;
    }
    case 'WIDGET_UPDATE':
      model = await widgetActions.load(true); // periodic: deliver offline ticks, then read
      break;
    default:
      model = await widgetActions.load();
  }
  props.renderWidget(shoppingWidgetTree(model));
}

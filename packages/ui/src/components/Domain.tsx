import type { PriceKind, ValueStatus } from '@fr/domain';
import type { ComponentType, ReactNode } from 'react';
import { Badge, Card } from './Surfaces';
import { IconButton } from './Button';
import { Checkbox } from './Fields';
import { Icon, type IconName, cx } from './internal';

/* ---------- formatting ---------- */
/** Money is integer pence. Never floats. */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.round(pence));
  return `${sign}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ---------- RecipeCard ---------- */
export interface RecipeCardProps {
  title: string;
  href: string;
  imageUrl?: string | null;
  imageAlt?: string;
  totalMinutes?: number | null;
  /** Integer pence; null/undefined = no price known. */
  costPerServingPence?: number | null;
  tags?: string[];
  favourite?: boolean;
  onToggleFavourite?: () => void;
  variant?: 'card' | 'row';
  /** Swap in next/link etc. */
  linkComponent?: ComponentType<{ href: string; className?: string; children?: ReactNode }>;
}

export function RecipeCard({ title, href, imageUrl, imageAlt = '', totalMinutes, costPerServingPence, tags = [], favourite = false, onToggleFavourite, variant = 'card', linkComponent: LinkC }: RecipeCardProps) {
  const link = LinkC
    ? <LinkC href={href} className="fr-recipecard__link">{title}</LinkC>
    : <a href={href} className="fr-recipecard__link">{title}</a>;
  return (
    <Card className={cx('fr-recipecard', variant === 'row' && 'fr-recipecard--list')}>
      <div className="fr-recipecard__media">
        {imageUrl ? <img src={imageUrl} alt={imageAlt} loading="lazy" /> : <Icon name="image" width={32} height={32} />}
      </div>
      <div className="fr-card__body">
        <h3 className="fr-recipecard__title">{link}</h3>
        <div className="fr-recipecard__meta">
          {totalMinutes != null && <span><Icon name="clock" width={14} height={14} style={{ verticalAlign: '-2px' }} /> {formatMinutes(totalMinutes)}</span>}
          <span>
            {costPerServingPence != null ? `${formatPence(costPerServingPence)} per serving` : 'Cost unknown'}
            {costPerServingPence != null && <> <Badge tone="warning">estimate</Badge></>}
          </span>
        </div>
        {tags.length > 0 && (
          <ul className="fr-recipecard__tags" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Tags">
            {tags.map((t) => <li key={t}><Badge>{t}</Badge></li>)}
          </ul>
        )}
      </div>
      {onToggleFavourite && (
        <IconButton className="fr-recipecard__fav" icon="heart" variant="ghost" pressed={favourite} label={favourite ? `Remove ${title} from favourites` : `Add ${title} to favourites`} onClick={onToggleFavourite} />
      )}
    </Card>
  );
}

/* ---------- Grid/List toggle + collection ---------- */
export type RecipeView = 'grid' | 'list';
export function ViewToggle({ view, onChange }: { view: RecipeView; onChange: (v: RecipeView) => void }) {
  return (
    <div role="group" aria-label="Recipe layout" className="fr-viewtoggle">
      <IconButton icon="grid" label="Grid view" variant="ghost" pressed={view === 'grid'} onClick={() => onChange('grid')} style={{ borderRadius: 0 }} />
      <IconButton icon="list" label="List view" variant="ghost" pressed={view === 'list'} onClick={() => onChange('list')} style={{ borderRadius: 0 }} />
    </div>
  );
}

export function RecipeGrid({ view = 'grid', label = 'Recipes', children }: { view?: RecipeView; label?: string; children: ReactNode[] | ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <ul className={cx('fr-recipegrid', view === 'list' && 'fr-recipegrid--list')} aria-label={label}>
      {items.map((c, i) => <li key={i}>{c}</li>)}
    </ul>
  );
}

/* ---------- AppShell ---------- */
export type NavKey = 'home' | 'recipes' | 'planner' | 'shopping' | 'pantry' | 'receipts' | 'household' | 'settings';
/** `mobile: false` keeps an item out of the bottom nav (sidebar only) so the phone bar stays usable. */
export interface NavItem { key: NavKey; label: string; href: string; icon: IconName; mobile?: boolean }

export const DEFAULT_NAV: NavItem[] = [
  { key: 'home', label: 'Home', href: '/', icon: 'home' },
  { key: 'recipes', label: 'Recipes', href: '/recipes', icon: 'book' },
  { key: 'planner', label: 'Meal planner', href: '/plan', icon: 'calendar' },
  { key: 'shopping', label: 'Shopping list', href: '/shopping', icon: 'cart' },
  { key: 'pantry', label: 'Pantry', href: '/pantry', icon: 'box' },
  { key: 'receipts', label: 'Receipts', href: '/receipts', icon: 'receipt', mobile: false },
  { key: 'household', label: 'Household', href: '/household', icon: 'users' },
  { key: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
];

export interface AppShellProps {
  children: ReactNode;
  active: NavKey;
  nav?: NavItem[];
  appName?: string;
  linkComponent?: ComponentType<{ href: string; className?: string; 'aria-current'?: 'page'; children?: ReactNode }>;
}

export function AppShell({ children, active, nav = DEFAULT_NAV, appName = 'Family Recipes', linkComponent: LinkC }: AppShellProps) {
  const renderLink = (item: NavItem, extraLabel?: boolean) => {
    const props = { href: item.href, className: 'fr-navlink', 'aria-current': item.key === active ? ('page' as const) : undefined };
    const body = (<><Icon name={item.icon} /><span>{extraLabel ? shortLabel(item) : item.label}</span></>);
    return LinkC ? <LinkC {...props}>{body}</LinkC> : <a {...props}>{body}</a>;
  };
  return (
    <div className="fr-root fr-shell">
      <a href="#main" className="fr-skip-link">Skip to content</a>
      <nav className="fr-sidebar" aria-label="Main">
        <div className="fr-brand">{appName}</div>
        <ul>{nav.map((n) => <li key={n.key}>{renderLink(n)}</li>)}</ul>
      </nav>
      <main id="main" className="fr-shell__main" tabIndex={-1}>{children}</main>
      <nav className="fr-bottomnav" aria-label="Main (mobile)">
        <ul>{nav.filter((n) => n.mobile !== false).map((n) => <li key={n.key}>{renderLink(n, true)}</li>)}</ul>
      </nav>
    </div>
  );
}

function shortLabel(item: NavItem): string {
  return ({ planner: 'Planner', shopping: 'Shopping' } as Partial<Record<NavKey, string>>)[item.key] ?? item.label;
}

/* ---------- Shopping ---------- */
export function ShoppingCategoryHeader({ children }: { children: ReactNode }) {
  return <h3 className="fr-shopcat">{children}</h3>;
}

export interface ShoppingItemRowProps {
  name: string;
  quantityLabel?: string;
  /** e.g. "1 of 3 bought" */
  partialLabel?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** Provide to show a "Bought some" action for partial quantities. */
  onPartial?: () => void;
}

export function ShoppingItemRow({ name, quantityLabel, partialLabel, checked, onToggle, onPartial }: ShoppingItemRowProps) {
  return (
    <li className={cx('fr-shoprow', checked && 'fr-shoprow--done')}>
      <Checkbox
        large
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        label={
          <span className="fr-shoprow__text">
            <span className="fr-shoprow__name">{name}</span>
            {(quantityLabel || partialLabel) && (
              <span className="fr-shoprow__qty">{[quantityLabel, partialLabel].filter(Boolean).join(' · ')}</span>
            )}
          </span>
        }
      />
      {onPartial && !checked && <IconButton label={`Bought some ${name}`} icon="plus" variant="secondary" onClick={onPartial} />}
    </li>
  );
}

/* ---------- MealSlot ---------- */
export interface MealSlotProps {
  label: string;
  meal?: { title: string; servings?: number } | null;
  onAdd?: () => void;
  onOpen?: () => void;
  onRemove?: () => void;
}
export function MealSlot({ label, meal, onAdd, onOpen, onRemove }: MealSlotProps) {
  if (!meal) {
    return (
      <div className="fr-mealslot">
        <span className="fr-mealslot__label">{label}</span>
        <button type="button" className="fr-btn fr-btn--ghost" onClick={onAdd} disabled={!onAdd} aria-label={`Add meal to ${label}`}>
          <Icon name="plus" /> Add meal
        </button>
      </div>
    );
  }
  return (
    <div className="fr-mealslot fr-mealslot--filled">
      <span className="fr-mealslot__label">{label}</span>
      <div className="fr-mealslot__row">
        <button type="button" className="fr-mealslot__title" onClick={onOpen}>
          {meal.title}{meal.servings != null && <span className="fr-muted"> · {meal.servings} servings</span>}
        </button>
        {onRemove && <IconButton label={`Remove ${meal.title} from ${label}`} icon="trash" onClick={onRemove} />}
      </div>
    </div>
  );
}

/* ---------- NutritionTable ---------- */
export type { ValueStatus };
export interface NutritionRow {
  label: string;
  status: ValueStatus;
  value?: number | null;
  unit: string;
  estimate?: boolean;
  source?: string;
}

/** Render rule: only 'known' (with a finite value) and 'zero' show a number. Everything else is "Unknown" and is never shown as 0. */
export function formatNutrition(row: Pick<NutritionRow, 'status' | 'value' | 'unit'>): { text: string; unknown: boolean } {
  if (row.status === 'zero') return { text: `0 ${row.unit}`, unknown: false };
  if (row.status === 'known' && typeof row.value === 'number' && Number.isFinite(row.value)) {
    return { text: `${Math.round(row.value * 10) / 10} ${row.unit}`, unknown: false };
  }
  return { text: row.status === 'unavailable' ? '—' : 'Unknown', unknown: true };
}

export function NutritionTable({ rows, caption = 'Nutrition per serving' }: { rows: NutritionRow[]; caption?: string }) {
  const anyUnknown = rows.some((r) => formatNutrition(r).unknown);
  return (
    <div className="fr-table__wrap">
      <table className="fr-table">
        <caption>{caption}</caption>
        <thead>
          <tr><th scope="col">Nutrient</th><th scope="col" className="fr-num">Amount</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const f = formatNutrition(r);
            return (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className={cx('fr-num', f.unknown && 'fr-unknown')} title={r.source}>
                  {f.text}
                  {!f.unknown && r.estimate && <> <Badge tone="warning">estimate</Badge></>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {anyUnknown && <p className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }}>Unknown means we do not have data, not that the amount is zero.</p>}
    </div>
  );
}

/* ---------- CostBreakdown ---------- */
export type { PriceKind };
export interface CostLine {
  label: string;
  pricePence?: number | null;
  kind?: PriceKind;
  source?: string;
}
const KIND_LABEL: Record<PriceKind, { text: string; tone: 'success' | 'warning' | 'neutral' }> = {
  user_confirmed: { text: 'Your price', tone: 'success' },
  receipt: { text: 'Receipt', tone: 'success' },
  retailer_verified: { text: 'Retailer price', tone: 'neutral' },
  generic_estimate: { text: 'Estimate', tone: 'warning' },
};

export interface CostBreakdownProps {
  lines: CostLine[];
  servings: number;
  caption?: string;
}

export function CostBreakdown({ lines, servings, caption = 'Cost breakdown' }: CostBreakdownProps) {
  const missing = lines.filter((l) => l.pricePence == null).length;
  const hasEstimate = lines.some((l) => l.pricePence != null && (l.kind ?? 'generic_estimate') === 'generic_estimate');
  const known = lines.reduce((s, l) => s + (l.pricePence ?? 0), 0);
  const anyPriced = lines.length > missing;
  const isEstimate = hasEstimate || missing > 0;
  const perServing = anyPriced && servings > 0 ? Math.round(known / servings) : null;
  return (
    <div className="fr-table__wrap">
      <table className="fr-table">
        <caption>{caption}</caption>
        <thead>
          <tr><th scope="col">Ingredient</th><th scope="col">Price source</th><th scope="col" className="fr-num">Cost</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const k = KIND_LABEL[l.kind ?? 'generic_estimate'];
            return (
              <tr key={l.label}>
                <th scope="row">{l.label}</th>
                <td>{l.pricePence == null ? <span className="fr-unknown">No price</span> : <Badge tone={k.tone} title={l.source}>{k.text}</Badge>}{l.pricePence != null && l.source && <span className="fr-visually-hidden"> ({l.source})</span>}</td>
                <td className={cx('fr-num', l.pricePence == null && 'fr-unknown')}>{l.pricePence == null ? 'Unknown' : formatPence(l.pricePence)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>{missing > 0 ? 'Total (partial)' : 'Total'}{isEstimate && <> <Badge tone="warning">estimate</Badge></>}</th>
            <td className="fr-num">{anyPriced ? formatPence(known) : 'Unknown'}</td>
          </tr>
          <tr>
            <th scope="row" colSpan={2}>Per serving ({servings})</th>
            <td className="fr-num">{perServing == null ? 'Unknown' : formatPence(perServing)}</td>
          </tr>
        </tfoot>
      </table>
      {missing > 0 && <p className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }}>{missing} ingredient{missing === 1 ? '' : 's'} without a price; the total is a lower bound.</p>}
    </div>
  );
}

import * as RDialog from '@radix-ui/react-dialog';
import * as RTabs from '@radix-ui/react-tabs';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button, IconButton } from './Button';
import { Icon, type IconName, cx } from './internal';

/* ---------- Badge ---------- */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}
export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={cx('fr-badge', tone !== 'neutral' && `fr-badge--${tone}`, className)} {...rest} />;
}

/* ---------- Card ---------- */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('fr-card', className)} {...rest} />;
}
export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('fr-card__body', className)} {...rest} />;
}

/* ---------- Dialog / Sheet (Radix: focus trap, Esc, aria) ---------- */
interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Visually hide the title but keep it for screen readers. */
  hideTitle?: boolean;
}

function Modal({ open, onOpenChange, title, description, children, hideTitle, contentClass }: OverlayProps & { contentClass: string }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fr-overlay" />
        <RDialog.Content className={`fr-root ${contentClass}`} {...(description ? {} : { 'aria-describedby': undefined })}>
          <RDialog.Title className={hideTitle ? 'fr-visually-hidden' : 'fr-dialog__title'}>{title}</RDialog.Title>
          {description && <RDialog.Description className="fr-dialog__desc">{description}</RDialog.Description>}
          {children}
          <RDialog.Close asChild>
            <IconButton label="Close" icon="x" className="fr-dialog__close" />
          </RDialog.Close>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Dialog(props: OverlayProps) {
  return <Modal {...props} contentClass="fr-dialog" />;
}
/** Bottom sheet; use on mobile for filters, add-to-plan, etc. */
export function Sheet(props: OverlayProps) {
  return <Modal {...props} contentClass="fr-sheet" />;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, loading, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="fr-dialog__actions">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
        <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

/* ---------- Tabs ---------- */
export interface TabItem { value: string; label: string; content: ReactNode }
export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label: string;
}
export function Tabs({ items, label, ...rest }: TabsProps) {
  const first = items[0]?.value;
  const controlled = rest.value !== undefined ? { value: rest.value } : { defaultValue: rest.defaultValue ?? first };
  return (
    <RTabs.Root {...controlled} onValueChange={rest.onValueChange}>
      <RTabs.List className="fr-tabs__list" aria-label={label}>
        {items.map((t) => <RTabs.Trigger key={t.value} value={t.value} className="fr-tabs__trigger">{t.label}</RTabs.Trigger>)}
      </RTabs.List>
      {items.map((t) => <RTabs.Content key={t.value} value={t.value} className="fr-tabs__content">{t.content}</RTabs.Content>)}
    </RTabs.Root>
  );
}

/* ---------- Toast ---------- */
export interface ToastOptions { message: string; tone?: 'info' | 'error'; actionLabel?: string; onAction?: () => void; durationMs?: number }
interface ToastEntry extends ToastOptions { id: number }
interface ToastApi { toast: (opts: ToastOptions | string) => void }
const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((opts: ToastOptions | string) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    const id = nextId.current++;
    setItems((l) => [...l, { ...o, id }]);
    const ms = o.durationMs ?? 6000;
    if (ms > 0) setTimeout(() => dismiss(id), ms);
  }, [dismiss]);
  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fr-root fr-toasts" role="region" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={cx('fr-toast', t.tone === 'error' && 'fr-toast--error')} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="fr-toast__msg">{t.message}</span>
            {t.actionLabel && <Button size="sm" variant="ghost" onClick={() => { t.onAction?.(); dismiss(t.id); }}>{t.actionLabel}</Button>}
            <IconButton label="Dismiss notification" icon="x" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Skeleton ---------- */
export interface SkeletonProps { width?: string | number; height?: string | number; className?: string; label?: string }
export function Skeleton({ width = '100%', height = '1em', className, label }: SkeletonProps) {
  return (
    <span
      className={cx('fr-skeleton', className)}
      style={{ width, height }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}

/* ---------- Empty / Error ---------- */
export interface StateProps {
  title: string;
  description?: string;
  icon?: IconName;
  action?: ReactNode;
}
export function EmptyState({ title, description, icon = 'inbox', action }: StateProps) {
  return (
    <div className="fr-state">
      <div className="fr-state__icon"><Icon name={icon} width={28} height={28} /></div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export interface ErrorStateProps extends Partial<StateProps> {
  onRetry?: () => void;
  retryLabel?: string;
}
export function ErrorState({ title = 'Something went wrong', description = 'Please try again. If it keeps happening, let us know.', icon = 'alert', action, onRetry, retryLabel = 'Try again' }: ErrorStateProps) {
  return (
    <div className="fr-state fr-state--error" role="alert">
      <div className="fr-state__icon"><Icon name={icon} width={28} height={28} /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>{retryLabel}</Button>}
      {action}
    </div>
  );
}

/* ---------- Stepper (servings +/-) ---------- */
export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
}
export function Stepper({ value, onChange, min = 1, max = 99, step = 1, label = 'Servings', unit }: StepperProps) {
  return (
    <div role="group" aria-label={label} className="fr-stepper">
      <IconButton label={`Decrease ${label.toLowerCase()}`} icon="minus" variant="secondary" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} />
      <output className="fr-stepper__value" aria-live="polite" aria-label={`${label}: ${value}`}>{value}{unit ? ` ${unit}` : ''}</output>
      <IconButton label={`Increase ${label.toLowerCase()}`} icon="plus" variant="secondary" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} />
    </div>
  );
}

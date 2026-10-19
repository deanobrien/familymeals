import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon, cx } from './internal';
import { IconButton } from './Button';

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  hideLabel?: boolean;
}

function useFieldIds(id?: string) {
  const auto = useId();
  const base = id ?? auto;
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

function Shell({ ids, label, hint, error, hideLabel, className, children }: FieldShellProps & { ids: ReturnType<typeof useFieldIds>; className?: string; children: ReactNode }) {
  return (
    <div className={cx('fr-field', className)}>
      <label htmlFor={ids.id} className={hideLabel ? 'fr-visually-hidden' : 'fr-field__label'}>{label}</label>
      {children}
      {hint && !error && <span id={ids.hintId} className="fr-field__hint">{hint}</span>}
      {error && <span id={ids.errorId} role="alert" className="fr-field__error">{error}</span>}
    </div>
  );
}

function describedBy(ids: ReturnType<typeof useFieldIds>, hint: ReactNode, error: ReactNode) {
  return error ? ids.errorId : hint ? ids.hintId : undefined;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldShellProps {
  wrapperClassName?: string;
}

export function Input({ label, hint, error, hideLabel, wrapperClassName, id, className, ...rest }: InputProps) {
  const ids = useFieldIds(id);
  return (
    <Shell ids={ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={wrapperClassName}>
      <input id={ids.id} className={cx('fr-control', className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(ids, hint, error)} {...rest} />
    </Shell>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldShellProps {
  wrapperClassName?: string;
}

export function Textarea({ label, hint, error, hideLabel, wrapperClassName, id, className, ...rest }: TextareaProps) {
  const ids = useFieldIds(id);
  return (
    <Shell ids={ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={wrapperClassName}>
      <textarea id={ids.id} className={cx('fr-control', className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(ids, hint, error)} {...rest} />
    </Shell>
  );
}

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'>, FieldShellProps {
  options: SelectOption[];
  placeholder?: string;
  wrapperClassName?: string;
}

/** Native select: best mobile UX and free a11y. */
export function Select({ label, hint, error, hideLabel, wrapperClassName, id, className, options, placeholder, ...rest }: SelectProps) {
  const ids = useFieldIds(id);
  return (
    <Shell ids={ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={wrapperClassName}>
      <select id={ids.id} className={cx('fr-control', className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy(ids, hint, error)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </Shell>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  /** Larger target, intended for shopping ticks. */
  large?: boolean;
}

export function Checkbox({ label, large, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx('fr-check', large && 'fr-check--lg', className)}>
      <input type="checkbox" className="fr-check__box" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  onSearch?: (value: string) => void;
}

export function SearchField({ label = 'Search', value, onValueChange, onSearch, className, placeholder = 'Search', ...rest }: SearchFieldProps) {
  const id = useId();
  return (
    <form role="search" className={cx('fr-search', className)} onSubmit={(e) => { e.preventDefault(); onSearch?.(value); }}>
      <label htmlFor={id} className="fr-visually-hidden">{label}</label>
      <Icon name="search" className="fr-icon fr-icon--lead" />
      <input id={id} type="search" className="fr-control" value={value} placeholder={placeholder} onChange={(e) => onValueChange(e.target.value)} {...rest} />
      {value && <IconButton label="Clear search" icon="x" className="fr-search__clear" onClick={() => onValueChange('')} />}
    </form>
  );
}

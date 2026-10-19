import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon, type IconName, Spinner, cx } from './internal';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'primary', size = 'md', loading, className, disabled, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('fr-btn', `fr-btn--${variant}`, size !== 'md' && `fr-btn--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Required accessible name. */
  label: string;
  icon: IconName;
  variant?: 'secondary' | 'ghost' | 'primary';
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, icon, variant = 'ghost', pressed, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} aria-pressed={pressed} className={cx('fr-btn', 'fr-btn--icon', `fr-btn--${variant}`, className)} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export type { ReactNode };

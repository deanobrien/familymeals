'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './shopping.module.css';

/** Minimal accessible popover (button + non-modal dialog). Closes on Escape and outside click. */
export function Popover({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <span className={styles.popover} ref={root}>
      <button
        type="button"
        className={styles.popoverTrigger}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={label} className={styles.popoverBody}>
          {children}
        </div>
      )}
    </span>
  );
}

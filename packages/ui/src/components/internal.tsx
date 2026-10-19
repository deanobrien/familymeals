import type { ReactNode, SVGProps } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const paths = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19h15',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  cart: 'M3 4h2l2 11h11l2-8H6M9 20h.01M17 20h.01',
  users: 'M16 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-2a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.4-2.7a7 7 0 002-1.2l2.4 1 2-3.4-2-1.5c.1-.4.2-.8.2-1.2z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  heart: 'M20.8 5.6a5 5 0 00-7.1 0L12 7.3l-1.7-1.7a5 5 0 10-7.1 7.1L12 21.5l8.8-8.8a5 5 0 000-7.1z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  image: 'M3 5h18v14H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 16l-5-5-8 8',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg className="fr-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}

export function Spinner() {
  return <span className="fr-spinner" aria-hidden="true" />;
}

export type Children = { children?: ReactNode };

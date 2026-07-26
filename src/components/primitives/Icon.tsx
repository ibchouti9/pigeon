/**
 * C-2 Icon — 1.5px stroke, round caps, currentColor.
 * This set is exhaustive. No other icons exist in the MVP.
 */

export type IconName =
  | 'inbox'
  | 'screener-ring'
  | 'archive'
  | 'search'
  | 'compose'
  | 'settings'
  | 'reply'
  | 'reply-all'
  | 'forward'
  | 'attach'
  | 'download'
  | 'close'
  | 'chevron-down'
  | 'chevron-left'
  | 'check'
  | 'minus'
  | 'plus'
  | 'trash'
  | 'pen'
  | 'clock'
  | 'warning'
  | 'external-link'
  | 'expand'
  | 'minimize';

const PATHS: Record<IconName, React.ReactNode> = {
  inbox: (
    <>
      <path d="M3 13h4l1.5 2.5h7L17 13h4" />
      <path d="M3 13 5.5 4.5h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  'screener-ring': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.5" opacity="0.55" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M4.5 8.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12.5h4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  compose: (
    <>
      <path d="M4 20h16" />
      <path d="M14.5 4.5 19 9 9.5 18.5 4 20l1.5-5.5z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </>
  ),
  reply: (
    <>
      <path d="M9 6 3.5 11.5 9 17" />
      <path d="M3.5 11.5h9a8 8 0 0 1 8 8" />
    </>
  ),
  'reply-all': (
    <>
      <path d="M7.5 6 2 11.5 7.5 17" />
      <path d="M12.5 6 7 11.5 12.5 17" />
      <path d="M7 11.5h7.5a6 6 0 0 1 6 6" />
    </>
  ),
  forward: (
    <>
      <path d="M15 6l5.5 5.5L15 17" />
      <path d="M20.5 11.5h-9a8 8 0 0 0-8 8" />
    </>
  ),
  attach: (
    <path d="M18 8.5 10.4 16a3 3 0 0 1-4.3-4.2l7.6-7.6a5 5 0 0 1 7 7L12.9 19a7 7 0 0 1-10-9.8" />
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4 19.5h16" />
    </>
  ),
  close: <path d="m5.5 5.5 13 13M18.5 5.5l-13 13" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-left': <path d="m14.5 6-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4h5v2.5" />
      <path d="M6 6.5 7 20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  pen: (
    <>
      <path d="M14.5 4.5 19 9 9.5 18.5 4 20l1.5-5.5z" />
      <path d="m13 6 5 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.4v.2" />
    </>
  ),
  'external-link': (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  expand: (
    <>
      <path d="M14 4h6v6" />
      <path d="M10 20H4v-6" />
      <path d="M20 4l-7 7M4 20l7-7" />
    </>
  ),
  minimize: (
    <>
      <path d="M14 10h6V4" />
      <path d="M10 14H4v6" />
      <path d="M20 4l-6 6M4 20l6-6" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** 16px in content, 20px in the rail, 24px in empty states. */
  size?: 16 | 20 | 24;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

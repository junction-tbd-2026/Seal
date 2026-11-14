import type { ReactNode, SVGProps } from "react";

/** Line icons drawn on a 24-point grid with round 2-point strokes, sized by the caller. */
function Icon({ children, size = 16, ...props }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };

export const PullIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M6 8.5v7M13 6h3a2 2 0 0 1 2 2v7.5" />
    <path d="m15 3-2.5 3L15 9" />
  </Icon>
);

export const BotIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4.5M9.5 4.5h5M9 13.5v1.5M15 13.5v1.5" />
  </Icon>
);

export const FlaskIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 3v6.2L4.8 18.4A1.7 1.7 0 0 0 6.3 21h11.4a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3" />
    <path d="M8.5 3h7M7.5 15h9" />
  </Icon>
);

export const UserIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Icon>
);

export const FileIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Icon>
);

export const FilesIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15 3H10a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V7z" />
    <path d="M15 3v4h4M5 8v11a2 2 0 0 0 2 2h8" />
  </Icon>
);

export const PanelIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
    <path d="M10 4v16" />
  </Icon>
);

export const ChevronDown = (p: P) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ChevronsUpDown = (p: P) => (
  <Icon {...p}>
    <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const XIcon = (p: P) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const ArrowLeft = (p: P) => (
  <Icon {...p}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Icon>
);

export const ArrowRight = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ArrowUpRight = (p: P) => (
  <Icon {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
);

/** A wavy arrow: going past something without doing it. */
export const SkipIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 14c2.2-3.2 4.4-3.2 6.6 0s4.4 3.2 6.6 0l2.3-3.2" />
    <path d="m15.6 10.2 3-.1.2 3" />
  </Icon>
);

export const RepoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 19.5V5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12" />
  </Icon>
);

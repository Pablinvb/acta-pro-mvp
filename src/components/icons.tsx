import type { SVGProps } from "react";

/**
 * Iconografía mínima en línea, con trazo uniforme.
 * Se evita una librería externa: son pocos iconos y así el paquete no crece.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-5"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.6V20h14V9.6" />
    <path d="M9.5 20v-5.5h5V20" />
  </Base>
);

export const CalendarIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Base>
);

export const DocumentIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Base>
);

export const TrackingIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 19V5M4 19h16" />
    <path d="m7.5 14.5 3.5-4 3 2.5 4.5-6" />
    <circle cx="18.5" cy="7" r="1.4" />
  </Base>
);

export const PlugIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 3v6M15 3v6" />
    <path d="M6 9h12v3a6 6 0 0 1-12 0z" />
    <path d="M12 18v3" />
  </Base>
);

export const MicIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Base>
);

export const ShieldCheckIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 2.8 20 5.6v6.1c0 4.7-3.2 8.7-8 10.3-4.8-1.6-8-5.6-8-10.3V5.6z" />
    <path d="m8.6 12 2.4 2.4 4.4-4.6" />
  </Base>
);

export const SparkIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3.2 13.7 9l5.8 1.7-5.8 1.7L12 18.2 10.3 12.4 4.5 10.7 10.3 9z" />
    <path d="M18.5 3v3M20 4.5h-3" />
  </Base>
);

export const SignatureIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 17.5c2.6 0 3-9 5.4-9 1.7 0 1.4 6.2 3.1 6.2 1.4 0 1.6-3.8 3-3.8 1.2 0 1.3 2.4 2.4 2.4.9 0 1.3-1.1 2.1-1.1" />
    <path d="M3 21h18" />
  </Base>
);

export const UsersIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c0-3.2 2.5-5.4 5.5-5.4s5.5 2.2 5.5 5.4" />
    <path d="M16.5 5.2a3.2 3.2 0 0 1 0 6M17.5 14.9c2 .6 3.5 2.4 3.5 5.1" />
  </Base>
);

export const ClockIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.3l3.3 2" />
  </Base>
);

export const ArrowDownIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4v15M6.5 13.5 12 19l5.5-5.5" />
  </Base>
);

export const CheckIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Base>
);

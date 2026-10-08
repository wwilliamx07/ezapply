import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

export function Button({
  variant = "default",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  const cls = [
    "ez-btn",
    variant !== "default" && `ez-btn-${variant}`,
    size === "sm" && "ez-btn-sm",
    size === "lg" && "ez-btn-lg",
    size === "icon" && "ez-btn-icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={cls} {...rest} />;
}

export function Badge({ tone, children }: { tone?: "ok" | "warn" | "danger" | "accent"; children: ReactNode }) {
  return <span className={tone ? `ez-badge ez-badge-${tone}` : "ez-badge"}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="ez-spinner" role="status">
      {label ? <span className="ez-sr-only">{label}</span> : null}
    </span>
  );
}

export function Banner({
  tone,
  icon,
  children,
}: {
  tone?: "warn" | "danger" | "ok";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={tone ? `ez-banner ez-banner-${tone}` : "ez-banner"} role={tone === "danger" ? "alert" : undefined}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Brand() {
  return (
    <span className="ez-brand">
      <span className="ez-brand-mark" aria-hidden="true">
        e
      </span>
      ezapply
    </span>
  );
}

/** A page that says one thing (answered, replaced, expired, an error). */
export function MessagePage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="ez-message ez-card">
      <Brand />
      <h1>{title}</h1>
      {children}
    </main>
  );
}

const PATHS: Record<string, ReactNode> = {
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  comment: <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />,
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M11 8v6M8 11h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M8 11h6" />
    </>
  ),
  fitWidth: <path d="M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3M4 5v14M20 5v14" />,
  download: <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" />,
  diff: (
    <>
      <path d="M12 4v6M9 7h6" />
      <path d="M9 17h6" />
      <rect x="4" y="2.5" width="16" height="19" rx="2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.01" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  send: <path d="M4 12l16-8-6 16-2.5-6.5z" />,
};

export type IconName = keyof typeof PATHS;

/** A decorative icon: the button or text beside it says what it means. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

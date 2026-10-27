import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

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
    size === "icon" && "ez-btn-icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={cls} {...rest} />;
}

export function Badge({ tone, children }: { tone?: "ok" | "warn"; children: ReactNode }) {
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

/** ezapply's mark: "ez" drawn in strokes on the accent. `static/mark.svg` is the same drawing, for icons. */
export const MARK = {
  background: "#3b5bdb",
  path: "M13 33H31M31 33A9 9 0 1 0 28.89 38.79M37 24H51L37 42H51",
};

export function Brand() {
  return (
    <span className="ez-brand">
      <svg className="ez-brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="15" fill={MARK.background} />
        <path d={MARK.path} fill="none" stroke="#ffffff" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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
  undo: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  reset: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9" />
    </>
  ),
  link: (
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
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
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  wand: (
    <>
      <path d="M5 19L15.5 8.5" />
      <path d="M17 3v3M15.5 4.5h3M20 8v2M19 9h2M12 4v1.5M11.25 4.75h1.5" />
    </>
  ),
  form: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
};

type IconName = keyof typeof PATHS;

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

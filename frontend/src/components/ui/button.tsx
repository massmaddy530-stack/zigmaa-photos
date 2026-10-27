import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon" | "touch";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors select-none " +
  "disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";

const variants: Record<Variant, string> = {
  // Champagne with espresso text (6.1:1); white on champagne would fail contrast. Hover lightens, keeping contrast.
  primary: "bg-brand-400 text-ink shadow-sm ring-1 ring-inset ring-brand-500/40 hover:bg-brand-300 active:bg-brand-300",
  secondary: "bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200 hover:bg-brand-100",
  outline: "border border-line bg-surface text-ink shadow-sm hover:border-brand-200 hover:bg-brand-50",
  ghost: "text-muted hover:bg-brand-50 hover:text-ink",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-9 w-9",
  touch: "h-11 min-w-11 px-2.5 text-sm", // 44px touch target for phone screens
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant, size, loading, icon, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function ButtonLink({ variant, size, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

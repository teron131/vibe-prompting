/** Provides the shared button and button-link surfaces used by workspace navigation and feature controls. */

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

import { cn } from "./utils";

type ButtonVariant = "default" | "destructive" | "ghost" | "outline" | "secondary";
type ButtonSize = "default" | "icon" | "sm";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export type ButtonLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    size?: ButtonSize;
    variant?: ButtonVariant;
  };

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2",
  icon: "size-9",
  sm: "h-8 px-3 text-xs",
};

export function Button({
  className,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button className={buttonClassName({ className, size, variant })} type={type} {...props} />
  );
}

export function ButtonLink({
  className,
  size = "default",
  variant = "default",
  ...props
}: ButtonLinkProps) {
  return <Link className={buttonClassName({ className, size, variant })} {...props} />;
}

function buttonClassName({
  className,
  size,
  variant,
}: {
  className?: string;
  size: ButtonSize;
  variant: ButtonVariant;
}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}

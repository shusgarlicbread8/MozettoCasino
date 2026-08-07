"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { color, font, radius } from "@/lib/design-tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

const sizePad: Record<ButtonSize, string> = {
  sm: "9px 14px",
  md: "12px 20px",
  lg: "14px 28px",
};

const sizeFont: Record<ButtonSize, number> = {
  sm: 12.5,
  md: 13.5,
  lg: 15,
};

function variantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: color.accent,
        color: color.textInverse,
        border: "1px solid transparent",
        fontWeight: 650,
      };
    case "secondary":
      return {
        background: "transparent",
        color: color.text,
        border: `1px solid ${color.lineStrong}`,
        fontWeight: 550,
      };
    case "ghost":
      return {
        background: "transparent",
        color: color.textMuted,
        border: "1px solid transparent",
        fontWeight: 500,
      };
    case "danger":
      return {
        background: "rgba(255,107,107,.12)",
        color: color.danger,
        border: "1px solid rgba(255,107,107,.35)",
        fontWeight: 550,
      };
  }
}

function baseStyle(variant: ButtonVariant, size: ButtonSize, extra?: CSSProperties): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: sizePad[size],
    borderRadius: radius.md,
    fontFamily: font.sans,
    fontSize: sizeFont[size],
    letterSpacing: "-0.01em",
    textDecoration: "none",
    cursor: "pointer",
    lineHeight: 1.2,
    ...variantStyle(variant),
    ...extra,
  };
}

type ButtonProps = Common &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type LinkButtonProps = Common & {
  href: string;
  disabled?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  children,
  className,
  style,
  href,
  ...rest
}: ButtonProps | LinkButtonProps) {
  const cls =
    variant === "primary"
      ? `mz-btn mz-btn-primary ${className ?? ""}`.trim()
      : `mz-btn ${className ?? ""}`.trim();
  const styles = baseStyle(variant, size, style);

  if (href) {
    return (
      <Link href={href} className={cls} style={styles}>
        {children}
      </Link>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type="button" className={cls} style={styles} {...buttonRest}>
      {children}
    </button>
  );
}

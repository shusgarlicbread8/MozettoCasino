import Link from "next/link";
import type { CSSProperties } from "react";
import { color, font } from "@/lib/design-tokens";

type Props = {
  /** Set to `false` for a non-link wordmark (e.g. hero). Default `/`. */
  href?: string | false;
  size?: "sm" | "md" | "lg";
  /** When true, brand wordmark is large enough for hero use */
  hero?: boolean;
  style?: CSSProperties;
};

const markSize = { sm: 22, md: 26, lg: 36 } as const;
const wordSize = { sm: 15, md: 16, lg: 22 } as const;

export function BrandMark({ href, size = "md", hero = false, style }: Props) {
  const s = hero ? "lg" : size;
  const box = markSize[s];
  const word = hero ? 42 : wordSize[s];
  const to = href === false ? null : (href ?? "/");

  const inner = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: hero ? 14 : 10,
        color: color.text,
        textDecoration: "none",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: box,
          height: box,
          borderRadius: hero ? 12 : 8,
          background: `linear-gradient(145deg, ${color.accent}, ${color.feltMid})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 0 24px ${color.accentDim}`,
          flex: "none",
        }}
      >
        <span
          style={{
            width: hero ? 11 : 8,
            height: hero ? 11 : 8,
            background: color.textInverse,
            borderRadius: 2,
            transform: "rotate(45deg)",
          }}
        />
      </span>
      <span
        style={{
          fontFamily: font.display,
          fontSize: word,
          fontWeight: hero ? 700 : 650,
          letterSpacing: hero ? "-0.04em" : "-0.03em",
          lineHeight: 1,
        }}
      >
        Mozetto
      </span>
    </span>
  );

  if (!to) return inner;
  return (
    <Link href={to} style={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </Link>
  );
}

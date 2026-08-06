"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";
import { money } from "@/lib/session";

type Props = {
  value: number;
  /** Prefixed currency formatting via money(); set false to render raw digits. */
  currency?: boolean;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
  fontSize?: number | string;
  mono?: boolean;
};

/**
 * Digit-by-digit split-flap animation when the formatted value changes.
 * Respects prefers-reduced-motion.
 */
export function SplitFlapNumber({
  value,
  currency = true,
  className,
  style,
  color,
  fontSize,
  mono = true,
}: Props) {
  const reduceMotion = useReducedMotion();
  const formatted = currency ? money(value) : String(value);
  const chars = useMemo(() => formatted.split(""), [formatted]);

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    fontVariantNumeric: "tabular-nums",
    fontFamily: mono ? "var(--font-geist-mono), monospace" : undefined,
    color,
    fontSize,
    ...style,
  };

  if (reduceMotion) {
    return (
      <span className={className} style={baseStyle}>
        {formatted}
      </span>
    );
  }

  return (
    <span className={className} style={baseStyle} aria-label={formatted}>
      {chars.map((ch, i) => {
        const isDigit = /[0-9]/.test(ch);
        if (!isDigit) {
          return (
            <span key={`s-${i}-${ch}`} style={{ display: "inline-block" }}>
              {ch}
            </span>
          );
        }
        return (
          <span
            key={`d-${i}`}
            style={{
              display: "inline-block",
              position: "relative",
              overflow: "hidden",
              height: "1.15em",
              lineHeight: 1.15,
              minWidth: "0.62em",
              textAlign: "center",
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={`${i}-${ch}`}
                initial={{ y: "85%", opacity: 0.35 }}
                animate={{ y: "0%", opacity: 1 }}
                exit={{ y: "-85%", opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  display: "block",
                  position: "absolute",
                  inset: 0,
                }}
              >
                {ch}
              </motion.span>
            </AnimatePresence>
            {/* Invisible spacer for layout width */}
            <span style={{ visibility: "hidden" }}>{ch}</span>
          </span>
        );
      })}
    </span>
  );
}

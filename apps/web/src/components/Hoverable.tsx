"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode, type MouseEventHandler } from "react";

type BaseProps = {
  style: CSSProperties;
  hoverStyle: CSSProperties;
  children?: ReactNode;
  onClick?: MouseEventHandler;
};

export function HoverDiv({ style, hoverStyle, children, onClick }: BaseProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={hovered ? { ...style, ...hoverStyle } : style}
    >
      {children}
    </div>
  );
}

export function HoverLink({ href, style, hoverStyle, children }: BaseProps & { href: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={hovered ? { ...style, ...hoverStyle } : style}
    >
      {children}
    </Link>
  );
}

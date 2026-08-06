"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

/** Soft route enter for authenticated app pages. */
export function PageFade({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{ flex: 1, minWidth: 0, width: "100%", display: "flex", flexDirection: "column" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Fade/slide for status lines and step panels. */
export function SoftSwap({
  id,
  children,
  className,
  style,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        className={className}
        style={style}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

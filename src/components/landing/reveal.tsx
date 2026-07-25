"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

export interface RevealProps extends React.ComponentProps<"div"> {
  /** Stagger offset in seconds, for lists that reveal in sequence. */
  delay?: number;
}

/**
 * Fades content up as it scrolls into view, and does nothing at all when the
 * user has asked for reduced motion.
 */
export function Reveal({ delay = 0, children, ...props }: RevealProps) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div {...props}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 0.61, 0.36, 1] }}
      {...(props as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  );
}

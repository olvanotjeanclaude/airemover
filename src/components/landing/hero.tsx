"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDownIcon, CpuIcon, WifiOffIcon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const PROOF_POINTS = [
  { Icon: WifiOffIcon, label: "No uploads" },
  { Icon: CpuIcon, label: "Runs on your device" },
  { Icon: ZapIcon, label: "Pixels never re-encoded" },
];

export function Hero() {
  const reduceMotion = useReducedMotion();

  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-16 sm:pb-24 sm:pt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 grid-backdrop opacity-70" />
        <motion.div
          className="absolute left-1/2 top-[-18rem] size-[42rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--primary) 30%, transparent), transparent 65%)",
          }}
          animate={reduceMotion ? undefined : { scale: [1, 1.08, 1.02], opacity: [0.5, 0.7, 0.55] }}
          transition={{ duration: 18, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
      </div>

      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-5 text-center sm:px-8">
        <motion.span
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur"
        >
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-70" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          Every image stays on this device
        </motion.span>

        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl"
        >
          <span className="text-gradient">Remove Image Metadata Instantly</span>
        </motion.h1>

        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12 }}
          className="max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground"
        >
          Remove EXIF, GPS, XMP, AI metadata and C2PA entirely inside your browser.
          <span className="mt-3 block font-medium text-foreground">
            No uploads. No tracking. 100% private.
          </span>
        </motion.p>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18 }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <Button size="lg" asChild>
            <a href="#cleaner">Start Cleaning</a>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="#how-it-works">
              Learn More
              <ArrowDownIcon />
            </a>
          </Button>
        </motion.div>

        <motion.ul
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.28 }}
          className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm text-muted-foreground"
        >
          {PROOF_POINTS.map(({ Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon className="size-4 text-primary" />
              {label}
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

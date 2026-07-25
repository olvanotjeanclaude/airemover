import * as React from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

export interface SectionProps extends Omit<React.ComponentProps<"section">, "title"> {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Centres the header block. */
  centered?: boolean;
}

export function Section({
  eyebrow,
  title,
  description,
  centered = true,
  className,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={cn("py-20 sm:py-28", className)} {...props}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal
          className={cn(
            "mb-12 flex max-w-2xl flex-col gap-3",
            centered && "mx-auto items-center text-center",
          )}
        >
          {eyebrow ? (
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              {eyebrow}
            </span>
          ) : null}
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          {description ? (
            <p className="text-pretty text-base leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

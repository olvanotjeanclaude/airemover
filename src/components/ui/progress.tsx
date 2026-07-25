"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({
  className,
  value = 0,
  indeterminate = false,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indeterminate?: boolean;
}) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken",
        className,
      )}
      value={indeterminate ? null : value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full rounded-full bg-primary transition-transform duration-300 ease-out",
          indeterminate && "skeleton-shimmer w-1/3",
        )}
        style={
          indeterminate
            ? undefined
            : { transform: `translateX(-${100 - Math.min(100, Math.max(0, value ?? 0))}%)`, width: "100%" }
        }
      />
    </ProgressPrimitive.Root>
  );
}

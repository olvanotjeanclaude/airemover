"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps
  extends Omit<React.ComponentProps<"input">, "type" | "onChange" | "value"> {
  value: number;
  onValueChange: (value: number) => void;
  /** Rendered next to the label, e.g. "92" or "2560 px". */
  displayValue?: string;
  label: string;
  hint?: string;
}

/**
 * A native range input rather than a Radix slider: it is keyboard- and
 * screen-reader-native, works with a coarse pointer without extra code, and
 * saves shipping another dependency for one control. The filled portion of the
 * track is painted from `--slider-fill` by the `.range-control` rules.
 */
export function Slider({
  className,
  label,
  hint,
  displayValue,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  id,
  disabled,
  ...props
}: SliderProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const lower = Number(min);
  const upper = Number(max);
  const percent = ((value - lower) / Math.max(1, upper - lower)) * 100;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
        <span className="tabular text-sm text-muted-foreground">
          {displayValue ?? value}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        className="range-control"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        onChange={(event) => onValueChange(Number(event.target.value))}
        style={{ ["--slider-fill" as string]: `${Math.min(100, Math.max(0, percent))}%` }}
        {...props}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

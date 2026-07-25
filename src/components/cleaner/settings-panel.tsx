"use client";

import * as React from "react";
import { InfoIcon, RotateCcwIcon, ScissorsIcon, WandSparklesIcon } from "lucide-react";
import { CATEGORY_DESCRIPTORS } from "@/constants/categories";
import { MAX_CONCURRENCY, MAX_REBUILD_DIMENSION, MIN_CONCURRENCY } from "@/constants/limits";
import type { RebuildFormat } from "@/types/processing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings-store";

const OUTPUT_FORMATS: { value: RebuildFormat; label: string }[] = [
  { value: "original", label: "Keep original" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

export function SettingsPanel() {
  const mode = useSettingsStore((state) => state.mode);
  const removal = useSettingsStore((state) => state.removal);
  const rebuild = useSettingsStore((state) => state.rebuild);
  const concurrency = useSettingsStore((state) => state.concurrency);
  const filenameSuffix = useSettingsStore((state) => state.filenameSuffix);
  const setMode = useSettingsStore((state) => state.setMode);
  const toggleCategory = useSettingsStore((state) => state.toggleCategory);
  const setRebuild = useSettingsStore((state) => state.setRebuild);
  const setConcurrency = useSettingsStore((state) => state.setConcurrency);
  const setFilenameSuffix = useSettingsStore((state) => state.setFilenameSuffix);
  const resetToDefaults = useSettingsStore((state) => state.resetToDefaults);

  return (
    <div className="flex flex-col gap-5">
      <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
        <TabsList className="w-full">
          <TabsTrigger value="lossless">
            <ScissorsIcon />
            Lossless
          </TabsTrigger>
          <TabsTrigger value="rebuild">
            <WandSparklesIcon />
            Rebuild
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lossless" className="pt-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            The container is parsed, the selected blocks are dropped, and the compressed image
            stream is copied across untouched. Same dimensions, same quality, same compression.
            Only metadata goes.
          </p>
        </TabsContent>

        <TabsContent value="rebuild" className="flex flex-col gap-5 pt-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            The image is decoded, redrawn and re-encoded. Nothing from the original container
            survives, at the cost of a new compression pass. Use it for files the parser cannot
            edit safely, or when you want to resize.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="output-format">Output format</Label>
            <div id="output-format" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {OUTPUT_FORMATS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={rebuild.outputFormat === option.value ? "default" : "outline"}
                  size="sm"
                  aria-pressed={rebuild.outputFormat === option.value}
                  onClick={() => setRebuild({ outputFormat: option.value })}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <Slider
            label="JPEG quality"
            min={40}
            max={100}
            value={rebuild.jpegQuality}
            displayValue={String(rebuild.jpegQuality)}
            onValueChange={(value) => setRebuild({ jpegQuality: value })}
          />

          <Slider
            label="WebP quality"
            min={40}
            max={100}
            value={rebuild.webpQuality}
            displayValue={String(rebuild.webpQuality)}
            onValueChange={(value) => setRebuild({ webpQuality: value })}
          />

          <Slider
            label="PNG compression"
            min={0}
            max={9}
            value={rebuild.pngCompression}
            displayValue={`Level ${rebuild.pngCompression}`}
            hint="Higher levels take longer and produce smaller files. PNG stays pixel-exact at every level."
            onValueChange={(value) => setRebuild({ pngCompression: value })}
          />

          <Separator />

          <SettingRow
            title="Resize"
            description="Scales the longest edge down to the limit below. Smaller images are left alone."
            checked={rebuild.resizeEnabled}
            onCheckedChange={(value) => setRebuild({ resizeEnabled: value })}
          />

          {rebuild.resizeEnabled ? (
            <Slider
              label="Longest edge"
              min={256}
              max={MAX_REBUILD_DIMENSION}
              step={128}
              value={rebuild.maxDimension}
              displayValue={`${rebuild.maxDimension} px`}
              onValueChange={(value) => setRebuild({ maxDimension: value })}
            />
          ) : null}

          <SettingRow
            title="Strip alpha"
            description="Flattens transparency onto a solid background. JPEG always flattens."
            checked={rebuild.stripAlpha}
            onCheckedChange={(value) => setRebuild({ stripAlpha: value })}
          />

          {rebuild.stripAlpha ? (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="matte-color">Background colour</Label>
              <input
                id="matte-color"
                type="color"
                value={rebuild.matteColor}
                onChange={(event) => setRebuild({ matteColor: event.target.value })}
                className="h-9 w-16 cursor-pointer rounded-md border border-border bg-surface p-1"
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      <Separator />

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">What to remove</h3>
        <p className="text-xs text-muted-foreground">
          Everything except the colour profile is removed by default.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {CATEGORY_DESCRIPTORS.map((descriptor) => {
          const checked = removal[descriptor.category];
          const inputId = `removal-${descriptor.category}`;
          return (
            <li key={descriptor.category} className="flex items-start gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={inputId}>{descriptor.label}</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={`What is ${descriptor.label}?`}
                      >
                        <InfoIcon className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{descriptor.description}</TooltipContent>
                  </Tooltip>
                  {descriptor.category === "icc" ? (
                    <Badge variant="neutral">Kept by default</Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {checked || !descriptor.keepWarning
                    ? descriptor.description
                    : descriptor.keepWarning}
                </p>
              </div>
              <Switch
                id={inputId}
                checked={checked}
                onCheckedChange={(value) => toggleCategory(descriptor.category, value)}
                aria-describedby={`${inputId}-description`}
              />
            </li>
          );
        })}
      </ul>

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="filename-suffix">Filename suffix</Label>
          <input
            id="filename-suffix"
            value={filenameSuffix}
            onChange={(event) => setFilenameSuffix(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="h-10 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Cleaned files are saved as <span className="font-mono">photo{filenameSuffix}.jpg</span>
          </p>
        </div>

        <Slider
          label="Parallel workers"
          min={MIN_CONCURRENCY}
          max={MAX_CONCURRENCY}
          value={concurrency}
          displayValue={`${concurrency} at a time`}
          hint="More workers finish a batch faster but use more memory."
          onValueChange={setConcurrency}
        />
      </div>

      <Button variant="ghost" size="sm" onClick={resetToDefaults} className="self-start">
        <RotateCcwIcon />
        Reset to defaults
      </Button>
    </div>
  );
}

function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id}>{title}</Label>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

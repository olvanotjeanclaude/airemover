import type { AiMetadata } from "@/types/metadata";
import { sanitizeForDisplay } from "../../utils/text";
import { createMetadata, setField, type AiTextSource } from "./types";

interface ComfyNode {
  class_type?: string;
  inputs?: Record<string, unknown>;
  _meta?: { title?: string };
}

type ComfyGraph = Record<string, ComfyNode>;

const SAMPLER_CLASSES = [
  "KSampler",
  "KSamplerAdvanced",
  "SamplerCustom",
  "SamplerCustomAdvanced",
  "KSampler (Efficient)",
];

/**
 * ComfyUI writes the executed graph as JSON. The prompt is not stored as a
 * string anywhere: it lives in a `CLIPTextEncode` node that the sampler
 * references by `[nodeId, slot]`, so the graph has to be traversed to tell the
 * positive prompt apart from the negative one.
 */
export function parseComfyUi(source: AiTextSource): AiMetadata | null {
  const graph = parseGraph(source.text);
  if (!graph) return null;

  const nodes = Object.entries(graph);
  const hasComfyShape = nodes.some(
    ([, node]) => typeof node?.class_type === "string" && node.inputs !== undefined,
  );
  if (!hasComfyShape) return null;

  const metadata = createMetadata("comfyui", source, "confirmed");
  const sampler = nodes.find(([, node]) =>
    SAMPLER_CLASSES.some((name) => node.class_type === name),
  )?.[1];

  if (sampler?.inputs) {
    const inputs = sampler.inputs;
    metadata.seed = setField(
      metadata,
      "Seed",
      inputs.seed ?? inputs.noise_seed ?? inputs.rand_seed,
    );
    metadata.steps = setField(metadata, "Steps", inputs.steps);
    metadata.cfgScale = setField(metadata, "CFG scale", inputs.cfg);
    metadata.sampler = setField(metadata, "Sampler", inputs.sampler_name);
    metadata.scheduler = setField(metadata, "Scheduler", inputs.scheduler);
    setField(metadata, "Denoise", inputs.denoise);

    const positive = resolveText(graph, inputs.positive);
    const negative = resolveText(graph, inputs.negative);
    if (positive) metadata.prompt = sanitizeForDisplay(positive, 8000);
    if (negative) metadata.negativePrompt = sanitizeForDisplay(negative, 8000);
  }

  if (!metadata.prompt) {
    const encoders = collectByClass(graph, "CLIPTextEncode")
      .map((node) => asText(node.inputs?.text))
      .filter((text): text is string => Boolean(text));
    if (encoders.length > 0) {
      metadata.prompt = sanitizeForDisplay(encoders[0], 8000);
      if (encoders.length > 1 && !metadata.negativePrompt) {
        metadata.negativePrompt = sanitizeForDisplay(encoders[1], 8000);
      }
    }
  }

  const checkpoint = firstInput(graph, ["CheckpointLoaderSimple", "CheckpointLoader"], [
    "ckpt_name",
  ]);
  const unet = firstInput(graph, ["UNETLoader", "UnetLoaderGGUF"], ["unet_name"]);
  const model = checkpoint ?? unet;
  metadata.model = setField(metadata, "Model", model);
  if (model && /flux/i.test(model)) {
    metadata.generator = "flux";
    metadata.generatorLabel = "Flux";
  }

  metadata.vae = setField(
    metadata,
    "VAE",
    firstInput(graph, ["VAELoader"], ["vae_name"]),
  );
  metadata.size = setField(metadata, "Size", describeLatent(graph));

  const loras = collectByClass(graph, "LoraLoader")
    .concat(collectByClass(graph, "LoraLoaderModelOnly"))
    .map((node) => asText(node.inputs?.lora_name))
    .filter((name): name is string => Boolean(name));
  if (loras.length > 0) {
    metadata.loras = [...new Set(loras)];
    setField(metadata, "LoRA", metadata.loras.join(", "));
  }

  const controlNets = nodes
    .filter(([, node]) => (node.class_type ?? "").includes("ControlNet"))
    .map(([, node]) => asText(node.inputs?.control_net_name))
    .filter((name): name is string => Boolean(name));
  if (controlNets.length > 0) {
    metadata.controlNets = [...new Set(controlNets)];
    setField(metadata, "ControlNet", metadata.controlNets.join(", "));
  }

  setField(metadata, "Nodes", nodes.length);
  return metadata;
}

function parseGraph(text: string): ComfyGraph | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // The UI-format `workflow` blob nests the real nodes under `nodes`.
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.nodes)) return normalizeUiWorkflow(record.nodes);
    return record as ComfyGraph;
  } catch {
    return null;
  }
}

interface UiNode {
  id?: number;
  type?: string;
  widgets_values?: unknown[];
}

/** The UI workflow format stores widget values positionally instead of by name. */
function normalizeUiWorkflow(nodes: unknown[]): ComfyGraph {
  const graph: ComfyGraph = {};
  nodes.forEach((raw, index) => {
    const node = raw as UiNode;
    if (!node || typeof node.type !== "string") return;
    const values = node.widgets_values ?? [];
    const inputs: Record<string, unknown> = {};
    if (node.type === "CLIPTextEncode") inputs.text = values[0];
    if (node.type === "CheckpointLoaderSimple") inputs.ckpt_name = values[0];
    if (node.type === "UNETLoader") inputs.unet_name = values[0];
    if (node.type === "VAELoader") inputs.vae_name = values[0];
    if (node.type === "LoraLoader") inputs.lora_name = values[0];
    if (node.type === "EmptyLatentImage") {
      inputs.width = values[0];
      inputs.height = values[1];
      inputs.batch_size = values[2];
    }
    if (node.type === "KSampler") {
      inputs.seed = values[0];
      inputs.steps = values[2];
      inputs.cfg = values[3];
      inputs.sampler_name = values[4];
      inputs.scheduler = values[5];
      inputs.denoise = values[6];
    }
    graph[String(node.id ?? index)] = { class_type: node.type, inputs };
  });
  return graph;
}

/** Follows a `[nodeId, outputSlot]` link to the text it ultimately encodes. */
function resolveText(
  graph: ComfyGraph,
  link: unknown,
  depth = 0,
): string | undefined {
  if (depth > 6) return undefined;
  if (typeof link === "string") return link;
  if (!Array.isArray(link) || link.length === 0) return undefined;
  const nodeId = String(link[0]);
  const node = graph[nodeId];
  if (!node?.inputs) return undefined;

  const direct = asText(node.inputs.text ?? node.inputs.text_g ?? node.inputs.prompt);
  if (direct) return direct;

  for (const key of ["conditioning", "conditioning_to", "clip", "text"]) {
    const nested = resolveText(graph, node.inputs[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function collectByClass(graph: ComfyGraph, className: string): ComfyNode[] {
  return Object.values(graph).filter((node) => node.class_type === className);
}

function firstInput(
  graph: ComfyGraph,
  classNames: readonly string[],
  inputKeys: readonly string[],
): string | undefined {
  for (const className of classNames) {
    for (const node of collectByClass(graph, className)) {
      for (const key of inputKeys) {
        const value = asText(node.inputs?.[key]);
        if (value) return value;
      }
    }
  }
  return undefined;
}

function describeLatent(graph: ComfyGraph): string | undefined {
  for (const className of ["EmptyLatentImage", "EmptySD3LatentImage"]) {
    for (const node of collectByClass(graph, className)) {
      const width = node.inputs?.width;
      const height = node.inputs?.height;
      if (typeof width === "number" && typeof height === "number") {
        return `${width}x${height}`;
      }
    }
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

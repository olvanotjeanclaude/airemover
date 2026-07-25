/**
 * The Automatic1111 settings line is a comma-separated `Key: value` list where
 * values may themselves contain commas inside quotes or braces:
 *
 *   Steps: 20, Lora hashes: "detail: a1b2, film: c3d4", Hashes: {"model":"x"}
 *
 * A naive `split(",")` corrupts those, so the line is tokenised by hand.
 */
export function splitSettingsLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quote) {
      current += character;
      if (character === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "{" || character === "[" || character === "(") depth += 1;
    if (character === "}" || character === "]" || character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Splits a `Key: value` token on its first colon only. */
export function parseSettingsPairs(line: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const token of splitSettingsLine(line)) {
    const colon = token.indexOf(":");
    if (colon <= 0) continue;
    const key = token.slice(0, colon).trim();
    const value = unquote(token.slice(colon + 1).trim());
    if (key && value) pairs.set(key.toLowerCase(), value);
  }
  return pairs;
}

export function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * True when a line looks like the trailing settings line rather than prompt
 * text: it needs at least two recognised keys to avoid matching a prompt that
 * merely happens to contain a colon.
 */
export function isSettingsLine(line: string): boolean {
  const pairs = parseSettingsPairs(line);
  if (pairs.size < 2) return false;
  const knownKeys = [
    "steps",
    "sampler",
    "cfg scale",
    "seed",
    "size",
    "model",
    "model hash",
    "scheduler",
    "denoising strength",
    "clip skip",
    "version",
    "guidance",
    "distilled cfg scale",
  ];
  let matches = 0;
  for (const key of pairs.keys()) {
    if (knownKeys.includes(key)) matches += 1;
  }
  return matches >= 2;
}

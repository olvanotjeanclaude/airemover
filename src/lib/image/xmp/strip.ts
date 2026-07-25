/**
 * Surgical XMP editing for the case where a user keeps XMP but still wants the
 * generator data gone. Whole-packet removal is handled by the container
 * cleaners; this module only rewrites a packet in place.
 */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface XmpStripResult {
  text: string;
  changed: boolean;
  removedProperties: string[];
}

/** Removes a property in both its element form and its attribute form. */
function removeProperty(
  xmp: string,
  property: string,
  shouldRemove: (value: string) => boolean,
): { text: string; removed: boolean } {
  const name = escapeForRegex(property);
  let removed = false;
  let text = xmp;

  const elementPattern = new RegExp(
    `\\s*<${name}(\\s[^>]*)?>[\\s\\S]*?</${name}>`,
    "gi",
  );
  text = text.replace(elementPattern, (match) => {
    const inner = match.replace(/<[^>]*>/g, "").trim();
    if (!shouldRemove(inner)) return match;
    removed = true;
    return "";
  });

  const selfClosing = new RegExp(`\\s*<${name}(\\s[^>]*)?/>`, "gi");
  text = text.replace(selfClosing, (match) => {
    if (!shouldRemove(match)) return match;
    removed = true;
    return "";
  });

  const attributePattern = new RegExp(`\\s+${name}\\s*=\\s*("[^"]*"|'[^']*')`, "gi");
  text = text.replace(attributePattern, (match, quoted: string) => {
    const value = quoted.slice(1, -1);
    if (!shouldRemove(value)) return match;
    removed = true;
    return "";
  });

  return { text, removed };
}

const ALWAYS = (): boolean => true;

/** Namespace prefixes only ever emitted by image generators. */
const AI_NAMESPACE_PREFIXES = [
  "sdxl",
  "comfy",
  "invokeai",
  "novelai",
  "fooocus",
  "stableDiffusion",
];

/**
 * Removes generator data from an XMP packet while preserving the rest.
 * `isAiText` decides whether a shared field (a description, a creator tool)
 * actually holds generation parameters rather than a legitimate caption.
 */
export function stripAiFromXmp(
  xmp: string,
  isAiText: (value: string) => boolean,
): XmpStripResult {
  let text = xmp;
  const removedProperties: string[] = [];

  const conditional: string[] = [
    "exif:UserComment",
    "dc:description",
    "dc:title",
    "xmp:CreatorTool",
    "tiff:ImageDescription",
    "photoshop:Instructions",
  ];
  for (const property of conditional) {
    const result = removeProperty(text, property, isAiText);
    text = result.text;
    if (result.removed) removedProperties.push(property);
  }

  const digitalSource = removeProperty(
    text,
    "Iptc4xmpExt:DigitalSourceType",
    (value) => value.toLowerCase().includes("algorithmicmedia"),
  );
  text = digitalSource.text;
  if (digitalSource.removed) removedProperties.push("Iptc4xmpExt:DigitalSourceType");

  for (const prefix of AI_NAMESPACE_PREFIXES) {
    const pattern = new RegExp(
      `\\s*<${escapeForRegex(prefix)}:[\\w.-]+(\\s[^>]*)?(/>|>[\\s\\S]*?</${escapeForRegex(prefix)}:[\\w.-]+>)`,
      "gi",
    );
    const before = text;
    text = text.replace(pattern, "");
    if (text !== before) removedProperties.push(`${prefix}:*`);
  }

  return { text, changed: text !== xmp, removedProperties };
}

/** Removes the C2PA provenance links a packet may carry. */
export function stripProvenanceFromXmp(xmp: string): XmpStripResult {
  let text = xmp;
  const removedProperties: string[] = [];
  for (const property of ["dcterms:provenance", "xmpMM:Manifest", "c2pa:manifest"]) {
    const result = removeProperty(text, property, ALWAYS);
    text = result.text;
    if (result.removed) removedProperties.push(property);
  }
  return { text, changed: text !== xmp, removedProperties };
}

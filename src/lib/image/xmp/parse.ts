import type { XmpSummary } from "@/types/metadata";
import { sanitizeForDisplay } from "../utils/text";

/**
 * XMP is parsed with targeted expressions rather than a DOM parser: workers
 * have no `DOMParser`, and shipping an XML parser to read six properties would
 * cost more than it returns.
 */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reads a property written either as an attribute or as a child element. */
export function readXmpProperty(xmp: string, property: string): string | undefined {
  const name = escapeForRegex(property);

  const attribute = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(xmp);
  if (attribute?.[1]) return decodeXmlEntities(attribute[1]).trim() || undefined;

  const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i").exec(xmp);
  if (singleQuoted?.[1]) {
    return decodeXmlEntities(singleQuoted[1]).trim() || undefined;
  }

  const element = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xmp);
  if (!element?.[1]) return undefined;

  const inner = element[1];
  // Language alternatives and bags wrap the real value in <rdf:li>.
  const listItem = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i.exec(inner);
  const raw = listItem?.[1] ?? inner;
  const text = decodeXmlEntities(stripTags(raw)).trim();
  return text || undefined;
}

/** Reads every `<rdf:li>` under a property, used for keyword bags. */
export function readXmpList(xmp: string, property: string): string[] {
  const name = escapeForRegex(property);
  const element = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xmp);
  if (!element?.[1]) return [];
  const items: string[] = [];
  const pattern = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/gi;
  let match = pattern.exec(element[1]);
  while (match) {
    const text = decodeXmlEntities(stripTags(match[1])).trim();
    if (text) items.push(text);
    match = pattern.exec(element[1]);
  }
  return items;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&amp;/g, "&");
}

/** Markers that mean the packet carries C2PA / Content Credentials linkage. */
const PROVENANCE_MARKERS = [
  "c2pa",
  "contentauth",
  "dcterms:provenance",
  "xmpmm:manifest",
  "cai:",
];

export function xmpHasProvenance(xmp: string): boolean {
  const lower = xmp.toLowerCase();
  return PROVENANCE_MARKERS.some((marker) => lower.includes(marker));
}

export function summarizeXmp(packets: string[], bytes: number): XmpSummary {
  const joined = packets.join("\n");
  const description =
    readXmpProperty(joined, "dc:description") ??
    readXmpProperty(joined, "exif:UserComment");

  return {
    packets: packets.length,
    bytes,
    toolkit: readXmpProperty(joined, "x:xmptk"),
    creator:
      readXmpProperty(joined, "dc:creator") ??
      readXmpProperty(joined, "xmp:CreatorTool") ??
      readXmpProperty(joined, "photoshop:Credit"),
    rights: readXmpProperty(joined, "dc:rights"),
    title: readXmpProperty(joined, "dc:title"),
    description: description ? sanitizeForDisplay(description, 600) : undefined,
    createDate:
      readXmpProperty(joined, "xmp:CreateDate") ??
      readXmpProperty(joined, "photoshop:DateCreated"),
    documentId:
      readXmpProperty(joined, "xmpMM:DocumentID") ??
      readXmpProperty(joined, "xmpMM:OriginalDocumentID"),
    hasProvenance: xmpHasProvenance(joined),
  };
}

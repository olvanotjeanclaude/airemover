import type { ImageFormat } from "@/types/image";
import type { MetadataSegment } from "@/types/metadata";
import { collectExifAiSources, parseTiff } from "../exif";
import { createBundle, type ParsedContainer } from "../parser/types";
import { ByteReader, asciiOf } from "../utils/bytes";
import { decodeUtf8 } from "../utils/text";
import { isC2paUuid } from "../c2pa";
import { extractXmpPacket } from "../xmp";
import { boxPayload, findBox, parseBoxes, readBrands, type BmffBox } from "./boxes";
import { checkLosslessSupport } from "./clean";
import {
  classifyItem,
  exifPayloadOfItem,
  idatBox,
  itemLocationsById,
  readItemData,
} from "./items";
import {
  normalizeItemLocations,
  parseItemInfo,
  parseItemLocation,
  readPrimaryItemId,
} from "./meta";

export function inspectIsobmff(bytes: Uint8Array, format: ImageFormat): ParsedContainer {
  const topLevel = parseBoxes(bytes);
  const bundle = createBundle();
  const segments: MetadataSegment[] = [];
  const warnings: string[] = [];

  const ftyp = findBox(topLevel, "ftyp");
  const brands = ftyp ? readBrands(bytes, ftyp) : [];
  const meta = findBox(topLevel, "meta");

  for (const box of topLevel) {
    if (box.type === "uuid" && box.uuid && isC2paUuid(box.uuid)) {
      segments.push({
        id: `uuid@${box.offset}`,
        category: "c2pa",
        container: "uuid",
        label: "C2PA manifest (BMFF uuid box)",
        offset: box.offset,
        size: box.size,
      });
      bundle.c2paPayloads.push(boxPayload(bytes, box));
      bundle.c2paLocation = `${format.toUpperCase()} uuid box (JUMBF)`;
    }
  }

  let width: number | undefined;
  let height: number | undefined;
  let bitDepth: number | undefined;
  let channels: number | undefined;
  let hasAlpha = false;

  if (meta) {
    const metaChildren = meta.children ?? [];
    const ilocBox = findBox(metaChildren, "iloc");
    const iinfBox = findBox(metaChildren, "iinf");
    const idat = idatBox(meta);

    const locations = ilocBox
      ? normalizeItemLocations(parseItemLocation(bytes, ilocBox).items)
      : [];
    const locationsById = itemLocationsById(locations);
    const iinf = iinfBox ? parseItemInfo(bytes, iinfBox) : null;
    const primaryItemId = readPrimaryItemId(bytes, meta);

    for (const entry of iinf?.entries ?? []) {
      const location = locationsById.get(entry.itemId);
      const data = readItemData(bytes, location, idat);
      const classified = classifyItem(entry, data);
      if (!classified.category) continue;

      const size =
        (location?.extents.reduce((total, extent) => total + extent.length, 0) ?? 0) +
        entry.raw.length;

      segments.push({
        id: `item${entry.itemId}`,
        category:
          classified.category === "other" ? "other" : (classified.category as MetadataSegment["category"]),
        container: entry.itemType || "item",
        label: classified.label,
        detail: entry.itemName || entry.contentType,
        offset: location?.extents[0]?.offset ?? meta.offset,
        size,
      });

      if (!data) {
        warnings.push(`Item ${entry.itemId} (${classified.label}) could not be located`);
        continue;
      }

      if (classified.category === "exif") {
        const payload = exifPayloadOfItem(data);
        if (payload) bundle.exifPayloads.push(payload);
        else warnings.push("The EXIF item does not contain a readable TIFF header");
      } else if (classified.category === "xmp") {
        const packet = extractXmpPacket(data);
        if (packet) {
          bundle.xmpPackets.push(packet.text);
          bundle.xmpBytes += size;
        } else {
          bundle.xmpPackets.push(decodeUtf8(data));
          bundle.xmpBytes += size;
        }
      } else if (classified.category === "c2pa") {
        bundle.c2paPayloads.push(data);
        bundle.c2paLocation = `${format.toUpperCase()} metadata item (JUMBF)`;
      }
    }

    const properties = readPrimaryProperties(bytes, meta, primaryItemId);
    width = properties.width;
    height = properties.height;
    bitDepth = properties.bitDepth;
    channels = properties.channels;
    hasAlpha = properties.hasAlpha;
    if (properties.iccProfile) bundle.iccPayloads.push(properties.iccProfile);
    if (properties.iccSegment) segments.push(properties.iccSegment);
  } else {
    warnings.push("No metadata box was found in this file");
  }

  for (const payload of bundle.exifPayloads) {
    try {
      const tree = parseTiff(payload);
      bundle.aiSources.push(...collectExifAiSources(tree, `${format.toUpperCase()} EXIF`));
    } catch {
      // The summary layer surfaces the failure.
    }
  }

  for (const packet of bundle.xmpPackets) {
    bundle.aiSources.push({
      origin: `${format.toUpperCase()} XMP`,
      key: "xmp",
      text: packet,
      bytes: packet.length,
    });
  }

  const blockedReason = checkLosslessSupport(bytes);

  return {
    format,
    container: {
      format,
      width,
      height,
      colorSpace: channels === 1 ? "Monochrome" : "YCbCr",
      bitDepth,
      channels,
      hasAlpha,
      isAnimated: brands.includes("avis") || brands.includes("msf1"),
      isProgressive: false,
      encoding: brands.length > 0 ? `Brands: ${brands.slice(0, 4).join(", ")}` : undefined,
    },
    segments,
    bundle,
    warnings,
    losslessSupported: blockedReason === undefined,
    losslessBlockedReason: blockedReason,
  };
}

interface PrimaryProperties {
  width?: number;
  height?: number;
  bitDepth?: number;
  channels?: number;
  hasAlpha: boolean;
  iccProfile?: Uint8Array;
  iccSegment?: MetadataSegment;
}

/**
 * Reads the property container (`ipco`). Geometry lives in `ispe`, bit depth
 * and channel count in `pixi` or `av1C`, and the colour profile in `colr`.
 */
function readPrimaryProperties(
  bytes: Uint8Array,
  meta: BmffBox,
  primaryItemId: number | undefined,
): PrimaryProperties {
  const result: PrimaryProperties = { hasAlpha: false };
  const iprp = findBox(meta.children ?? [], "iprp");
  const ipco = iprp ? findBox(iprp.children ?? [], "ipco") : undefined;
  if (!ipco?.children) return result;

  for (const property of ipco.children) {
    const payload = boxPayload(bytes, property);

    if (property.type === "ispe" && payload.length >= 12 && result.width === undefined) {
      const reader = new ByteReader(payload, 4);
      result.width = reader.u32();
      result.height = reader.u32();
      continue;
    }

    if (property.type === "pixi" && payload.length >= 5 && result.bitDepth === undefined) {
      const channelCount = payload[4];
      result.channels = channelCount;
      if (payload.length >= 5 + channelCount) result.bitDepth = payload[5];
      continue;
    }

    if (property.type === "av1C" && payload.length >= 3 && result.bitDepth === undefined) {
      const flags = payload[2];
      const highBitDepth = (flags & 0x40) !== 0;
      const twelveBit = (flags & 0x20) !== 0;
      result.bitDepth = twelveBit ? 12 : highBitDepth ? 10 : 8;
      const monochrome = (flags & 0x10) !== 0;
      result.channels = result.channels ?? (monochrome ? 1 : 3);
      continue;
    }

    if (property.type === "auxC") {
      result.hasAlpha = true;
      continue;
    }

    if (property.type === "colr" && payload.length > 4) {
      const colourType = asciiOf(payload.subarray(0, 4));
      if ((colourType === "prof" || colourType === "rICC") && payload.length > 4) {
        result.iccProfile = payload.subarray(4);
        result.iccSegment = {
          id: `colr@${property.offset}`,
          category: "icc",
          container: "colr",
          label: "ICC colour profile",
          offset: property.offset,
          size: property.size,
        };
      }
    }
  }

  if (primaryItemId === undefined) return result;
  return result;
}

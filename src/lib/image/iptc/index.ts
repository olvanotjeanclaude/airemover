import type { IptcSummary } from "@/types/metadata";
import { ByteReader, asciiOf } from "../utils/bytes";
import { decodeLatin1, decodeUtf8, trimNulls } from "../utils/text";

/** Photoshop image resource block identifiers we care about. */
export const PHOTOSHOP_RESOURCE = {
  IptcNaa: 0x0404,
  IccProfile: 0x040f,
  ExifData1: 0x0422,
  ExifData3: 0x0423,
  Xmp: 0x0424,
  CaptionDigest: 0x0425,
  PrintScale: 0x0426,
} as const;

export interface PhotoshopResource {
  id: number;
  name: string;
  data: Uint8Array;
  /** Offset of the whole 8BIM block inside the APP13 payload. */
  offset: number;
  size: number;
}

/**
 * Walks the 8BIM image resource blocks of a Photoshop APP13 payload.
 * `payload` must start immediately after the "Photoshop 3.0\0" identifier.
 */
export function parsePhotoshopResources(payload: Uint8Array): PhotoshopResource[] {
  const resources: PhotoshopResource[] = [];
  const reader = new ByteReader(payload);

  while (reader.has(12)) {
    const blockStart = reader.offset;
    if (reader.ascii(4) !== "8BIM") break;
    const id = reader.u16();

    const nameLength = reader.u8();
    if (!reader.has(nameLength)) break;
    const name = trimNulls(decodeLatin1(reader.take(nameLength)));
    // The Pascal string including its length byte is padded to an even size.
    if ((nameLength + 1) % 2 === 1) {
      if (!reader.has(1)) break;
      reader.skip(1);
    }

    if (!reader.has(4)) break;
    const size = reader.u32();
    if (!reader.has(size)) break;
    const data = reader.take(size);
    if (size % 2 === 1 && reader.has(1)) reader.skip(1);

    resources.push({
      id,
      name,
      data,
      offset: blockStart,
      size: reader.offset - blockStart,
    });
  }

  return resources;
}

const IIM_MARKER = 0x1c;

export interface IptcRecord {
  record: number;
  dataset: number;
  value: Uint8Array;
}

/** Parses IPTC IIM datasets out of a Photoshop 0x0404 resource. */
export function parseIptcRecords(payload: Uint8Array): IptcRecord[] {
  const records: IptcRecord[] = [];
  const reader = new ByteReader(payload);

  while (reader.has(5)) {
    if (reader.peekU8() !== IIM_MARKER) {
      // Resync: some writers pad between datasets.
      reader.skip(1);
      continue;
    }
    reader.skip(1);
    const record = reader.u8();
    const dataset = reader.u8();
    let length = reader.u16();
    if (length & 0x8000) {
      // Extended dataset: the low bits give the size of the real length field.
      const lengthBytes = length & 0x7fff;
      if (lengthBytes > 4 || !reader.has(lengthBytes)) break;
      length = 0;
      for (let index = 0; index < lengthBytes; index += 1) {
        length = length * 256 + reader.u8();
      }
    }
    if (!reader.has(length)) break;
    records.push({ record, dataset, value: reader.take(length) });
  }

  return records;
}

const DATASET = {
  RecordVersion: 0,
  ObjectName: 5,
  Keywords: 25,
  DateCreated: 55,
  TimeCreated: 60,
  Byline: 80,
  BylineTitle: 85,
  City: 90,
  ProvinceState: 95,
  CountryName: 101,
  Headline: 105,
  Credit: 110,
  Source: 115,
  CopyrightNotice: 116,
  Caption: 120,
  Writer: 122,
} as const;

/**
 * IIM has no encoding field in practice. UTF-8 is tried first because modern
 * writers use it, with Latin-1 as the fallback for legacy records.
 */
function decodeIptcValue(bytes: Uint8Array): string {
  const utf8 = decodeUtf8(bytes);
  const replacementChar = String.fromCharCode(0xfffd);
  if (!utf8.includes(replacementChar)) return trimNulls(utf8);
  return trimNulls(decodeLatin1(bytes));
}

export function summarizeIptc(records: readonly IptcRecord[]): IptcSummary {
  const application = records.filter((entry) => entry.record === 2);
  const single = (dataset: number): string | undefined => {
    const found = application.find((entry) => entry.dataset === dataset);
    return found ? decodeIptcValue(found.value) || undefined : undefined;
  };
  const many = (dataset: number): string[] =>
    application
      .filter((entry) => entry.dataset === dataset)
      .map((entry) => decodeIptcValue(entry.value))
      .filter((value) => value.length > 0);

  const keywords = many(DATASET.Keywords);

  return {
    byline: single(DATASET.Byline),
    bylineTitle: single(DATASET.BylineTitle),
    credit: single(DATASET.Credit),
    source: single(DATASET.Source),
    copyrightNotice: single(DATASET.CopyrightNotice),
    caption: single(DATASET.Caption),
    headline: single(DATASET.Headline),
    keywords: keywords.length > 0 ? keywords : undefined,
    city: single(DATASET.City),
    country: single(DATASET.CountryName),
    dateCreated: single(DATASET.DateCreated),
    fieldCount: application.filter(
      (entry) => entry.dataset !== DATASET.RecordVersion,
    ).length,
  };
}

/** True when the payload begins with the Photoshop APP13 identifier. */
export function photoshopIdentifierLength(payload: Uint8Array): number {
  const identifiers = ["Photoshop 3.0\0", "Adobe_Photoshop2.5\0"];
  for (const identifier of identifiers) {
    if (asciiOf(payload.subarray(0, identifier.length)) === identifier) {
      return identifier.length;
    }
  }
  return 0;
}

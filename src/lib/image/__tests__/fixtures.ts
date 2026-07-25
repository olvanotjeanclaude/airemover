import { deflateSync, zlibSync } from "fflate";
import { crc32 } from "../utils/crc32";

/**
 * Fixtures are hand-assembled from the specifications rather than produced by
 * the writers under test, so a bug in a writer cannot hide behind a fixture
 * built by the same code.
 */

export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    out[index] = text.charCodeAt(index) & 0xff;
  }
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

export function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

export function u32le(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

// ---------------------------------------------------------------------------
// TIFF / EXIF
// ---------------------------------------------------------------------------

export interface TiffEntrySpec {
  tag: number;
  type: number;
  count: number;
  /** Value bytes; anything over four is written out of line automatically. */
  value: Uint8Array;
  /** Set when the value is a pointer to a nested directory. */
  subEntries?: TiffEntrySpec[];
}

/**
 * Builds a big-endian TIFF payload. Layout: header, IFD0, out-of-line values,
 * then any nested directories with their own values.
 */
export function buildTiff(entries: TiffEntrySpec[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const header = concat([ascii("MM"), u16be(42), u32be(8)]);
  parts.push(header);

  const layout = layoutIfd(entries, 8);
  parts.push(layout.bytes);
  return concat(parts);
}

interface IfdLayout {
  bytes: Uint8Array;
}

function layoutIfd(entries: TiffEntrySpec[], baseOffset: number): IfdLayout {
  const directorySize = 2 + entries.length * 12 + 4;
  const externals: { at: number; bytes: Uint8Array }[] = [];
  const nested: { at: number; entries: TiffEntrySpec[] }[] = [];

  let valueCursor = baseOffset + directorySize;
  const directory = new Uint8Array(directorySize);
  const view = new DataView(directory.buffer);
  view.setUint16(0, entries.length);

  entries.forEach((entry, index) => {
    const recordAt = 2 + index * 12;
    view.setUint16(recordAt, entry.tag);
    view.setUint16(recordAt + 2, entry.type);
    view.setUint32(recordAt + 4, entry.count);

    if (entry.subEntries) {
      nested.push({ at: recordAt + 8, entries: entry.subEntries });
      return;
    }

    if (entry.value.length <= 4) {
      directory.set(entry.value, recordAt + 8);
      return;
    }

    if (valueCursor % 2 === 1) valueCursor += 1;
    view.setUint32(recordAt + 8, valueCursor);
    externals.push({ at: valueCursor, bytes: entry.value });
    valueCursor += entry.value.length;
  });

  view.setUint32(directorySize - 4, 0);

  // Materialise the whole block, then place the nested directories after it.
  const blocks: { at: number; bytes: Uint8Array }[] = [
    { at: baseOffset, bytes: directory },
    ...externals,
  ];

  let nestedCursor = valueCursor;
  for (const child of nested) {
    if (nestedCursor % 2 === 1) nestedCursor += 1;
    const childLayout = layoutIfd(child.entries, nestedCursor);
    view.setUint32(child.at, nestedCursor);
    blocks.push({ at: nestedCursor, bytes: childLayout.bytes });
    nestedCursor += childLayout.bytes.length;
  }

  const end = blocks.reduce((max, block) => Math.max(max, block.at + block.bytes.length), 0);
  const out = new Uint8Array(end - baseOffset);
  for (const block of blocks) out.set(block.bytes, block.at - baseOffset);
  return { bytes: out };
}

export function asciiValue(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1);
  out.set(ascii(text), 0);
  return out;
}

/** ASCII entries must declare a count that includes the terminating NUL. */
export function asciiEntry(tag: number, text: string): TiffEntrySpec {
  const value = asciiValue(text);
  return { tag, type: 2, count: value.length, value };
}

export function rational(numerator: number, denominator: number): Uint8Array {
  return concat([u32be(numerator), u32be(denominator)]);
}

export const TAGS = {
  ImageWidth: 0x0100,
  ImageLength: 0x0101,
  BitsPerSample: 0x0102,
  Compression: 0x0103,
  Photometric: 0x0106,
  ImageDescription: 0x010e,
  Make: 0x010f,
  Model: 0x0110,
  StripOffsets: 0x0111,
  SamplesPerPixel: 0x0115,
  RowsPerStrip: 0x0116,
  StripByteCounts: 0x0117,
  Software: 0x0131,
  Artist: 0x013b,
  ExifIFD: 0x8769,
  GpsIFD: 0x8825,
  UserComment: 0x9286,
  GpsLatitudeRef: 0x0001,
  GpsLatitude: 0x0002,
  GpsLongitudeRef: 0x0003,
  GpsLongitude: 0x0004,
} as const;

/** A TIFF payload with camera identity, a user comment and a GPS directory. */
export function buildExifPayload(options?: { userComment?: string }): Uint8Array {
  const comment = options?.userComment ?? "Hello from the camera";
  const commentValue = concat([ascii("ASCII\0\0\0"), ascii(comment)]);

  return buildTiff([
    asciiEntry(TAGS.Make, "Canon"),
    asciiEntry(TAGS.Model, "EOS R5x"),
    asciiEntry(TAGS.Software, "v1.2.3"),
    {
      tag: TAGS.ExifIFD,
      type: 4,
      count: 1,
      value: new Uint8Array(4),
      subEntries: [
        {
          tag: TAGS.UserComment,
          type: 7,
          count: commentValue.length,
          value: commentValue,
        },
      ],
    },
    {
      tag: TAGS.GpsIFD,
      type: 4,
      count: 1,
      value: new Uint8Array(4),
      subEntries: [
        asciiEntry(TAGS.GpsLatitudeRef, "N"),
        {
          tag: TAGS.GpsLatitude,
          type: 5,
          count: 3,
          value: concat([rational(48, 1), rational(51, 1), rational(2999, 100)]),
        },
        asciiEntry(TAGS.GpsLongitudeRef, "E"),
        {
          tag: TAGS.GpsLongitude,
          type: 5,
          count: 3,
          value: concat([rational(2, 1), rational(17, 1), rational(2802, 100)]),
        },
      ],
    },
  ]);
}

/** A standalone TIFF image with one strip of pixel data plus metadata tags. */
export function buildTiffImage(pixelData: Uint8Array): Uint8Array {
  // The strip is appended after everything else, so its offset is patched in.
  const entries: TiffEntrySpec[] = [
    { tag: TAGS.ImageWidth, type: 3, count: 1, value: u16be(2) },
    { tag: TAGS.ImageLength, type: 3, count: 1, value: u16be(2) },
    { tag: TAGS.BitsPerSample, type: 3, count: 1, value: u16be(8) },
    { tag: TAGS.Compression, type: 3, count: 1, value: u16be(1) },
    { tag: TAGS.Photometric, type: 3, count: 1, value: u16be(1) },
    { tag: TAGS.StripOffsets, type: 4, count: 1, value: u32be(0) },
    { tag: TAGS.SamplesPerPixel, type: 3, count: 1, value: u16be(1) },
    { tag: TAGS.RowsPerStrip, type: 3, count: 1, value: u16be(2) },
    { tag: TAGS.StripByteCounts, type: 4, count: 1, value: u32be(pixelData.length) },
    asciiEntry(TAGS.Make, "Canon"),
    asciiEntry(TAGS.Artist, "Jess"),
    {
      tag: TAGS.GpsIFD,
      type: 4,
      count: 1,
      value: new Uint8Array(4),
      subEntries: [
        asciiEntry(TAGS.GpsLatitudeRef, "N"),
        {
          tag: TAGS.GpsLatitude,
          type: 5,
          count: 3,
          value: concat([rational(10, 1), rational(20, 1), rational(30, 1)]),
        },
      ],
    },
  ];

  const withoutStrip = buildTiff(entries);
  const stripOffset = withoutStrip.length;
  const file = concat([withoutStrip, pixelData]);

  // Patch StripOffsets: entry index 5 in IFD0, which starts at byte 8.
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  view.setUint32(8 + 2 + 5 * 12 + 8, stripOffset);
  return file;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  return concat([new Uint8Array([0xff, marker]), u16be(payload.length + 2), payload]);
}

export interface JpegFixtureOptions {
  exif?: Uint8Array;
  xmp?: string;
  comment?: string;
  iccBytes?: number;
  adobeTransform?: number;
  components?: number;
  photoshop?: Uint8Array;
}

/**
 * A structurally valid baseline JPEG. The scan payload is arbitrary bytes with
 * correct 0xFF stuffing, which is all the container parser needs to see.
 */
export function buildJpeg(options: JpegFixtureOptions = {}): Uint8Array {
  const components = options.components ?? 3;
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];

  parts.push(
    jpegSegment(
      0xe0,
      concat([ascii("JFIF\0"), new Uint8Array([1, 2, 0]), u16be(72), u16be(72), new Uint8Array([0, 0])]),
    ),
  );

  if (options.exif) {
    parts.push(jpegSegment(0xe1, concat([ascii("Exif\0\0"), options.exif])));
  }

  if (options.xmp) {
    parts.push(
      jpegSegment(0xe1, concat([ascii("http://ns.adobe.com/xap/1.0/\0"), ascii(options.xmp)])),
    );
  }

  if (options.iccBytes) {
    parts.push(
      jpegSegment(
        0xe2,
        concat([ascii("ICC_PROFILE\0"), new Uint8Array([1, 1]), new Uint8Array(options.iccBytes)]),
      ),
    );
  }

  if (options.photoshop) {
    parts.push(jpegSegment(0xed, concat([ascii("Photoshop 3.0\0"), options.photoshop])));
  }

  if (options.adobeTransform !== undefined) {
    parts.push(
      jpegSegment(
        0xee,
        concat([
          ascii("Adobe"),
          u16be(100),
          u16be(0),
          u16be(0),
          new Uint8Array([options.adobeTransform]),
        ]),
      ),
    );
  }

  if (options.comment) {
    parts.push(jpegSegment(0xfe, ascii(options.comment)));
  }

  // Quantisation table.
  parts.push(jpegSegment(0xdb, concat([new Uint8Array([0]), new Uint8Array(64).fill(16)])));

  // Start of frame: precision, height, width, component count, per-component specs.
  const frame: Uint8Array[] = [new Uint8Array([8]), u16be(64), u16be(48), new Uint8Array([components])];
  for (let index = 0; index < components; index += 1) {
    frame.push(new Uint8Array([index + 1, 0x11, 0]));
  }
  parts.push(jpegSegment(0xc0, concat(frame)));

  // Huffman table.
  parts.push(
    jpegSegment(0xc4, concat([new Uint8Array([0]), new Uint8Array(16).fill(0), new Uint8Array(0)])),
  );

  // Scan header, then entropy-coded data with a stuffed 0xFF00 pair.
  const scanHeader: Uint8Array[] = [new Uint8Array([components])];
  for (let index = 0; index < components; index += 1) {
    scanHeader.push(new Uint8Array([index + 1, 0]));
  }
  scanHeader.push(new Uint8Array([0, 63, 0]));
  parts.push(jpegSegment(0xda, concat(scanHeader)));
  parts.push(new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56, 0x78, 0x9a]));
  parts.push(new Uint8Array([0xff, 0xd9]));

  return concat(parts);
}

/** The bytes between the scan header and EOI, used for integrity assertions. */
export const JPEG_SCAN_BYTES = new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56, 0x78, 0x9a]);

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

export const PNG_SIGNATURE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  return concat([u32be(data.length), typeBytes, data, u32be(crc32(typeBytes, data))]);
}

export interface PngFixtureOptions {
  text?: { keyword: string; value: string }[];
  compressedText?: { keyword: string; value: string }[];
  internationalText?: { keyword: string; value: string }[];
  exif?: Uint8Array;
  c2pa?: Uint8Array;
  icc?: Uint8Array;
}

export function buildPng(options: PngFixtureOptions = {}): Uint8Array {
  const header = concat([
    u32be(4),
    u32be(4),
    new Uint8Array([8, 6, 0, 0, 0]),
  ]);

  const parts: Uint8Array[] = [PNG_SIGNATURE_BYTES, pngChunk("IHDR", header)];

  for (const entry of options.text ?? []) {
    parts.push(pngChunk("tEXt", concat([ascii(entry.keyword), new Uint8Array([0]), ascii(entry.value)])));
  }

  for (const entry of options.compressedText ?? []) {
    parts.push(
      pngChunk(
        "zTXt",
        concat([
          ascii(entry.keyword),
          new Uint8Array([0, 0]),
          zlibSync(new TextEncoder().encode(entry.value)),
        ]),
      ),
    );
  }

  for (const entry of options.internationalText ?? []) {
    parts.push(
      pngChunk(
        "iTXt",
        concat([
          ascii(entry.keyword),
          new Uint8Array([0, 0, 0]),
          new Uint8Array([0]),
          new Uint8Array([0]),
          new TextEncoder().encode(entry.value),
        ]),
      ),
    );
  }

  if (options.exif) parts.push(pngChunk("eXIf", options.exif));
  if (options.c2pa) parts.push(pngChunk("caBX", options.c2pa));
  if (options.icc) {
    parts.push(
      pngChunk("iCCP", concat([ascii("Profile"), new Uint8Array([0, 0]), zlibSync(options.icc)])),
    );
  }

  const pixels = new Uint8Array(4 * (4 * 4 + 1));
  parts.push(pngChunk("IDAT", deflateSyncZlib(pixels)));
  parts.push(pngChunk("IEND", new Uint8Array(0)));

  return concat(parts);
}

function deflateSyncZlib(data: Uint8Array): Uint8Array {
  return zlibSync(data);
}

/** Raw deflate helper kept available for tests that need a non-zlib stream. */
export function rawDeflate(data: Uint8Array): Uint8Array {
  return deflateSync(data);
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

export function riffChunk(fourCc: string, payload: Uint8Array): Uint8Array {
  const parts = [ascii(fourCc), u32le(payload.length), payload];
  if (payload.length % 2 === 1) parts.push(new Uint8Array([0]));
  return concat(parts);
}

export interface WebpFixtureOptions {
  exif?: Uint8Array;
  xmp?: string;
  icc?: Uint8Array;
  c2pa?: Uint8Array;
}

export function buildWebp(options: WebpFixtureOptions = {}): Uint8Array {
  let flags = 0;
  if (options.icc) flags |= 0x20;
  if (options.exif) flags |= 0x08;
  if (options.xmp) flags |= 0x04;

  const vp8x = new Uint8Array(10);
  vp8x[0] = flags;
  // Canvas size is stored as width-1 / height-1 in 24-bit little-endian.
  vp8x[4] = 63;
  vp8x[7] = 47;

  const chunks: Uint8Array[] = [riffChunk("VP8X", vp8x)];
  if (options.icc) chunks.push(riffChunk("ICCP", options.icc));

  const imageData = new Uint8Array([0x2f, 0x3f, 0x00, 0x2f, 0x00, 0x11, 0x22, 0x33]);
  chunks.push(riffChunk("VP8L", imageData));

  if (options.exif) chunks.push(riffChunk("EXIF", options.exif));
  if (options.xmp) chunks.push(riffChunk("XMP ", ascii(options.xmp)));
  if (options.c2pa) chunks.push(riffChunk("C2PA", options.c2pa));

  const body = concat([ascii("WEBP"), ...chunks]);
  return concat([ascii("RIFF"), u32le(body.length), body]);
}

export const WEBP_IMAGE_DATA = new Uint8Array([
  0x2f, 0x3f, 0x00, 0x2f, 0x00, 0x11, 0x22, 0x33,
]);

// ---------------------------------------------------------------------------
// Shared payloads
// ---------------------------------------------------------------------------

export const SAMPLE_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><dc:creator><rdf:Seq><rdf:li>Jess</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>Adobe Firefly</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

/** A minimal JUMBF superbox containing one description box labelled `c2pa`. */
export function buildJumbf(label = "c2pa"): Uint8Array {
  const descriptionPayload = concat([
    new Uint8Array(16).fill(0x11),
    new Uint8Array([0x03]),
    ascii(label),
    new Uint8Array([0]),
  ]);
  const description = concat([
    u32be(descriptionPayload.length + 8),
    ascii("jumd"),
    descriptionPayload,
  ]);
  return concat([u32be(description.length + 8), ascii("jumb"), description]);
}

export function buildIccProfile(size = 160): Uint8Array {
  const profile = new Uint8Array(Math.max(132, size));
  const view = new DataView(profile.buffer);
  view.setUint32(0, profile.length);
  profile.set(ascii("ADBE"), 4);
  view.setUint8(8, 2);
  view.setUint8(9, 0x40);
  profile.set(ascii("mntr"), 12);
  profile.set(ascii("RGB "), 16);
  profile.set(ascii("acsp"), 36);
  view.setUint32(128, 0);
  return profile;
}

export const A1111_PARAMETERS = [
  "a photograph of a snow leopard on a rock, cinematic lighting",
  "Negative prompt: blurry, lowres, watermark",
  "Steps: 32, Sampler: DPM++ 2M Karras, CFG scale: 7.5, Seed: 284819251, Size: 768x1152, Model hash: 6ce0161689, Model: v1-5-pruned-emaonly, Clip skip: 2, Lora hashes: \"detail_slider: 1a2b3c\", Version: v1.9.4",
].join("\n");

export const COMFY_PROMPT = JSON.stringify({
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: 918273645,
      steps: 25,
      cfg: 8,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      model: ["4", 0],
      positive: ["6", 0],
      negative: ["7", 0],
    },
  },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "a red fox in the snow", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "text, watermark", clip: ["4", 1] } },
  "10": { class_type: "LoraLoader", inputs: { lora_name: "add_detail.safetensors" } },
});

export const NOVELAI_COMMENT = JSON.stringify({
  prompt: "1girl, forest, masterpiece",
  steps: 28,
  sampler: "k_euler_ancestral",
  seed: 3141592653,
  scale: 11,
  uc: "lowres, bad anatomy",
  noise_schedule: "native",
  width: 832,
  height: 1216,
});

import { ascii, concat, u16be, u32be } from "./fixtures";

/**
 * Builds a structurally valid AVIF still image with an EXIF item, a C2PA
 * `uuid` box and one coded image item. Offsets inside `iloc` are absolute, so
 * they are back-patched once the final layout is known — exactly the problem
 * the cleaner has to solve in reverse.
 */

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat([u32be(payload.length + 8), ascii(type), payload]);
}

function fullBox(
  type: string,
  version: number,
  flags: number,
  payload: Uint8Array,
): Uint8Array {
  const header = new Uint8Array([
    version,
    (flags >> 16) & 0xff,
    (flags >> 8) & 0xff,
    flags & 0xff,
  ]);
  return box(type, concat([header, payload]));
}

function cstring(text: string): Uint8Array {
  return concat([ascii(text), new Uint8Array([0])]);
}

const C2PA_UUID = new Uint8Array([
  0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87,
  0x7e, 0xc4, 0x81,
]);

export interface AvifFixture {
  bytes: Uint8Array;
  imageData: Uint8Array;
  exifPayload: Uint8Array;
}

export interface AvifFixtureOptions {
  exifPayload: Uint8Array;
  xmp?: string;
  /** Adds a top-level C2PA uuid box. */
  c2pa?: Uint8Array;
  width?: number;
  height?: number;
}

export function buildAvif(options: AvifFixtureOptions): AvifFixture {
  const width = options.width ?? 96;
  const height = options.height ?? 64;
  const imageData = new Uint8Array(64);
  for (let index = 0; index < imageData.length; index += 1) {
    imageData[index] = (index * 7 + 3) & 0xff;
  }

  // An Exif item begins with a 4-byte offset to the TIFF header.
  const exifItem = concat([u32be(0), options.exifPayload]);
  const xmpItem = options.xmp ? ascii(options.xmp) : null;

  const items: { id: number; data: Uint8Array }[] = [
    { id: 1, data: imageData },
    { id: 2, data: exifItem },
  ];
  if (xmpItem) items.push({ id: 3, data: xmpItem });

  const ftyp = box(
    "ftyp",
    concat([ascii("avif"), u32be(0), ascii("avif"), ascii("mif1"), ascii("miaf")]),
  );

  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    concat([u32be(0), ascii("pict"), new Uint8Array(12), cstring("")]),
  );

  const pitm = fullBox("pitm", 0, 0, u16be(1));

  const infeBoxes = [
    fullBox("infe", 2, 0, concat([u16be(1), u16be(0), ascii("av01"), cstring("Color")])),
    fullBox("infe", 2, 0, concat([u16be(2), u16be(0), ascii("Exif"), cstring("Exif")])),
  ];
  if (xmpItem) {
    infeBoxes.push(
      fullBox(
        "infe",
        2,
        0,
        concat([
          u16be(3),
          u16be(0),
          ascii("mime"),
          cstring("XMP"),
          cstring("application/rdf+xml"),
        ]),
      ),
    );
  }
  const iinf = fullBox("iinf", 0, 0, concat([u16be(infeBoxes.length), ...infeBoxes]));

  // iloc with placeholder offsets; their positions are recorded for patching.
  const ilocPayloadParts: Uint8Array[] = [
    new Uint8Array([0x44]), // offset_size = 4, length_size = 4
    new Uint8Array([0x00]), // base_offset_size = 0, index_size = 0
    u16be(items.length),
  ];
  const offsetFieldPositions: number[] = [];
  let ilocPayloadLength = 4;

  for (const item of items) {
    ilocPayloadParts.push(u16be(item.id), u16be(0), u16be(0), u16be(1));
    ilocPayloadLength += 8;
    // Position within the iloc box: 8 header bytes + 4 version/flags bytes.
    offsetFieldPositions.push(12 + ilocPayloadLength);
    ilocPayloadParts.push(u32be(0), u32be(item.data.length));
    ilocPayloadLength += 8;
  }
  const iloc = fullBox("iloc", 1, 0, concat(ilocPayloadParts));

  const irefChildren = [box("cdsc", concat([u16be(2), u16be(1), u16be(1)]))];
  if (xmpItem) irefChildren.push(box("cdsc", concat([u16be(3), u16be(1), u16be(1)])));
  const iref = fullBox("iref", 0, 0, concat(irefChildren));

  const ispe = fullBox("ispe", 0, 0, concat([u32be(width), u32be(height)]));
  const pixi = fullBox("pixi", 0, 0, new Uint8Array([3, 8, 8, 8]));
  const ipco = box("ipco", concat([ispe, pixi]));
  const ipma = fullBox(
    "ipma",
    0,
    0,
    concat([u32be(1), u16be(1), new Uint8Array([2, 0x81, 0x82])]),
  );
  const iprp = box("iprp", concat([ipco, ipma]));

  const metaChildren = concat([hdlr, pitm, iinf, iloc, iref, iprp]);
  const meta = fullBox("meta", 0, 0, metaChildren);

  const uuidBox = options.c2pa
    ? concat([u32be(options.c2pa.length + 24), ascii("uuid"), C2PA_UUID, options.c2pa])
    : null;

  const beforeMdat = uuidBox ? concat([ftyp, meta, uuidBox]) : concat([ftyp, meta]);
  const mdatPayload = concat(items.map((item) => item.data));
  const file = concat([beforeMdat, box("mdat", mdatPayload)]);

  // Patch the extent offsets now that the absolute layout is known.
  const metaStart = ftyp.length;
  const ilocStartInMeta = 12 + hdlr.length + pitm.length + iinf.length;
  const ilocStart = metaStart + ilocStartInMeta;
  const mdatPayloadStart = beforeMdat.length + 8;

  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let cursor = mdatPayloadStart;
  items.forEach((item, index) => {
    view.setUint32(ilocStart + offsetFieldPositions[index], cursor);
    cursor += item.data.length;
  });

  return { bytes: file, imageData, exifPayload: options.exifPayload };
}

export const MARKER = {
  SOI: 0xd8,
  EOI: 0xd9,
  SOS: 0xda,
  DQT: 0xdb,
  DNL: 0xdc,
  DRI: 0xdd,
  DHP: 0xde,
  EXP: 0xdf,
  DHT: 0xc4,
  JPG: 0xc8,
  DAC: 0xcc,
  COM: 0xfe,
  TEM: 0x01,
  APP0: 0xe0,
  APP1: 0xe1,
  APP2: 0xe2,
  APP11: 0xeb,
  APP13: 0xed,
  APP14: 0xee,
  APP15: 0xef,
} as const;

/** Markers that carry no length field and therefore no payload. */
export function isStandaloneMarker(marker: number): boolean {
  return (
    marker === MARKER.SOI ||
    marker === MARKER.EOI ||
    marker === MARKER.TEM ||
    (marker >= 0xd0 && marker <= 0xd7) // RST0-RST7
  );
}

export function isAppMarker(marker: number): boolean {
  return marker >= MARKER.APP0 && marker <= MARKER.APP15;
}

/** Start-of-frame markers, excluding DHT (C4), JPG (C8) and DAC (CC). */
export function isFrameMarker(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== MARKER.DHT && marker !== MARKER.JPG && marker !== MARKER.DAC;
}

const PROGRESSIVE_FRAMES = new Set([0xc2, 0xc6, 0xca, 0xce]);
const LOSSLESS_FRAMES = new Set([0xc3, 0xc7, 0xcb, 0xcf]);
const ARITHMETIC_FRAMES = new Set([0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function isProgressiveFrame(marker: number): boolean {
  return PROGRESSIVE_FRAMES.has(marker);
}

export function isLosslessFrame(marker: number): boolean {
  return LOSSLESS_FRAMES.has(marker);
}

export function isArithmeticFrame(marker: number): boolean {
  return ARITHMETIC_FRAMES.has(marker);
}

const FRAME_NAMES: Readonly<Record<number, string>> = {
  0xc0: "Baseline DCT",
  0xc1: "Extended sequential DCT",
  0xc2: "Progressive DCT",
  0xc3: "Lossless (sequential)",
  0xc5: "Differential sequential DCT",
  0xc6: "Differential progressive DCT",
  0xc7: "Differential lossless",
  0xc9: "Extended sequential DCT, arithmetic",
  0xca: "Progressive DCT, arithmetic",
  0xcb: "Lossless, arithmetic",
  0xcd: "Differential sequential DCT, arithmetic",
  0xce: "Differential progressive DCT, arithmetic",
  0xcf: "Differential lossless, arithmetic",
};

export function frameName(marker: number): string {
  return FRAME_NAMES[marker] ?? `SOF${(marker - 0xc0).toString(10)}`;
}

export function markerName(marker: number): string {
  if (isAppMarker(marker)) return `APP${marker - MARKER.APP0}`;
  if (isFrameMarker(marker)) return `SOF${marker - 0xc0}`;
  switch (marker) {
    case MARKER.SOI:
      return "SOI";
    case MARKER.EOI:
      return "EOI";
    case MARKER.SOS:
      return "SOS";
    case MARKER.DQT:
      return "DQT";
    case MARKER.DHT:
      return "DHT";
    case MARKER.DRI:
      return "DRI";
    case MARKER.DNL:
      return "DNL";
    case MARKER.DHP:
      return "DHP";
    case MARKER.EXP:
      return "EXP";
    case MARKER.DAC:
      return "DAC";
    case MARKER.COM:
      return "COM";
    default:
      return `0xFF${marker.toString(16).toUpperCase().padStart(2, "0")}`;
  }
}

/** APPn payload identifiers, all NUL-terminated in the file. */
export const IDENTIFIER = {
  JFIF: "JFIF\0",
  JFXX: "JFXX\0",
  EXIF: "Exif\0\0",
  XMP: "http://ns.adobe.com/xap/1.0/\0",
  XMP_EXTENSION: "http://ns.adobe.com/xmp/extension/\0",
  ICC: "ICC_PROFILE\0",
  MPF: "MPF\0",
  FPXR: "FPXR\0",
  PHOTOSHOP: "Photoshop 3.0\0",
  ADOBE: "Adobe",
  DUCKY: "Ducky",
  JUMBF: "JP",
  META: "Meta\0\0",
} as const;

import { indexOfAscii } from "../utils/bytes";
import { decodeUtf8 } from "../utils/text";

export interface XmpPacket {
  text: string;
  /** Offsets within the buffer the packet was found in. */
  start: number;
  end: number;
}

const PACKET_BEGIN = "<?xpacket begin";
const PACKET_END = "<?xpacket end";
const RDF_OPEN = "<x:xmpmeta";
const RDF_CLOSE = "</x:xmpmeta>";

/**
 * Locates the XMP packet inside a buffer. Writers disagree about whether the
 * `<?xpacket?>` processing instructions are present, so both the wrapped and
 * the bare `x:xmpmeta` forms are accepted, and a payload that is already just
 * the packet is returned as-is.
 */
export function extractXmpPacket(bytes: Uint8Array): XmpPacket | null {
  if (bytes.length === 0) return null;

  const begin = indexOfAscii(bytes, PACKET_BEGIN);
  if (begin >= 0) {
    const endMarker = indexOfAscii(bytes, PACKET_END, begin);
    if (endMarker >= 0) {
      // Include the closing "?>" of the trailing processing instruction.
      const closing = indexOfAscii(bytes, "?>", endMarker);
      const end = closing >= 0 ? closing + 2 : bytes.length;
      return { text: decodeUtf8(bytes.subarray(begin, end)), start: begin, end };
    }
  }

  const rdfStart = indexOfAscii(bytes, RDF_OPEN);
  if (rdfStart >= 0) {
    const rdfEnd = indexOfAscii(bytes, RDF_CLOSE, rdfStart);
    const end = rdfEnd >= 0 ? rdfEnd + RDF_CLOSE.length : bytes.length;
    return {
      text: decodeUtf8(bytes.subarray(rdfStart, end)),
      start: rdfStart,
      end,
    };
  }

  const rdfOnly = indexOfAscii(bytes, "<rdf:RDF");
  if (rdfOnly >= 0) {
    return { text: decodeUtf8(bytes), start: 0, end: bytes.length };
  }

  return null;
}

export function isXmpPayload(bytes: Uint8Array): boolean {
  return extractXmpPacket(bytes) !== null;
}

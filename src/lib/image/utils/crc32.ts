/**
 * CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320) as required by the PNG
 * specification for every chunk. The table is built once on first use.
 */
let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  const built = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    built[index] = value >>> 0;
  }
  table = built;
  return built;
}

/** Running CRC so a chunk's type and data can be fed in separately. */
export function crc32Update(seed: number, bytes: Uint8Array): number {
  const lookup = crcTable();
  let crc = seed;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = lookup[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

export function crc32(...parts: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    crc = crc32Update(crc, part);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

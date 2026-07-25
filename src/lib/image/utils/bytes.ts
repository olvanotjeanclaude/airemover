/**
 * Cursor-based reader over a `Uint8Array`. Every accessor is bounds-checked and
 * throws `ByteRangeError`, which callers turn into a friendly "corrupt file"
 * message rather than letting a `RangeError` escape from a worker.
 */
export class ByteRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ByteRangeError";
  }
}

export class ByteReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private cursor = 0;

  constructor(bytes: Uint8Array, startOffset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.cursor = startOffset;
  }

  get offset(): number {
    return this.cursor;
  }

  set offset(next: number) {
    if (next < 0 || next > this.bytes.length) {
      throw new ByteRangeError(
        `Offset ${next} is outside the 0..${this.bytes.length} range`,
      );
    }
    this.cursor = next;
  }

  get length(): number {
    return this.bytes.length;
  }

  get remaining(): number {
    return this.bytes.length - this.cursor;
  }

  get atEnd(): boolean {
    return this.cursor >= this.bytes.length;
  }

  has(count: number): boolean {
    return this.cursor + count <= this.bytes.length;
  }

  private require(count: number, what: string): void {
    if (this.cursor + count > this.bytes.length) {
      throw new ByteRangeError(
        `Truncated ${what}: needed ${count} byte(s) at ${this.cursor}, only ${this.remaining} left`,
      );
    }
  }

  skip(count: number): void {
    this.require(count, "skip");
    this.cursor += count;
  }

  u8(): number {
    this.require(1, "uint8");
    return this.bytes[this.cursor++];
  }

  peekU8(ahead = 0): number {
    this.require(ahead + 1, "peek");
    return this.bytes[this.cursor + ahead];
  }

  u16(littleEndian = false): number {
    this.require(2, "uint16");
    const value = this.view.getUint16(this.cursor, littleEndian);
    this.cursor += 2;
    return value;
  }

  u32(littleEndian = false): number {
    this.require(4, "uint32");
    const value = this.view.getUint32(this.cursor, littleEndian);
    this.cursor += 4;
    return value;
  }

  i32(littleEndian = false): number {
    this.require(4, "int32");
    const value = this.view.getInt32(this.cursor, littleEndian);
    this.cursor += 4;
    return value;
  }

  /** 24-bit little-endian, used by the WebP VP8X canvas fields. */
  u24(littleEndian = true): number {
    this.require(3, "uint24");
    const a = this.bytes[this.cursor];
    const b = this.bytes[this.cursor + 1];
    const c = this.bytes[this.cursor + 2];
    this.cursor += 3;
    return littleEndian ? a | (b << 8) | (c << 16) : (a << 16) | (b << 8) | c;
  }

  /**
   * 64-bit big-endian. ISOBMFF large boxes use it; anything past 2^53 cannot be
   * a real in-browser image, so we reject instead of silently losing precision.
   */
  u64(): number {
    this.require(8, "uint64");
    const hi = this.view.getUint32(this.cursor, false);
    const lo = this.view.getUint32(this.cursor + 4, false);
    this.cursor += 8;
    if (hi > 0x1fffff) {
      throw new ByteRangeError("64-bit size exceeds the safe integer range");
    }
    return hi * 0x100000000 + lo;
  }

  /** Zero-copy view of the next `count` bytes. */
  take(count: number): Uint8Array {
    this.require(count, "slice");
    const slice = this.bytes.subarray(this.cursor, this.cursor + count);
    this.cursor += count;
    return slice;
  }

  peek(count: number): Uint8Array {
    this.require(count, "peek slice");
    return this.bytes.subarray(this.cursor, this.cursor + count);
  }

  /** Reads `count` bytes as ASCII, used for four-character container tags. */
  ascii(count: number): string {
    return asciiOf(this.take(count));
  }

  peekAscii(count: number): string {
    return asciiOf(this.peek(count));
  }

  /** True when the upcoming bytes equal `text` (ASCII, no cursor movement). */
  lookingAt(text: string): boolean {
    if (!this.has(text.length)) return false;
    for (let index = 0; index < text.length; index += 1) {
      if (this.bytes[this.cursor + index] !== text.charCodeAt(index)) return false;
    }
    return true;
  }
}

export function asciiOf(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }
  return out;
}

export function bytesOfAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    out[index] = text.charCodeAt(index) & 0xff;
  }
  return out;
}

/** Case-sensitive prefix test against a byte array. */
export function startsWithAscii(
  bytes: Uint8Array,
  text: string,
  at = 0,
): boolean {
  if (at + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/** Byte-for-byte equality, used by the lossless-integrity checks. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/** First index of `needle` in `haystack` at or after `from`, or -1. */
export function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from = 0,
): number {
  if (needle.length === 0) return from;
  const last = haystack.length - needle.length;
  const first = needle[0];
  for (let index = Math.max(0, from); index <= last; index += 1) {
    if (haystack[index] !== first) continue;
    let matched = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

export function indexOfAscii(
  haystack: Uint8Array,
  needle: string,
  from = 0,
): number {
  return indexOfBytes(haystack, bytesOfAscii(needle), from);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/**
 * Append-only buffer that doubles its capacity. Used by the container writers,
 * where the final size is only known once every kept segment has been emitted.
 */
export class ByteWriter {
  private buffer: Uint8Array;
  private size = 0;

  constructor(initialCapacity = 4096) {
    this.buffer = new Uint8Array(Math.max(16, initialCapacity));
  }

  get length(): number {
    return this.size;
  }

  private ensure(extra: number): void {
    const needed = this.size + extra;
    if (needed <= this.buffer.length) return;
    let capacity = this.buffer.length;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.buffer.subarray(0, this.size), 0);
    this.buffer = grown;
  }

  u8(value: number): this {
    this.ensure(1);
    this.buffer[this.size++] = value & 0xff;
    return this;
  }

  u16(value: number, littleEndian = false): this {
    this.ensure(2);
    if (littleEndian) {
      this.buffer[this.size] = value & 0xff;
      this.buffer[this.size + 1] = (value >>> 8) & 0xff;
    } else {
      this.buffer[this.size] = (value >>> 8) & 0xff;
      this.buffer[this.size + 1] = value & 0xff;
    }
    this.size += 2;
    return this;
  }

  u24(value: number, littleEndian = true): this {
    this.ensure(3);
    if (littleEndian) {
      this.buffer[this.size] = value & 0xff;
      this.buffer[this.size + 1] = (value >>> 8) & 0xff;
      this.buffer[this.size + 2] = (value >>> 16) & 0xff;
    } else {
      this.buffer[this.size] = (value >>> 16) & 0xff;
      this.buffer[this.size + 1] = (value >>> 8) & 0xff;
      this.buffer[this.size + 2] = value & 0xff;
    }
    this.size += 3;
    return this;
  }

  u32(value: number, littleEndian = false): this {
    this.ensure(4);
    const unsigned = value >>> 0;
    if (littleEndian) {
      this.buffer[this.size] = unsigned & 0xff;
      this.buffer[this.size + 1] = (unsigned >>> 8) & 0xff;
      this.buffer[this.size + 2] = (unsigned >>> 16) & 0xff;
      this.buffer[this.size + 3] = (unsigned >>> 24) & 0xff;
    } else {
      this.buffer[this.size] = (unsigned >>> 24) & 0xff;
      this.buffer[this.size + 1] = (unsigned >>> 16) & 0xff;
      this.buffer[this.size + 2] = (unsigned >>> 8) & 0xff;
      this.buffer[this.size + 3] = unsigned & 0xff;
    }
    this.size += 4;
    return this;
  }

  u64(value: number): this {
    const hi = Math.floor(value / 0x100000000);
    const lo = value >>> 0;
    return this.u32(hi).u32(lo);
  }

  raw(source: Uint8Array): this {
    this.ensure(source.length);
    this.buffer.set(source, this.size);
    this.size += source.length;
    return this;
  }

  ascii(text: string): this {
    this.ensure(text.length);
    for (let index = 0; index < text.length; index += 1) {
      this.buffer[this.size + index] = text.charCodeAt(index) & 0xff;
    }
    this.size += text.length;
    return this;
  }

  /** Pads to an even length, as required by RIFF chunk alignment. */
  padToEven(): this {
    if (this.size % 2 === 1) this.u8(0);
    return this;
  }

  /** Overwrites a previously written big-endian uint32 (offset back-patching). */
  patchU32(at: number, value: number, littleEndian = false): void {
    if (at + 4 > this.size) {
      throw new ByteRangeError(`Cannot patch uint32 at ${at}: past end of buffer`);
    }
    const unsigned = value >>> 0;
    if (littleEndian) {
      this.buffer[at] = unsigned & 0xff;
      this.buffer[at + 1] = (unsigned >>> 8) & 0xff;
      this.buffer[at + 2] = (unsigned >>> 16) & 0xff;
      this.buffer[at + 3] = (unsigned >>> 24) & 0xff;
    } else {
      this.buffer[at] = (unsigned >>> 24) & 0xff;
      this.buffer[at + 1] = (unsigned >>> 16) & 0xff;
      this.buffer[at + 2] = (unsigned >>> 8) & 0xff;
      this.buffer[at + 3] = unsigned & 0xff;
    }
  }

  /** Overwrites raw bytes in place, used for TIFF inline value fields. */
  patchRaw(at: number, source: Uint8Array): void {
    if (at + source.length > this.size) {
      throw new ByteRangeError(`Cannot patch ${source.length} byte(s) at ${at}`);
    }
    this.buffer.set(source, at);
  }

  patchU64(at: number, value: number): void {
    this.patchU32(at, Math.floor(value / 0x100000000));
    this.patchU32(at + 4, value >>> 0);
  }

  /** Exact-length copy of everything written so far. */
  finish(): Uint8Array {
    return this.buffer.slice(0, this.size);
  }
}

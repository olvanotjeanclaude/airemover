import { zlibSync } from "fflate";
import { ByteWriter, bytesOfAscii } from "../utils/bytes";
import { crc32 } from "../utils/crc32";
import { PNG_SIGNATURE } from "../png/chunks";

export interface PngEncodeOptions {
  /** 0-9, passed straight to the deflate stage. */
  level: number;
  /** Drops the alpha channel, producing a colour type 2 image. */
  stripAlpha: boolean;
}

/**
 * Encodes RGBA pixels as PNG.
 *
 * The browser's own `convertToBlob` cannot be told how hard to compress, so the
 * rebuild mode's compression control would be decorative if it delegated. This
 * encoder applies the standard adaptive per-scanline filtering and hands the
 * result to deflate at the requested level, which makes the control real.
 */
export function encodePng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: PngEncodeOptions,
): Uint8Array {
  const channels = options.stripAlpha ? 3 : 4;
  const colorType = options.stripAlpha ? 2 : 6;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);

  const current = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  const candidate = new Uint8Array(stride);

  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    if (channels === 4) {
      current.set(pixels.subarray(rowStart, rowStart + stride));
    } else {
      for (let x = 0; x < width; x += 1) {
        const source = rowStart + x * 4;
        const target = x * 3;
        current[target] = pixels[source];
        current[target + 1] = pixels[source + 1];
        current[target + 2] = pixels[source + 2];
      }
    }

    const chosen = chooseFilter(current, previous, candidate, channels, stride);
    raw[rawOffset] = chosen.filter;
    raw.set(chosen.data.subarray(0, stride), rawOffset + 1);
    rawOffset += stride + 1;
    previous.set(current);
  }

  const compressed = zlibSync(raw, {
    level: Math.min(9, Math.max(0, Math.round(options.level))) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  });

  const output = new ByteWriter(compressed.length + 64);
  output.raw(PNG_SIGNATURE);

  const header = new ByteWriter(13);
  header.u32(width);
  header.u32(height);
  header.u8(8); // bit depth
  header.u8(colorType);
  header.u8(0); // deflate
  header.u8(0); // adaptive filtering
  header.u8(0); // no interlace
  writeChunk(output, "IHDR", header.finish());
  writeChunk(output, "IDAT", compressed);
  writeChunk(output, "IEND", new Uint8Array(0));

  return output.finish();
}

function writeChunk(output: ByteWriter, type: string, data: Uint8Array): void {
  const typeBytes = bytesOfAscii(type);
  output.u32(data.length);
  output.raw(typeBytes);
  output.raw(data);
  output.u32(crc32(typeBytes, data));
}

interface FilterChoice {
  filter: number;
  data: Uint8Array;
}

/**
 * Picks the filter whose output has the smallest sum of absolute differences,
 * the heuristic recommended by the PNG specification.
 */
function chooseFilter(
  current: Uint8Array,
  previous: Uint8Array,
  scratch: Uint8Array,
  channels: number,
  stride: number,
): FilterChoice {
  let bestFilter = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestData = current;

  for (let filter = 0; filter <= 4; filter += 1) {
    const data = filter === 0 ? current : scratch;
    if (filter !== 0) applyFilter(filter, current, previous, scratch, channels, stride);

    let score = 0;
    for (let index = 0; index < stride; index += 1) {
      const value = data[index];
      score += value < 128 ? value : 256 - value;
      if (score >= bestScore) break;
    }

    if (score < bestScore) {
      bestScore = score;
      bestFilter = filter;
      bestData = filter === 0 ? current : scratch.slice(0, stride);
    }
  }

  return { filter: bestFilter, data: bestData };
}

function applyFilter(
  filter: number,
  current: Uint8Array,
  previous: Uint8Array,
  output: Uint8Array,
  channels: number,
  stride: number,
): void {
  for (let index = 0; index < stride; index += 1) {
    const left = index >= channels ? current[index - channels] : 0;
    const up = previous[index];
    const upLeft = index >= channels ? previous[index - channels] : 0;
    const value = current[index];

    switch (filter) {
      case 1:
        output[index] = (value - left) & 0xff;
        break;
      case 2:
        output[index] = (value - up) & 0xff;
        break;
      case 3:
        output[index] = (value - ((left + up) >> 1)) & 0xff;
        break;
      case 4:
        output[index] = (value - paeth(left, up, upLeft)) & 0xff;
        break;
      default:
        output[index] = value;
        break;
    }
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

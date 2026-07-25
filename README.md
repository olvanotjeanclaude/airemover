# Image Metadata Cleaner

A privacy-first image metadata cleaner that runs entirely in the browser. It removes EXIF, GPS,
XMP, IPTC, C2PA Content Credentials and AI generation data without ever uploading a file, and
without re-encoding the image.

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest run
```

## What makes it lossless

The default mode never touches pixels. Each container has a dedicated binary parser and writer:

| Format | Approach |
| --- | --- |
| JPEG | Marker walk. Segments are classified individually; the entropy-coded scan, DQT, DHT and restart markers are copied verbatim. Progressive and 12-bit frames are supported. |
| PNG | Chunk walk with CRC validation. Critical chunks are always kept, every written chunk gets a freshly computed CRC, and APNG animation chunks survive. |
| WebP | RIFF rebuild. VP8/VP8L payloads are copied byte for byte and the VP8X flag byte is corrected for the chunks that were dropped. |
| AVIF / HEIC | ISOBMFF box rewrite. Metadata items are removed from `iinf`, `iloc`, `iref` and `ipma`, `mdat` is compacted, and the absolute extent offsets are back-patched in a second pass. |
| TIFF | The IFD tree is rebuilt from scratch. Strips and tiles are relocated and their offset tags rewritten, so the compressed pixel data is preserved exactly. |

Rebuild mode is the opt-in fallback: it decodes, redraws and re-encodes, and says so in the
result. PNG output uses a bundled encoder with adaptive scanline filtering, so the compression
level control is real rather than decorative.

## Architecture

```
src/
  app/                      routes, metadata, SEO, PWA manifest
  components/
    ui/                     shadcn-style primitives on Radix
    cleaner/                dropzone, queue, inspector, settings
    landing/                marketing sections
    theme/                  next-themes wiring
  hooks/                    queue engine, downloads, paste, hydration
  workers/                  worker entry point plus a pure message handler
  lib/
    image/
      utils/                byte reader/writer, CRC-32, text decoding, format sniffing
      exif/                 TIFF/EXIF reader, writer and selective tag filter
      xmp/  iptc/  icc/     packet and record parsers
      c2pa/                 JUMBF box reader
      jpeg/ png/ webp/      per-format parse, inspect and clean
      isobmff/ tiff/        per-format parse, inspect and clean
      parser/               container dispatch plus the AI generator parsers
      inspector/            builds the format-agnostic report
      cleaner/              clean dispatch, rebuild mode, PNG encoder
    worker/                 worker pool with crash recovery
  store/                    Zustand stores for files and settings
  types/  constants/
```

The worker message handler is a pure function, which is why the worker contract is unit-tested
without spinning up a real `Worker`.

## Privacy guarantees

- No upload endpoint exists. Files are read with `FileReader`, processed in a worker, and handed
  back as a `Blob`.
- The Content Security Policy in `next.config.ts` sets `connect-src 'self'` and
  `form-action 'none'`, so outbound requests are blocked by the browser.
- No analytics, telemetry, cookies or third-party scripts. Only the user's switch preferences are
  stored, in `localStorage`.
- The app keeps working with the network disconnected.

## Tests

93 tests cover the binary layer: container parsing, lossless integrity (the compressed stream is
asserted byte-identical after cleaning), CRC-32 against the published check value, TIFF write
round-trips, AVIF offset repair, selective GPS removal, every AI generator parser, and the worker
message contract. Fixtures are hand-assembled from the format specifications rather than produced
by the writers under test.

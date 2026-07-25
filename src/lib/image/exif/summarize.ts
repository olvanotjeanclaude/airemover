import type { ExifSummary, GpsSummary } from "@/types/metadata";
import type { AiTextSource } from "../parser/ai/types";
import { decodeUserComment, decodeXpString, sanitizeForDisplay } from "../utils/text";
import { GPS_TAG, ORIENTATION_LABELS, TAG } from "./constants";
import {
  countEntries,
  findEntry,
  findSubIfd,
  readAscii,
  readNumbers,
  readRationals,
  type TiffEntry,
  type TiffIfd,
  type TiffTree,
} from "./tiff";

function ascii(ifd: TiffIfd | undefined, tag: number): string | undefined {
  if (!ifd) return undefined;
  const entry = findEntry(ifd, tag);
  if (!entry) return undefined;
  const value = readAscii(entry);
  return value || undefined;
}

function firstNumber(
  ifd: TiffIfd | undefined,
  tag: number,
  littleEndian: boolean,
): number | undefined {
  if (!ifd) return undefined;
  const entry = findEntry(ifd, tag);
  if (!entry) return undefined;
  const numbers = readNumbers(entry, littleEndian);
  return numbers.length > 0 ? numbers[0] : undefined;
}

/** Exposure times are conventionally shown as a reciprocal, e.g. "1/250 s". */
function formatExposure(entry: TiffEntry | undefined, littleEndian: boolean): string | undefined {
  if (!entry) return undefined;
  const pairs = readRationals(entry, littleEndian);
  if (pairs.length === 0) return undefined;
  const { numerator, denominator } = pairs[0];
  if (denominator === 0) return undefined;
  const seconds = numerator / denominator;
  if (seconds >= 1) return `${Number(seconds.toFixed(2))} s`;
  return `1/${Math.round(denominator / Math.max(numerator, 1))} s`;
}

function formatAperture(value: number | undefined): string | undefined {
  if (value === undefined || value <= 0) return undefined;
  return `f/${Number(value.toFixed(1))}`;
}

function formatFocalLength(value: number | undefined): string | undefined {
  if (value === undefined || value <= 0) return undefined;
  return `${Number(value.toFixed(1))} mm`;
}

export function summarizeExif(tree: TiffTree): ExifSummary {
  const { littleEndian } = tree;
  const ifd0 = tree.ifds[0];
  const exifIfd = findSubIfd(tree, "exif");
  const thumbnailIfd = tree.ifds[1];

  const makerNote = exifIfd ? findEntry(exifIfd, TAG.MakerNote) : undefined;
  const thumbnailLength = thumbnailIfd
    ? firstNumber(thumbnailIfd, TAG.JPEGInterchangeFormatLength, littleEndian)
    : undefined;

  const userCommentEntry = exifIfd ? findEntry(exifIfd, TAG.UserComment) : undefined;
  const userComment = userCommentEntry
    ? sanitizeForDisplay(decodeUserComment(userCommentEntry.value), 1200)
    : undefined;

  const description =
    ascii(ifd0, TAG.ImageDescription) ??
    (ifd0 && findEntry(ifd0, TAG.XPComment)
      ? decodeXpString(findEntry(ifd0, TAG.XPComment)!.value)
      : undefined);

  const lensModel = ascii(exifIfd, TAG.LensModel);
  const lensMake = ascii(exifIfd, TAG.LensMake);

  return {
    tagCount: countEntries(tree),
    byteOrder: littleEndian ? "little" : "big",
    cameraMake: ascii(ifd0, TAG.Make),
    cameraModel: ascii(ifd0, TAG.Model),
    lens: lensModel ? [lensMake, lensModel].filter(Boolean).join(" ") : lensMake,
    software: ascii(ifd0, TAG.Software),
    dateTaken: ascii(exifIfd, TAG.DateTimeOriginal) ?? ascii(ifd0, TAG.DateTime),
    dateDigitized: ascii(exifIfd, TAG.DateTimeDigitized),
    artist: ascii(ifd0, TAG.Artist),
    copyright: ascii(ifd0, TAG.Copyright),
    description: description ? sanitizeForDisplay(description, 600) : undefined,
    orientation: firstNumber(ifd0, TAG.Orientation, littleEndian),
    exposureTime: formatExposure(
      exifIfd ? findEntry(exifIfd, TAG.ExposureTime) : undefined,
      littleEndian,
    ),
    fNumber: formatAperture(firstNumber(exifIfd, TAG.FNumber, littleEndian)),
    iso: (() => {
      const value = firstNumber(exifIfd, TAG.ISOSpeedRatings, littleEndian);
      return value === undefined ? undefined : String(Math.round(value));
    })(),
    focalLength: formatFocalLength(firstNumber(exifIfd, TAG.FocalLength, littleEndian)),
    serialNumber: ascii(ifd0, TAG.CameraSerialNumber),
    bodySerialNumber: ascii(exifIfd, TAG.BodySerialNumber),
    lensSerialNumber: ascii(exifIfd, TAG.LensSerialNumber),
    ownerName: ascii(exifIfd, TAG.CameraOwnerName),
    userComment: userComment || undefined,
    hasMakerNote: Boolean(makerNote),
    makerNoteBytes: makerNote?.value.length ?? 0,
    hasThumbnail: Boolean(thumbnailLength && thumbnailLength > 0),
    thumbnailBytes: thumbnailLength ?? 0,
  };
}

export function orientationLabel(orientation?: number): string | undefined {
  if (orientation === undefined) return undefined;
  return ORIENTATION_LABELS[orientation] ?? `Orientation ${orientation}`;
}

/** Converts a degrees/minutes/seconds triple plus its hemisphere reference. */
function toDecimalDegrees(
  parts: readonly number[],
  reference: string | undefined,
): number | undefined {
  if (parts.length < 1) return undefined;
  const degrees = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;
  let value = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(value)) return undefined;
  const hemisphere = (reference ?? "").trim().toUpperCase();
  if (hemisphere === "S" || hemisphere === "W") value = -value;
  return Number(value.toFixed(6));
}

export function summarizeGps(tree: TiffTree): GpsSummary | undefined {
  const gpsIfd = findSubIfd(tree, "gps");
  if (!gpsIfd || gpsIfd.entries.length === 0) return undefined;
  const { littleEndian } = tree;

  const latitudeEntry = findEntry(gpsIfd, GPS_TAG.GPSLatitude);
  const longitudeEntry = findEntry(gpsIfd, GPS_TAG.GPSLongitude);
  const latitudeRef = ascii(gpsIfd, GPS_TAG.GPSLatitudeRef);
  const longitudeRef = ascii(gpsIfd, GPS_TAG.GPSLongitudeRef);

  const latitude = latitudeEntry
    ? toDecimalDegrees(readNumbers(latitudeEntry, littleEndian), latitudeRef)
    : undefined;
  const longitude = longitudeEntry
    ? toDecimalDegrees(readNumbers(longitudeEntry, littleEndian), longitudeRef)
    : undefined;

  let altitude = firstNumber(gpsIfd, GPS_TAG.GPSAltitude, littleEndian);
  const altitudeRef = firstNumber(gpsIfd, GPS_TAG.GPSAltitudeRef, littleEndian);
  if (altitude !== undefined) {
    if (altitudeRef === 1) altitude = -altitude;
    altitude = Number(altitude.toFixed(1));
  }

  const dateStamp = ascii(gpsIfd, GPS_TAG.GPSDateStamp);
  const timeEntry = findEntry(gpsIfd, GPS_TAG.GPSTimeStamp);
  let timestampUtc: string | undefined;
  if (timeEntry) {
    const parts = readNumbers(timeEntry, littleEndian);
    if (parts.length >= 3) {
      const pad = (value: number): string =>
        String(Math.floor(value)).padStart(2, "0");
      const clock = `${pad(parts[0])}:${pad(parts[1])}:${pad(parts[2])} UTC`;
      timestampUtc = dateStamp ? `${dateStamp} ${clock}` : clock;
    }
  } else if (dateStamp) {
    timestampUtc = dateStamp;
  }

  const direction = firstNumber(gpsIfd, GPS_TAG.GPSImgDirection, littleEndian);

  return {
    latitude,
    longitude,
    altitude,
    timestampUtc,
    imageDirection:
      direction === undefined ? undefined : `${Number(direction.toFixed(1))}°`,
    coordinates:
      latitude !== undefined && longitude !== undefined
        ? `${Math.abs(latitude).toFixed(6)} ${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(6)} ${longitude >= 0 ? "E" : "W"}`
        : undefined,
    tagCount: gpsIfd.entries.length,
  };
}

/** Text fields inside EXIF that generators are known to reuse. */
export function collectExifAiSources(
  tree: TiffTree,
  originPrefix: string,
): AiTextSource[] {
  const sources: AiTextSource[] = [];
  const ifd0 = tree.ifds[0];
  const exifIfd = findSubIfd(tree, "exif");

  const push = (key: string, text: string, bytes: number): void => {
    if (text.trim().length > 0) {
      sources.push({ origin: `${originPrefix}:${key}`, key, text, bytes });
    }
  };

  const userComment = exifIfd ? findEntry(exifIfd, TAG.UserComment) : undefined;
  if (userComment) {
    push("UserComment", decodeUserComment(userComment.value), userComment.value.length);
  }

  const imageDescription = ifd0 ? findEntry(ifd0, TAG.ImageDescription) : undefined;
  if (imageDescription) {
    push("ImageDescription", readAscii(imageDescription), imageDescription.value.length);
  }

  for (const tag of [TAG.XPComment, TAG.XPTitle, TAG.XPSubject] as const) {
    const entry = ifd0 ? findEntry(ifd0, tag) : undefined;
    if (entry) push(`XP:${tag.toString(16)}`, decodeXpString(entry.value), entry.value.length);
  }

  const software = ifd0 ? findEntry(ifd0, TAG.Software) : undefined;
  if (software) push("Software", readAscii(software), software.value.length);

  return sources;
}

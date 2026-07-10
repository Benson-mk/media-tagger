import exifr from "exifr"

import { logger } from "../common/logger"

export type ExifData = Readonly<Record<string, string | number>>

const SKIPPED_FIELDS = new Set(["ExifIFD", "ExifTag", "MakerNote", "UserComment", "thumbnail"])

function jsonSafe(value: unknown): string | number | undefined {
  if (typeof value === "string") return value
  if (typeof value === "boolean") return String(value)
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return value.join(", ")
  }
  return undefined
}

type ExifBlocks = {
  readonly ifd0?: Record<string, unknown>
  readonly exif?: Record<string, unknown>
  readonly gps?: Record<string, unknown>
  readonly aux?: Record<string, unknown>
}

export async function extractExif(path: string): Promise<ExifData | null> {
  let blocks: ExifBlocks | undefined
  try {
    blocks = (await exifr.parse(path, {
      exif: true,
      gps: true,
      xmp: true,
      ihdr: false,
      jfif: false,
      icc: false,
      iptc: false,
      mergeOutput: false,
    })) as ExifBlocks | undefined
  } catch (error) {
    logger.warn("exif extraction failed", { path, error: String(error) })
    return null
  }
  if (blocks === undefined || blocks === null) return null

  const exif: Record<string, string | number> = {}
  const merge = (block: Record<string, unknown> | undefined, overwrite: boolean): void => {
    for (const [field, raw] of Object.entries(block ?? {})) {
      if (SKIPPED_FIELDS.has(field)) continue
      if (!overwrite && field in exif) continue
      const value = jsonSafe(raw)
      if (value !== undefined) {
        exif[field] = value
      }
    }
  }
  merge(blocks.ifd0, true)
  merge(blocks.exif, true)
  merge(blocks.gps, true)
  merge(blocks.aux, false)
  return Object.keys(exif).length === 0 ? null : exif
}

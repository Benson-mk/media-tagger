import { imageSizeFromFile } from "image-size/fromFile"

import { logger } from "../common/logger"

export type ImageProbeResult =
  | {
      readonly available: true
      readonly width: number
      readonly height: number
      readonly orientation: number | null
      readonly aspect_ratio: string
    }
  | {
      readonly available: false
      readonly error: string
    }

export async function probeImage(path: string): Promise<ImageProbeResult> {
  try {
    const dimensions = await imageSizeFromFile(path)
    const { width, height } = dimensions

    if (width === undefined || height === undefined) {
      const error = "image probe failed: dimensions unavailable"
      logger.warn("image probe failed", { path, error })
      return { available: false, error }
    }

    return {
      available: true,
      width,
      height,
      orientation: dimensions.orientation ?? null,
      aspect_ratio: aspectRatio(width, height),
    }
  } catch (error) {
    if (error instanceof Error) {
      const message = `image probe failed: ${error.message}`
      logger.warn("image probe failed", { path, error: message })
      return { available: false, error: message }
    }
    throw error
  }
}

function aspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}

function greatestCommonDivisor(left: number, right: number): number {
  let current = left
  let next = right

  while (next !== 0) {
    const remainder = current % next
    current = next
    next = remainder
  }

  return current
}

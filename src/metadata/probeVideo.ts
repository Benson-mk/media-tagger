import { logger } from "../common/logger"
import { parseNumber, readFfprobe } from "./ffprobe"

export type VideoProbeResult =
  | {
      readonly available: true
      readonly duration: number | null
      readonly width: number | null
      readonly height: number | null
      readonly fps: number | null
      readonly codec: string | null
      readonly has_audio: boolean
    }
  | {
      readonly available: false
      readonly error: string
    }

export async function probeVideo(
  path: string,
  ffprobeCommand = "ffprobe",
): Promise<VideoProbeResult> {
  const data = await readFfprobe(path, ffprobeCommand)

  if (!data.available) {
    return data
  }

  const videoStream = data.value.streams.find((stream) => stream.codec_type === "video")
  if (videoStream === undefined) {
    const error = "ffprobe output invalid: missing video stream"
    logger.warn("ffprobe output invalid", { path, error })
    return { available: false, error }
  }

  return {
    available: true,
    duration: parseNumber(data.value.format.duration),
    width: videoStream.width ?? null,
    height: videoStream.height ?? null,
    fps: parseFrameRate(videoStream.r_frame_rate),
    codec: videoStream.codec_name ?? null,
    has_audio: data.value.streams.some((stream) => stream.codec_type === "audio"),
  }
}

function parseFrameRate(value: string | undefined): number | null {
  if (value === undefined || value === "0/0") {
    return null
  }

  const [numeratorText, denominatorText] = value.split("/")
  if (numeratorText === undefined || denominatorText === undefined) {
    return parseNumber(value)
  }

  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null
  }

  return Math.round((numerator / denominator) * 100) / 100
}

import { logger } from "../common/logger"
import { parseNumber, readFfprobe } from "./ffprobe"

export type AudioProbeResult =
  | {
      readonly available: true
      readonly duration: number | null
      readonly codec: string | null
      readonly sample_rate: number | null
      readonly channels: number | null
      readonly bitrate: number | null
    }
  | {
      readonly available: false
      readonly error: string
    }

export async function probeAudio(
  path: string,
  ffprobeCommand = "ffprobe",
): Promise<AudioProbeResult> {
  const data = await readFfprobe(path, ffprobeCommand)

  if (!data.available) {
    return data
  }

  const audioStream = data.value.streams.find((stream) => stream.codec_type === "audio")
  if (audioStream === undefined) {
    const error = "ffprobe output invalid: missing audio stream"
    logger.warn("ffprobe output invalid", { path, error })
    return { available: false, error }
  }

  return {
    available: true,
    duration: parseNumber(data.value.format.duration),
    codec: audioStream.codec_name ?? null,
    sample_rate: parseNumber(audioStream.sample_rate),
    channels: audioStream.channels ?? null,
    bitrate: parseNumber(data.value.format.bit_rate),
  }
}

import { z } from "zod"

import { logger } from "../common/logger"

export const FfprobeStreamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  r_frame_rate: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().optional(),
})

export const FfprobeSchema = z.object({
  streams: z.array(FfprobeStreamSchema).default([]),
  format: z
    .object({
      duration: z.string().optional(),
      bit_rate: z.string().optional(),
    })
    .default({}),
})

export type FfprobeData = z.infer<typeof FfprobeSchema>

export type FfprobeResult =
  | { readonly available: true; readonly value: FfprobeData }
  | { readonly available: false; readonly error: string }

export async function readFfprobe(path: string, command = "ffprobe"): Promise<FfprobeResult> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">

  try {
    proc = Bun.spawn(
      [command, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path],
      {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
  } catch (error) {
    if (error instanceof Error) {
      const message = `ffprobe unavailable: ${error.message}`
      logger.warn("ffprobe unavailable", { path, error: message })
      return { available: false, error: message }
    }
    throw error
  }

  const exitCode = await Promise.race([proc.exited, Bun.sleep(3_000).then(() => "timeout")])
  if (exitCode === "timeout") {
    proc.kill()
    await proc.exited
    const error = "ffprobe unavailable: timed out"
    logger.warn("ffprobe unavailable", { path, error })
    return { available: false, error }
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  if (exitCode !== 0) {
    const detail = stderr.trim() || `exit code ${exitCode}`
    const error = `ffprobe unavailable: ${detail}`
    logger.warn("ffprobe unavailable", { path, error })
    return { available: false, error }
  }

  try {
    const parsed: unknown = JSON.parse(stdout)
    return { available: true, value: FfprobeSchema.parse(parsed) }
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      const message = `ffprobe output invalid: ${error.message}`
      logger.warn("ffprobe output invalid", { path, error: message })
      return { available: false, error: message }
    }
    throw error
  }
}

export function parseNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

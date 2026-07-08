import { mkdir, readdir, rm } from "node:fs/promises"
import { join, parse } from "node:path"

import { logger } from "../common/logger"

export type SampledFrame = {
  readonly time: number
  readonly path: string
}

export type FrameCommandResult =
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly exitCode: number }
  | { readonly kind: "missing" }
  | { readonly kind: "timeout" }

export type FrameCommandRunner = (command: readonly string[]) => Promise<FrameCommandResult>

export type SampleFramesOptions = {
  readonly intervalSeconds?: number
  readonly maxFrames?: number
  readonly runner?: FrameCommandRunner
}

const DEFAULT_INTERVAL_SECONDS = 3
const DEFAULT_MAX_FRAMES = 20
const FFMPEG_TIMEOUT_MS = 30_000

export async function sampleFrames(
  inputPath: string,
  options: SampleFramesOptions = {},
): Promise<readonly SampledFrame[]> {
  const intervalSeconds = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES
  const runner = options.runner ?? runFfmpeg
  const parsedInput = parse(inputPath)
  const cacheDir = join(parsedInput.dir, ".media_cache", parsedInput.name)
  const outputPattern = join(cacheDir, "frame_%03d.jpg")

  await rm(cacheDir, { recursive: true, force: true })
  await mkdir(cacheDir, { recursive: true })

  const result = await runner([
    "ffmpeg",
    "-i",
    inputPath,
    "-vf",
    `fps=1/${intervalSeconds}`,
    "-q:v",
    "2",
    outputPattern,
  ])

  if (result.kind === "missing") {
    logger.warn("ffmpeg unavailable; video frames skipped", { path: inputPath })
    return []
  }

  if (result.kind !== "ok") {
    logger.warn("ffmpeg frame sampling failed", { path: inputPath })
    return []
  }

  const frameNames = (await readdir(cacheDir))
    .filter((entry) => /^frame_\d{3}\.jpg$/.test(entry))
    .sort()
    .slice(0, maxFrames)

  return frameNames.map((frameName, index) => ({
    time: index * intervalSeconds,
    path: join(cacheDir, frameName),
  }))
}

async function runFfmpeg(command: readonly string[]): Promise<FrameCommandResult> {
  try {
    const process = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
    const timeout = setTimeout(() => process.kill(), FFMPEG_TIMEOUT_MS)
    const exitCode = await process.exited
    clearTimeout(timeout)
    await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).arrayBuffer(),
    ])
    return exitCode === 0 ? { kind: "ok" } : { kind: "failed", exitCode }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "missing" }
    }
    throw error
  }
}

import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FrameCommandRunner } from "./sampleFrames"
import { sampleFrames } from "./sampleFrames"

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-video-"))
}

test("sampleFrames runs ffmpeg and returns default interval frame times", async () => {
  const tempDir = await makeTempDir()
  const videoPath = join(tempDir, "clip.mp4")
  await Bun.write(videoPath, "video")
  const commands: (readonly string[])[] = []
  const runner: FrameCommandRunner = async (command) => {
    commands.push(command)
    const outputPattern = command.at(-1)
    if (outputPattern === undefined) {
      return { kind: "failed", exitCode: 1 }
    }
    await Bun.write(outputPattern.replace("%03d", "001"), "one")
    await Bun.write(outputPattern.replace("%03d", "002"), "two")
    await Bun.write(outputPattern.replace("%03d", "003"), "three")
    await Bun.write(outputPattern.replace("%03d", "004"), "four")
    return { kind: "ok" }
  }

  const frames = await sampleFrames(videoPath, { runner })

  const expectedDir = join(tempDir, ".media_cache", "clip")
  expect(commands).toEqual([
    ["ffmpeg", "-i", videoPath, "-vf", "fps=1/3", "-q:v", "2", join(expectedDir, "frame_%03d.jpg")],
  ])
  expect(frames).toEqual([
    { time: 0, path: join(expectedDir, "frame_001.jpg") },
    { time: 3, path: join(expectedDir, "frame_002.jpg") },
    { time: 6, path: join(expectedDir, "frame_003.jpg") },
    { time: 9, path: join(expectedDir, "frame_004.jpg") },
  ])
})

test("sampleFrames cleans stale cache and caps returned frames", async () => {
  const tempDir = await makeTempDir()
  const videoPath = join(tempDir, "clip.mp4")
  const cacheDir = join(tempDir, ".media_cache", "clip")
  await Bun.write(videoPath, "video")
  await mkdir(cacheDir, { recursive: true })
  await Bun.write(join(cacheDir, "frame_999.jpg"), "stale")
  const runner: FrameCommandRunner = async (command) => {
    const outputPattern = command.at(-1)
    if (outputPattern === undefined) {
      return { kind: "failed", exitCode: 1 }
    }
    await Bun.write(outputPattern.replace("%03d", "001"), "one")
    await Bun.write(outputPattern.replace("%03d", "002"), "two")
    await Bun.write(outputPattern.replace("%03d", "003"), "three")
    return { kind: "ok" }
  }

  const frames = await sampleFrames(videoPath, { intervalSeconds: 2, maxFrames: 2, runner })
  const cacheEntries = (await readdir(cacheDir)).sort()

  expect(frames).toEqual([
    { time: 0, path: join(cacheDir, "frame_001.jpg") },
    { time: 2, path: join(cacheDir, "frame_002.jpg") },
  ])
  expect(cacheEntries).toEqual(["frame_001.jpg", "frame_002.jpg", "frame_003.jpg"])
})

test("sampleFrames returns empty frames when ffmpeg is missing", async () => {
  const tempDir = await makeTempDir()
  const videoPath = join(tempDir, "clip.mp4")
  await Bun.write(videoPath, "video")
  const messages: string[] = []
  const originalError = console.error
  console.error = (...data: unknown[]) => {
    messages.push(data.map(String).join(" "))
  }
  const runner: FrameCommandRunner = async () => ({ kind: "missing" })

  const frames = await sampleFrames(videoPath, { runner })
  console.error = originalError

  expect(frames).toEqual([])
  expect(messages).toEqual([
    `WARN ffmpeg unavailable; video frames skipped {"path":"${videoPath}"}`,
  ])
})

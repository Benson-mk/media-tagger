import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { probeAudio } from "../probeAudio"
import { probeImage } from "../probeImage"
import { probeVideo } from "../probeVideo"

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-metadata-"))
}

async function writeTinyPng(path: string): Promise<void> {
  await writeFile(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAD9fD44AAAADUlEQVR42mP8z8BQDwAFgwJ/lK3uGQAAAABJRU5ErkJggg==",
      "base64",
    ),
  )
}

async function writeFfprobe(binDir: string, payload: string): Promise<void> {
  const scriptPath = join(binDir, "ffprobe")
  await writeFile(scriptPath, `#!/bin/sh\nprintf '%s\\n' '${payload}'\n`)
  await chmod(scriptPath, 0o755)
}

function ffprobePath(binDir: string): string {
  return join(binDir, "ffprobe")
}

test("probeImage returns dimensions orientation and aspect ratio for valid image", async () => {
  // Given: a tiny generated image fixture
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "tiny.png")
  await writeTinyPng(imagePath)

  // When: image metadata is probed
  const result = await probeImage(imagePath)

  // Then: technical fields are returned
  expect(result).toEqual({
    available: true,
    width: 2,
    height: 1,
    orientation: null,
    aspect_ratio: "2:1",
  })
})

test("probeImage returns unavailable and logs warning for corrupt image", async () => {
  // Given: a corrupt image file and captured warnings
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "corrupt.png")
  await writeFile(imagePath, "not an image")
  const messages: string[] = []
  const originalError = console.error
  console.error = (...data: unknown[]) => {
    messages.push(data.map(String).join(" "))
  }

  try {
    // When: image metadata is probed
    const result = await probeImage(imagePath)

    // Then: probe fails gracefully
    expect(result.available).toBe(false)
    if (!result.available) {
      expect(result.error).toContain("image probe failed")
    }
    expect(messages.join("\n")).toContain("WARN image probe failed")
  } finally {
    console.error = originalError
  }
})

test("probeVideo returns ffprobe stream metadata when ffprobe is available", async () => {
  // Given: a fake ffprobe executable emitting video JSON
  const tempDir = await makeTempDir()
  const binDir = join(tempDir, "bin")
  await mkdir(binDir)
  await writeFfprobe(
    binDir,
    JSON.stringify({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          r_frame_rate: "30000/1001",
          codec_name: "h264",
        },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: { duration: "12.5" },
    }),
  )
  // When: video metadata is probed
  const result = await probeVideo(join(tempDir, "clip.mp4"), ffprobePath(binDir))

  // Then: technical fields are returned
  expect(result).toEqual({
    available: true,
    duration: 12.5,
    width: 1920,
    height: 1080,
    fps: 29.97,
    codec: "h264",
    has_audio: true,
  })
})

test("probeAudio returns ffprobe audio metadata when ffprobe is available", async () => {
  // Given: a fake ffprobe executable emitting audio JSON
  const tempDir = await makeTempDir()
  const binDir = join(tempDir, "bin")
  await mkdir(binDir)
  await writeFfprobe(
    binDir,
    JSON.stringify({
      streams: [{ codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }],
      format: { duration: "7.25", bit_rate: "192000" },
    }),
  )
  // When: audio metadata is probed
  const result = await probeAudio(join(tempDir, "song.m4a"), ffprobePath(binDir))

  // Then: technical fields are returned
  expect(result).toEqual({
    available: true,
    duration: 7.25,
    codec: "aac",
    sample_rate: 48000,
    channels: 2,
    bitrate: 192000,
  })
})

test("probeVideo and probeAudio return unavailable when ffprobe is missing", async () => {
  // Given: PATH without ffprobe and captured warnings
  const tempDir = await makeTempDir()
  const emptyPath = join(tempDir, "empty")
  await mkdir(emptyPath)
  const messages: string[] = []
  const originalError = console.error
  console.error = (...data: unknown[]) => {
    messages.push(data.map(String).join(" "))
  }

  try {
    // When: ffprobe-backed metadata is probed
    const video = await probeVideo(join(tempDir, "clip.mp4"), ffprobePath(emptyPath))
    const audio = await probeAudio(join(tempDir, "song.mp3"), ffprobePath(emptyPath))

    // Then: both probes fail gracefully
    expect(video.available).toBe(false)
    expect(audio.available).toBe(false)
    if (!video.available) {
      expect(video.error).toContain("ffprobe unavailable")
    }
    if (!audio.available) {
      expect(audio.error).toContain("ffprobe unavailable")
    }
    expect(messages.join("\n")).toContain("WARN ffprobe unavailable")
  } finally {
    console.error = originalError
  }
})

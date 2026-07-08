import { expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { manifestPath, sidecarPath } from "../common/paths"
import { MediaSidecarSchema } from "../common/schema"
import { tagBgm } from "./tagBgm"

type RecordedRequest = {
  readonly body: unknown
}

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-bgm-"))
}

function serveBgmResponse(): {
  readonly url: string
  readonly records: readonly RecordedRequest[]
  close(): void
} {
  const records: RecordedRequest[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      records.push({ body: await request.json() })
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                music_type: "instrumental bed",
                vocal_presence: "none",
                genre: ["lo-fi", "ambient"],
                mood: ["calm", "focused"],
                energy: "low",
                tempo: { bpm: 92, confidence: 0.7 },
                key: { value: "A minor", confidence: 0.4 },
                structure: { has_intro: true, has_outro: true, loopable: false },
                voiceover: { vocal_presence: "none", safe_for_voiceover: true },
                editing_use: ["tutorial", "voiceover bed"],
                avoid_use: ["sports montage"],
                tags: ["warm", "soft"],
              }),
            },
          },
        ],
      })
    },
  })

  return { url: server.url.href, records, close: () => server.stop(true) }
}

async function parseSidecar(mediaPath: string) {
  const raw = await readFile(sidecarPath(mediaPath), "utf8")
  const parsed: unknown = JSON.parse(raw)
  return MediaSidecarSchema.parse(parsed)
}

test("tagBgm writes API BGM metadata and manifest when API is enabled", async () => {
  // Given: audio file, mock extractor, mock probe, and mock OpenAI-compatible API
  const tempDir = await makeTempDir()
  const audioPath = join(tempDir, "bed.mp3")
  await Bun.write(audioPath, "fake audio")
  const server = serveBgmResponse()

  try {
    // When: BGM tagging runs with API enabled
    await tagBgm({
      mediaPath: audioPath,
      manifestFile: manifestPath(tempDir),
      api: true,
      base_url: server.url,
      model: "bgm-test",
      api_key: "test-key",
      probeAudio: async () => ({
        available: true,
        duration: 45,
        codec: "mp3",
        sample_rate: 44_100,
        channels: 2,
        bitrate: 128_000,
      }),
      extractClip: async () => ({ kind: "data_url", data_url: "data:audio/mpeg;base64,AAAA" }),
    })

    // Then: sidecar has parsed BGM fields and manifest mirrors same asset
    const sidecar = await parseSidecar(audioPath)
    const manifest = await readFile(manifestPath(tempDir), "utf8")
    expect(sidecar.bgm?.genre).toEqual(["lo-fi", "ambient"])
    expect(sidecar.bgm?.mood).toEqual(["calm", "focused"])
    expect(sidecar.bgm?.energy).toBe("low")
    expect(sidecar.bgm?.voiceover.safe_for_voiceover).toBe(true)
    expect(sidecar.bgm?.editing_use).toEqual(["tutorial", "voiceover bed"])
    expect(sidecar.tags.audio).toEqual(["lo-fi", "ambient", "warm", "soft"])
    expect(sidecar.api_usage).toEqual({
      provider: server.url,
      model: "bgm-test",
      media_uploaded_to_api: true,
    })
    expect(manifest).toContain(sidecar.asset_id)
    expect(server.records).toHaveLength(1)
  } finally {
    server.close()
  }
})

test("tagBgm writes technical audio metadata only when API is disabled", async () => {
  // Given: audio probe succeeds and API seam would fail if called
  const tempDir = await makeTempDir()
  const audioPath = join(tempDir, "bed.wav")
  await Bun.write(audioPath, "fake audio")

  // When: BGM tagging runs without API
  await tagBgm({
    mediaPath: audioPath,
    manifestFile: manifestPath(tempDir),
    api: false,
    base_url: "http://127.0.0.1:9",
    model: "bgm-test",
    api_key: "test-key",
    probeAudio: async () => ({
      available: true,
      duration: 12,
      codec: "pcm_s16le",
      sample_rate: 48_000,
      channels: 1,
      bitrate: 96_000,
    }),
    extractClip: async () => {
      throw new Error("extractClip should not run")
    },
  })

  // Then: sidecar keeps technical metadata and omits BGM analysis
  const sidecar = await parseSidecar(audioPath)
  expect(sidecar.technical).toEqual({
    duration: 12,
    codec: "pcm_s16le",
    sample_rate: 48_000,
    channels: 1,
    bitrate: 96_000,
  })
  expect(sidecar.bgm).toBeUndefined()
  expect(sidecar.api_usage.media_uploaded_to_api).toBe(false)
})

test("tagBgm warns and writes empty technical metadata when ffmpeg probe is unavailable", async () => {
  // Given: missing ffmpeg/ffprobe style probe failure and captured stderr
  const tempDir = await makeTempDir()
  const audioPath = join(tempDir, "missing-tools.mp3")
  const messages: string[] = []
  const originalError = console.error
  console.error = (...data: readonly unknown[]) => {
    messages.push(data.map(String).join(" "))
  }
  await Bun.write(audioPath, "fake audio")

  try {
    // When: BGM tagging runs with unavailable audio probe
    await tagBgm({
      mediaPath: audioPath,
      manifestFile: manifestPath(tempDir),
      api: true,
      base_url: "http://127.0.0.1:9",
      model: "bgm-test",
      api_key: "test-key",
      probeAudio: async () => ({ available: false, error: "ffprobe unavailable: not found" }),
      extractClip: async () => {
        throw new Error("extractClip should not run")
      },
    })

    // Then: run does not crash, logs warning, and omits BGM analysis
    const sidecar = await parseSidecar(audioPath)
    expect(sidecar.technical).toEqual({})
    expect(sidecar.bgm).toBeUndefined()
    expect(messages.some((message) => message.includes("BGM probe unavailable"))).toBe(true)
  } finally {
    console.error = originalError
  }
})

import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { MediaSidecarSchema } from "../common/schema"
import type { VideoProbeResult } from "../metadata/probeVideo"
import type { SampledFrame } from "./sampleFrames"
import { tagVideoFootage } from "./tagVideoFootage"

type RecordedRequest = {
  readonly body: unknown
}

const VideoChatRequestSchema = z.object({
  model: z.string(),
  response_format: z.object({ type: z.literal("json_object") }),
  messages: z.tuple([
    z.object({
      role: z.literal("user"),
      content: z.array(z.object({ type: z.string() }).passthrough()),
    }),
  ]),
})

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-video-tag-"))
}

function fixedDate(): Date {
  return new Date("2026-07-07T12:00:00.000Z")
}

async function readSidecar(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

async function readManifestLine(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, "utf8")).trim())
}

function serveVideoResponse(): {
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
                whole_video_caption: "Runner crosses bridge at sunrise.",
                segments: [
                  {
                    start_seconds: 0,
                    end_seconds: 3,
                    caption: "Runner enters the bridge.",
                    tags: ["runner", "bridge"],
                    shot_type: "wide",
                    camera_motion: "tracking",
                    motion_level: "medium",
                    recommended_use: ["fitness intro"],
                    quality_score: 91,
                  },
                ],
                overall_tags: {
                  core: ["running"],
                  visual: ["sunrise"],
                  audio: [],
                  mood: ["energetic"],
                  style: ["documentary"],
                  editing: ["intro"],
                  project: ["fitness"],
                },
                summary: {
                  title: "Bridge run",
                  short_caption: "Runner on bridge at sunrise",
                  detailed_caption: "Runner crosses a bridge in warm morning light.",
                  best_use: ["fitness intro"],
                  not_recommended_for: ["static product shot"],
                },
                quality: { overall_score: 90, reuse_score: 88 },
              }),
            },
          },
        ],
      })
    },
  })

  return { url: server.url.href, records, close: () => server.stop(true) }
}

test("tagVideoFootage writes enriched sidecar and manifest when API returns video tags", async () => {
  // Given: video file, sampled frames, technical probe, and mock VLM
  const tempDir = await makeTempDir()
  const videoPath = join(tempDir, "clip.mp4")
  const sidecarPath = join(tempDir, "clip.media.json")
  const manifestPath = join(tempDir, "media_manifest.jsonl")
  const framePath = join(tempDir, "frame_001.jpg")
  await writeFile(videoPath, "video")
  await writeFile(framePath, "frame")
  const server = serveVideoResponse()

  try {
    // When: video tagging runs with API enabled
    await tagVideoFootage({
      videoPath,
      assetId: "sha256:clip",
      manifestPath,
      api: { api: true, base_url: server.url, model: "vlm-test", api_key: "test-key" },
      now: fixedDate,
      dependencies: {
        probe: async (): Promise<VideoProbeResult> => ({
          available: true,
          duration: 6,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: "h264",
          has_audio: true,
        }),
        sample: async (): Promise<readonly SampledFrame[]> => [{ time: 0, path: framePath }],
        detectTempoKey: async () => null,
      },
    })

    // Then: sidecar and manifest contain parsed video enrichment
    const sidecar = MediaSidecarSchema.parse(await readSidecar(sidecarPath))
    const manifest = MediaSidecarSchema.parse(await readManifestLine(manifestPath))
    expect(sidecar.video?.sampling.frames).toEqual([{ time_seconds: 0, path: framePath }])
    expect(sidecar.video?.segments[0]?.caption).toBe("Runner enters the bridge.")
    expect(sidecar.tags.core).toEqual(["running"])
    expect(sidecar.summary.short_caption).toBe("Runner on bridge at sunrise")
    expect(sidecar.quality.overall_score).toBe(90)
    expect(manifest.video?.segments[0]?.caption).toBe("Runner enters the bridge.")
    expect(server.records).toHaveLength(1)
    const request = VideoChatRequestSchema.parse(server.records[0]?.body)
    expect(request.model).toBe("vlm-test")
    expect(request.messages[0].content.map((part) => part.type)).toEqual(["text", "image_url"])
  } finally {
    server.close()
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tagVideoFootage writes technical sidecar without API call when API disabled", async () => {
  // Given: disabled API config and fake sampler that would provide frames
  const tempDir = await makeTempDir()
  const videoPath = join(tempDir, "clip.mp4")
  const manifestPath = join(tempDir, "media_manifest.jsonl")
  const framePath = join(tempDir, "frame_001.jpg")
  await writeFile(videoPath, "video")
  await writeFile(framePath, "frame")
  let sampleCalls = 0

  try {
    // When: tagging runs without api true
    await tagVideoFootage({
      videoPath,
      assetId: "sha256:clip",
      manifestPath,
      api: { base_url: "http://127.0.0.1:9", model: "vlm-test", api_key: "test-key" },
      now: fixedDate,
      dependencies: {
        probe: async (): Promise<VideoProbeResult> => ({
          available: true,
          duration: 6,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: "h264",
          has_audio: true,
        }),
        sample: async (): Promise<readonly SampledFrame[]> => {
          sampleCalls += 1
          return [{ time: 0, path: framePath }]
        },
        detectTempoKey: async () => ({
          tempo: { bpm: 120, confidence: 0.7 },
          key: { value: "C major", confidence: 0.6 },
        }),
      },
    })

    // Then: sidecar keeps technical metadata (incl. local tempo/key) and omits video enrichment
    const sidecar = MediaSidecarSchema.parse(await readSidecar(join(tempDir, "clip.media.json")))
    expect(sampleCalls).toBe(0)
    expect(sidecar.video).toBeUndefined()
    expect(sidecar.technical).toEqual({
      duration: 6,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "h264",
      has_audio: true,
      tempo: { bpm: 120, confidence: 0.7 },
      key: { value: "C major", confidence: 0.6 },
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tagVideoFootage writes graceful sidecar when frame sampling returns no frames", async () => {
  // Given: API enabled but sampler cannot extract frames
  const tempDir = await makeTempDir()
  const videoPath = join(tempDir, "clip.mp4")
  const manifestPath = join(tempDir, "media_manifest.jsonl")
  await writeFile(videoPath, "video")

  try {
    // When: tagging runs with empty sampled frames
    await tagVideoFootage({
      videoPath,
      assetId: "sha256:clip",
      manifestPath,
      api: { api: true, base_url: "http://127.0.0.1:9", model: "vlm-test", api_key: "test-key" },
      now: fixedDate,
      dependencies: {
        probe: async (): Promise<VideoProbeResult> => ({
          available: false,
          error: "ffprobe unavailable",
        }),
        sample: async (): Promise<readonly SampledFrame[]> => [],
      },
    })

    // Then: sidecar remains schema-valid and no request is attempted
    const sidecar = MediaSidecarSchema.parse(await readSidecar(join(tempDir, "clip.media.json")))
    expect(sidecar.video).toBeUndefined()
    expect(sidecar.technical).toEqual({ probe_error: "ffprobe unavailable" })
    expect(sidecar.summary.short_caption).toBe("")
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

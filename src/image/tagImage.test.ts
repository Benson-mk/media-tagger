import { expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { MediaSidecarSchema } from "../common/schema"
import { TagImageResponseError, tagImage } from "./tagImage"

const ChatRequestSchema = z.object({
  model: z.string(),
  response_format: z.object({ type: z.literal("json_object") }),
  messages: z.array(
    z.object({
      role: z.literal("user"),
      content: z.array(
        z.union([
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({
            type: z.literal("image_url"),
            image_url: z.object({ url: z.string() }),
          }),
        ]),
      ),
    }),
  ),
})

type ChatRequest = z.infer<typeof ChatRequestSchema>

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-image-"))
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

async function readSidecar(path: string) {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  return MediaSidecarSchema.parse(parsed)
}

async function readManifest(path: string) {
  const lines = (await readFile(path, "utf8")).trim().split("\n")
  return lines.map((line) => {
    const parsed: unknown = JSON.parse(line)
    return MediaSidecarSchema.parse(parsed)
  })
}

function serveImageTagger(content: string): {
  readonly url: string
  readonly requests: readonly ChatRequest[]
  close(): void
} {
  const requests: ChatRequest[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const payload: unknown = await request.json()
      requests.push(ChatRequestSchema.parse(payload))
      return Response.json({ choices: [{ message: { content } }] })
    },
  })

  return { url: server.url.href, requests, close: () => server.stop(true) }
}

const VLM_IMAGE_RESPONSE = {
  title: "Tiny red pixel",
  short_caption: "Small red image",
  detailed_caption: "A tiny red graphic with minimal composition.",
  best_use: ["thumbnail placeholder"],
  not_recommended_for: ["large hero image"],
  tags: {
    core: ["tiny", "red"],
    visual: ["minimal"],
    audio: [],
    mood: ["neutral"],
    style: ["graphic"],
    editing: ["placeholder"],
    project: ["test-fixture"],
  },
  quality: { overall_score: 64, reuse_score: 52 },
  image: {
    composition: {
      shot_type: "macro",
      main_subject: "red pixel field",
      background: "solid color",
      text_space: "full frame",
      usable_crops: ["1:1", "2:1"],
    },
    detected_text: [],
    thumbnail_usefulness: "medium",
  },
}

test("tagImage writes schema-valid sidecar and manifest when API returns image tags", async () => {
  // Given: image file and mock VLM server
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "photo.png")
  const sidecarPath = join(tempDir, "photo.media.json")
  const manifestPath = join(tempDir, "media_manifest.jsonl")
  await writeTinyPng(imagePath)
  const server = serveImageTagger(JSON.stringify(VLM_IMAGE_RESPONSE))

  try {
    // When: API image tagging runs
    const result = await tagImage({
      path: imagePath,
      manifestPath,
      api: true,
      base_url: server.url,
      model: "vlm-test",
      api_key: "test-key",
    })
    const sidecar = await readSidecar(sidecarPath)
    const manifest = await readManifest(manifestPath)

    // Then: sidecar and manifest contain VLM image metadata
    expect(result.kind).toBe("written")
    expect(sidecar.image?.composition.main_subject).toBe("red pixel field")
    expect(sidecar.tags.core).toEqual(["tiny", "red"])
    expect(sidecar.summary.short_caption).toBe("Small red image")
    expect(sidecar.quality).toEqual({ overall_score: 64, reuse_score: 52 })
    expect(sidecar.api_usage).toEqual({
      provider: "openai_compatible",
      model: "vlm-test",
      media_uploaded_to_api: true,
    })
    expect(manifest).toEqual([sidecar])
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.messages[0]?.content[0]).toEqual(
      expect.objectContaining({ type: "text" }),
    )
  } finally {
    server.close()
  }
})

test("tagImage writes technical-only sidecar and skips API when API is disabled", async () => {
  // Given: image file and mock server that must not be called
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "photo.png")
  const sidecarPath = join(tempDir, "photo.media.json")
  const manifestPath = join(tempDir, "media_manifest.jsonl")
  const messages: string[] = []
  const originalError = console.error
  console.error = (...data: unknown[]) => {
    messages.push(data.map(String).join(" "))
  }
  await writeTinyPng(imagePath)
  const server = serveImageTagger(JSON.stringify(VLM_IMAGE_RESPONSE))

  try {
    // When: image tagging runs without API enabled
    const result = await tagImage({
      path: imagePath,
      manifestPath,
      base_url: server.url,
      model: "vlm-test",
      api_key: "test-key",
    })
    const sidecar = await readSidecar(sidecarPath)

    // Then: only local technical metadata is written
    expect(result.kind).toBe("written")
    expect(sidecar.technical).toEqual({
      width: 2,
      height: 1,
      orientation: null,
      aspect_ratio: "2:1",
    })
    expect(sidecar.image).toBeUndefined()
    expect(sidecar.tags.core).toEqual([])
    expect(sidecar.api_usage.media_uploaded_to_api).toBe(false)
    expect(server.requests).toHaveLength(0)
    expect(messages).toEqual(["INFO API tagging disabled"])
  } finally {
    console.error = originalError
    server.close()
  }
})

test("tagImage dry run returns plan without API call or writes", async () => {
  // Given: image file and mock VLM server
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "photo.png")
  const sidecarPath = join(tempDir, "photo.media.json")
  const manifestPath = join(tempDir, "media_manifest.jsonl")
  await writeTinyPng(imagePath)
  const server = serveImageTagger(JSON.stringify(VLM_IMAGE_RESPONSE))

  try {
    // When: dry run image tagging runs with API option present
    const result = await tagImage({
      path: imagePath,
      manifestPath,
      dryRun: true,
      api: true,
      base_url: server.url,
      model: "vlm-test",
      api_key: "test-key",
    })

    // Then: plan is returned and filesystem/API stay untouched
    expect(result).toEqual(
      expect.objectContaining({ kind: "plan", path: imagePath, sidecarPath, manifestPath }),
    )
    expect(await Bun.file(sidecarPath).exists()).toBe(false)
    expect(await Bun.file(manifestPath).exists()).toBe(false)
    expect(server.requests).toHaveLength(0)
  } finally {
    server.close()
  }
})

test("tagImage throws typed error and preserves existing sidecar when API response mismatches schema", async () => {
  // Given: existing sidecar and malformed VLM schema response
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "photo.png")
  const sidecarPath = join(tempDir, "photo.media.json")
  const manifestPath = join(tempDir, "media_manifest.jsonl")
  await writeTinyPng(imagePath)
  await writeFile(sidecarPath, '{\n  "keep": true\n}\n')
  const server = serveImageTagger(JSON.stringify({ title: "missing required fields" }))

  try {
    // When: VLM response fails image tag schema parsing
    const failure = tagImage({
      path: imagePath,
      manifestPath,
      api: true,
      base_url: server.url,
      model: "vlm-test",
      api_key: "test-key",
    })

    // Then: typed error is thrown and old sidecar remains untouched
    await expect(failure).rejects.toThrow(TagImageResponseError)
    expect(await readFile(sidecarPath, "utf8")).toBe('{\n  "keep": true\n}\n')
    expect(await Bun.file(manifestPath).exists()).toBe(false)
  } finally {
    server.close()
  }
})

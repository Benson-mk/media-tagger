import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { sidecarPath } from "../common/paths"
import { MediaSidecarSchema } from "../common/schema"

type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const ChatRequestSchema = z.object({
  model: z.string(),
  response_format: z.object({ type: z.literal("json_object") }),
  messages: z.array(z.object({ role: z.literal("user"), content: z.array(z.unknown()) })),
})

type ChatRequest = z.infer<typeof ChatRequestSchema>

const IMAGE_RESPONSE = {
  title: "CLI image",
  short_caption: "Tagged through CLI",
  detailed_caption: "A small fixture image tagged by the CLI.",
  best_use: ["test"],
  not_recommended_for: [],
  tags: {
    core: ["cli"],
    visual: ["fixture"],
    audio: [],
    mood: ["neutral"],
    style: ["minimal"],
    editing: ["tag-test"],
    project: ["media-tagger"],
  },
  quality: { overall_score: 70, reuse_score: 60 },
  image: {
    composition: {
      shot_type: "macro",
      main_subject: "tiny fixture",
      background: "solid",
      text_space: "full",
      usable_crops: ["1:1"],
    },
    detected_text: [],
    thumbnail_usefulness: "medium",
  },
}

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-cli-tag-"))
}

async function runCli(
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  return { exitCode, stdout, stderr }
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

async function writeMixedMedia(rootPath: string): Promise<void> {
  await writeTinyPng(join(rootPath, "photo.png"))
  await Bun.write(join(rootPath, "clip.mp4"), "fake video")
  await Bun.write(join(rootPath, "bed.mp3"), "fake audio")
}

async function parseSidecar(path: string) {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  return MediaSidecarSchema.parse(parsed)
}

async function parseManifest(path: string) {
  const contents = await readFile(path, "utf8")
  return contents
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      return MediaSidecarSchema.parse(parsed)
    })
}

function serveImageResponse(): {
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
      return Response.json({ choices: [{ message: { content: JSON.stringify(IMAGE_RESPONSE) } }] })
    },
  })

  return { url: server.url.href, requests, close: () => server.stop(true) }
}

test("tag dry-run prints mixed media and writes no sidecars or manifest", async () => {
  // Given: mixed media fixture directory
  const tempDir = await makeTempDir()
  await writeMixedMedia(tempDir)

  try {
    // When: tag command runs in dry-run mode
    const result = await runCli(["tag", tempDir, "--dry-run"])

    // Then: file plan is printed without writes
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("photo.png")
    expect(result.stdout).toContain("clip.mp4")
    expect(result.stdout).toContain("bed.mp3")
    expect(await Bun.file(sidecarPath(join(tempDir, "photo.png"))).exists()).toBe(false)
    expect(await Bun.file(sidecarPath(join(tempDir, "clip.mp4"))).exists()).toBe(false)
    expect(await Bun.file(join(tempDir, "media_manifest.jsonl")).exists()).toBe(false)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tag writes schema-valid sidecars and custom manifest when API is disabled", async () => {
  // Given: mixed media fixture directory and custom manifest output
  const tempDir = await makeTempDir()
  await writeMixedMedia(tempDir)
  const outputPath = join(tempDir, "tagged.jsonl")

  try {
    // When: tag command runs without API flag
    const result = await runCli(["tag", tempDir, "--output", outputPath])
    const photo = await parseSidecar(sidecarPath(join(tempDir, "photo.png")))
    const clip = await parseSidecar(sidecarPath(join(tempDir, "clip.mp4")))
    const bed = await parseSidecar(sidecarPath(join(tempDir, "bed.mp3")))
    const manifest = await parseManifest(outputPath)

    // Then: all media write valid local-only records
    expect(result.exitCode).toBe(0)
    expect(photo.media_type).toBe("image")
    expect(clip.media_type).toBe("video")
    expect(bed.media_type).toBe("audio")
    expect(manifest).toHaveLength(3)
    expect(manifest.every((entry) => entry.api_usage.media_uploaded_to_api === false)).toBe(true)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tag with API and image type calls API only for images", async () => {
  // Given: mixed media fixture directory and local API seam
  const tempDir = await makeTempDir()
  await writeMixedMedia(tempDir)
  const server = serveImageResponse()

  try {
    // When: API tag command is limited to images
    const result = await runCli([
      "tag",
      tempDir,
      "--api",
      "--api-key",
      "test-key",
      "--api-base-url",
      server.url,
      "--api-model",
      "cli-model",
      "--type",
      "image",
    ])
    const photo = await parseSidecar(sidecarPath(join(tempDir, "photo.png")))

    // Then: image uses API and video/audio are untouched
    expect(result.exitCode).toBe(0)
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.model).toBe("cli-model")
    expect(photo.api_usage.media_uploaded_to_api).toBe(true)
    expect(photo.tags.core).toEqual(["cli"])
    expect(await Bun.file(sidecarPath(join(tempDir, "clip.mp4"))).exists()).toBe(false)
    expect(await Bun.file(sidecarPath(join(tempDir, "bed.mp3"))).exists()).toBe(false)
  } finally {
    server.close()
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tag reads base url and model from environment variables", async () => {
  // Given: image fixture and API config supplied only via env
  const tempDir = await makeTempDir()
  await writeTinyPng(join(tempDir, "photo.png"))
  const server = serveImageResponse()

  try {
    // When: API tag command runs without base-url/model flags
    const result = await runCli(["tag", tempDir, "--api", "--type", "image"], {
      MEDIA_TAG_API_KEY: "env-key",
      MEDIA_TAG_BASE_URL: server.url,
      MEDIA_TAG_MODEL: "env-model",
    })

    // Then: request goes to env base url with env model
    expect(result.exitCode).toBe(0)
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.model).toBe("env-model")
  } finally {
    server.close()
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tag skip-existing preserves sidecar and force overwrites it", async () => {
  // Given: image fixture with existing sidecar
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "photo.png")
  const outputPath = join(tempDir, "tagged.jsonl")
  const existingSidecar = sidecarPath(imagePath)
  await writeTinyPng(imagePath)
  await writeFile(existingSidecar, "keep me")

  try {
    // When: skip-existing runs, then force runs
    const skipped = await runCli(["tag", tempDir, "--type", "image", "--skip-existing"])
    const skippedContent = await readFile(existingSidecar, "utf8")
    const forced = await runCli([
      "tag",
      tempDir,
      "--type",
      "image",
      "--force",
      "--output",
      outputPath,
    ])
    const overwritten = await parseSidecar(existingSidecar)

    // Then: skip preserves and force replaces with schema-valid sidecar
    expect(skipped.exitCode).toBe(0)
    expect(skipped.stdout).toContain("skip")
    expect(skippedContent).toBe("keep me")
    expect(forced.exitCode).toBe(0)
    expect(overwritten.media_type).toBe("image")
    expect(await parseManifest(outputPath)).toHaveLength(1)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tag no-sidecar writes manifest and removes sidecar file", async () => {
  // Given: image fixture and manifest-only output request
  const tempDir = await makeTempDir()
  const imagePath = join(tempDir, "photo.png")
  const outputPath = join(tempDir, "tagged.jsonl")
  await writeTinyPng(imagePath)

  try {
    // When: tag command runs with sidecar disabled
    const result = await runCli([
      "tag",
      tempDir,
      "--type",
      "image",
      "--no-sidecar",
      "--output",
      outputPath,
    ])
    const manifest = await parseManifest(outputPath)

    // Then: manifest remains and sidecar is absent
    expect(result.exitCode).toBe(0)
    expect(manifest).toHaveLength(1)
    expect(manifest[0]?.media_type).toBe("image")
    expect(await Bun.file(sidecarPath(imagePath)).exists()).toBe(false)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("tag rejects unknown type with clear stderr", async () => {
  // Given: existing directory
  const tempDir = await makeTempDir()

  try {
    // When: tag command receives unsupported type
    const result = await runCli(["tag", tempDir, "--type", "unknown"])

    // Then: command fails with clear invalid type message
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("invalid type")
    expect(result.stderr).toContain("unknown")
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

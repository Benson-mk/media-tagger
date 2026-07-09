import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MediaSidecarSchema } from "../common/schema"

type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-cli-"))
}

async function runCli(args: readonly string[]): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
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

async function writeTinyMediaFiles(rootPath: string): Promise<void> {
  await Bun.write(join(rootPath, "photo.jpg"), "image-one")
  await mkdir(join(rootPath, "nested"))
  await Bun.write(join(rootPath, "nested", "clip.png"), "image-two")
}

async function parseManifest(filePath: string) {
  const contents = await readFile(filePath, "utf8")
  return contents
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      return MediaSidecarSchema.parse(parsed)
    })
}

test("scan writes schema-valid manifest and updates by asset id when run twice", async () => {
  const tempDir = await makeTempDir()
  await writeTinyMediaFiles(tempDir)
  const manifestFile = join(tempDir, "media_manifest.jsonl")

  const firstRun = await runCli(["scan", tempDir])
  const secondRun = await runCli(["scan", tempDir])
  const entries = await parseManifest(manifestFile)

  expect(firstRun.exitCode).toBe(0)
  expect(secondRun.exitCode).toBe(0)
  expect(entries).toHaveLength(2)
  expect(new Set(entries.map((entry) => entry.asset_id)).size).toBe(2)
  for (const entry of entries) {
    expect(entry.asset_id).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(entry.media_type).toBe("image")
    expect(entry.schema_version).toBe("1.1")
    expect(entry.internal).toEqual({ origin: "local_scan" })
    expect(entry.technical).toEqual({})
    expect(entry.summary).toEqual({
      title: "",
      short_caption: "",
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    })
    expect(entry.tags).toEqual({
      core: [],
      visual: [],
      audio: [],
      mood: [],
      style: [],
      editing: [],
      project: [],
    })
    expect(entry.quality).toEqual({ overall_score: 0, reuse_score: 0 })
    expect(entry.rights).toEqual({
      owner: "user",
      source: "local_project_asset",
      license: "unknown",
      notes: "User-provided local media. Confirm rights before publishing.",
    })
    expect(entry.api_usage).toEqual({ provider: "", model: "", media_uploaded_to_api: false })
  }
})

test("scan dry run prints plan and writes no manifest", async () => {
  const tempDir = await makeTempDir()
  await writeTinyMediaFiles(tempDir)
  const manifestFile = join(tempDir, "media_manifest.jsonl")

  const result = await runCli(["scan", tempDir, "--dry-run"])

  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain("photo.jpg")
  expect(result.stdout).toContain("clip.png")
  expect(await Bun.file(manifestFile).exists()).toBe(false)
})

test("scan writes manifest to custom output path", async () => {
  const tempDir = await makeTempDir()
  await writeTinyMediaFiles(tempDir)
  const outputFile = join(tempDir, "custom.jsonl")

  const result = await runCli(["scan", tempDir, "--output", outputFile])
  const entries = await parseManifest(outputFile)

  expect(result.exitCode).toBe(0)
  expect(entries).toHaveLength(2)
  expect(await Bun.file(join(tempDir, "media_manifest.jsonl")).exists()).toBe(false)
})

test("scan exits one with clear stderr when no media found", async () => {
  const tempDir = await makeTempDir()
  await Bun.write(join(tempDir, "notes.txt"), "text")

  const result = await runCli(["scan", tempDir])

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("no media found")
})

test("scan exits one with clear stderr when directory is missing", async () => {
  const tempDir = await makeTempDir()
  const missingDir = join(tempDir, "missing")

  const result = await runCli(["scan", missingDir])

  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain(missingDir)
  expect(result.stderr).toContain("not found")
})

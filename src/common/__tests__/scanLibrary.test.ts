import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectMediaType } from "../detectMediaType"
import { scanLibrary } from "../scanLibrary"

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-scan-"))
}

test("detectMediaType returns image for supported image extensions", () => {
  expect(["jpg", "jpeg", "png", "gif", "webp", "avif", "tiff", "bmp"].map(detectMediaType)).toEqual(
    ["image", "image", "image", "image", "image", "image", "image", "image"],
  )
})

test("detectMediaType returns video for supported video extensions", () => {
  expect(["mp4", "mov", "avi", "mkv", "webm", "m4v"].map(detectMediaType)).toEqual([
    "video",
    "video",
    "video",
    "video",
    "video",
    "video",
  ])
})

test("detectMediaType returns audio for supported audio extensions", () => {
  expect(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma"].map(detectMediaType)).toEqual([
    "audio",
    "audio",
    "audio",
    "audio",
    "audio",
    "audio",
    "audio",
  ])
})

test("detectMediaType returns null for unsupported extensions", () => {
  expect(detectMediaType("txt")).toBeNull()
})

test("detectMediaType returns media types for filenames and unsupported filenames", () => {
  expect(detectMediaType("photo.jpg")).toBe("image")
  expect(detectMediaType("clip.mp4")).toBe("video")
  expect(detectMediaType("song.mp3")).toBe("audio")
  expect(detectMediaType("readme.txt")).toBeNull()
})

test("scanLibrary recursively returns media files and skips sidecars manifests and dot directories", async () => {
  const tempDir = await makeTempDir()
  const nestedDir = join(tempDir, "nested")
  const dotDir = join(tempDir, ".media_cache")
  await mkdir(nestedDir)
  await mkdir(dotDir)
  await writeFile(join(tempDir, "photo.jpg"), "image")
  await writeFile(join(nestedDir, "clip.mp4"), "video")
  await writeFile(join(tempDir, "song.mp3"), "audio")
  await writeFile(join(tempDir, "notes.txt"), "text")
  await writeFile(join(tempDir, "photo.media.json"), "{}")
  await writeFile(join(tempDir, "media_manifest.jsonl"), "{}\n")
  await writeFile(join(dotDir, "hidden.jpg"), "hidden")

  const entries = await scanLibrary(tempDir)
  const stableEntries = entries.toSorted((left, right) => left.path.localeCompare(right.path))

  expect(stableEntries).toEqual([
    {
      path: join(nestedDir, "clip.mp4"),
      media_type: "video",
      size: 5,
      mtime: expect.any(Date),
    },
    {
      path: join(tempDir, "photo.jpg"),
      media_type: "image",
      size: 5,
      mtime: expect.any(Date),
    },
    {
      path: join(tempDir, "song.mp3"),
      media_type: "audio",
      size: 5,
      mtime: expect.any(Date),
    },
  ])
})

test("scanLibrary returns empty array for empty directory", async () => {
  const tempDir = await makeTempDir()

  const entries = await scanLibrary(tempDir)

  expect(entries).toEqual([])
})

import { expect, test } from "bun:test"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { extractFirstAudioClip } from "./analyzeAudioBasic"

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-clip-"))
}

test("extractFirstAudioClip returns null and leaves no temp clips when ffmpeg command is missing", async () => {
  // Given: local audio path and unavailable ffmpeg command
  const tempDir = await makeTempDir()
  const audioPath = join(tempDir, "song.mp3")
  await Bun.write(audioPath, "fake audio")

  // When: clip extraction runs through missing command path
  const result = await extractFirstAudioClip(audioPath, "definitely-missing-ffmpeg")

  // Then: failure is non-crashing and temp directory stays empty except source file
  expect(result).toBeNull()
  expect(await readdir(tempDir)).toEqual(["song.mp3"])
})

import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { detectMediaType, type MediaType } from "./detectMediaType"

export type ScanEntry = {
  readonly path: string
  readonly media_type: MediaType
  readonly size: number
  readonly mtime: Date
}

const SKIPPED_FILES = new Set([".media.json", "media_manifest.jsonl"])

export async function scanLibrary(rootPath: string): Promise<readonly ScanEntry[]> {
  const entries: ScanEntry[] = []
  await collectEntries(rootPath, entries)
  return entries
}

async function collectEntries(directoryPath: string, entries: ScanEntry[]): Promise<void> {
  for (const item of await readdir(directoryPath, { withFileTypes: true })) {
    const itemPath = join(directoryPath, item.name)

    if (item.isDirectory()) {
      if (!item.name.startsWith(".")) {
        await collectEntries(itemPath, entries)
      }
      continue
    }

    if (!item.isFile() || item.name.endsWith(".media.json") || SKIPPED_FILES.has(item.name)) {
      continue
    }

    const mediaType = detectMediaType(item.name)
    if (mediaType === null) {
      continue
    }

    const stats = await Bun.file(itemPath).stat()
    entries.push({ path: itemPath, media_type: mediaType, size: stats.size, mtime: stats.mtime })
  }
}

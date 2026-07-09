import { stat } from "node:fs/promises"

import { Command } from "commander"
import { runTagCommand, type TagCommandOptions } from "./commands/tag"
import { hashFile } from "./common/hashFile"
import { manifestPath } from "./common/paths"
import { type ScanEntry, scanLibrary } from "./common/scanLibrary"
import type { MediaSidecar } from "./common/schema"
import { updateManifestLine } from "./common/writeJsonl"

export type CliMediaSidecar = MediaSidecar

type ScanOptions = {
  readonly dryRun?: boolean
  readonly output?: string
}

const program = new Command()

program.name("media-tagger").description("Tag media files").version("0.1.0")

program
  .command("scan <dir>")
  .description("Scan media files")
  .option("--dry-run", "Print scan plan without writing files")
  .option("--output <path>", "Write manifest to custom path")
  .action(async (dir: string, options: ScanOptions): Promise<void> => {
    await runScanCommand(dir, options)
  })

program
  .command("tag <dir>")
  .description("Tag media files")
  .option("--api", "Enable API tagging")
  .option("--api-key <key>", "API key")
  .option("--api-base-url <url>", "OpenAI-compatible API base URL")
  .option("--api-model <model>", "API model")
  .option("--type <type>", "Media type: image, video, audio, all")
  .option("--sidecar", "Write sidecar files")
  .option("--no-sidecar", "Skip sidecar files")
  .option("--skip-existing", "Skip files with existing sidecars")
  .option("--force", "Overwrite existing sidecars")
  .option("--dry-run", "Print tag plan without writing files")
  .option("--sample-interval <seconds>", "Video frame sample interval")
  .option("--max-frames <count>", "Maximum sampled video frames")
  .option("--output <path>", "Write manifest to custom path")
  .action(async (dir: string, options: TagCommandOptions): Promise<void> => {
    await runTagCommand(dir, options)
  })

await main()

async function main(): Promise<void> {
  // no-excuse-ok: catch
  try {
    await program.parseAsync()
  } catch (error) {
    process.exitCode = 1
    console.error(error instanceof Error ? error.message : "command failed")
  }
}

async function runScanCommand(dir: string, options: ScanOptions): Promise<void> {
  if (!(await isDirectory(dir))) {
    process.exitCode = 1
    console.error(`path not found: ${dir}`)
    return
  }

  const entries = await scanLibrary(dir)
  if (entries.length === 0) {
    process.exitCode = 1
    console.error(`no media found: ${dir}`)
    return
  }

  const manifestFile = options.output ?? manifestPath(dir)

  for (const entry of entries) {
    const assetId = `sha256:${await hashFile(entry.path)}`
    const sidecar = makeSidecar(entry, assetId)

    if (options.dryRun === true) {
      console.log(
        `${sidecar.asset_id} ${sidecar.media_type} ${sidecar.source_file} -> ${manifestFile}`,
      )
      continue
    }

    await updateManifestLine(manifestFile, assetId, sidecar)
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false
    }
    throw error
  }
}

function makeSidecar(entry: ScanEntry, assetId: string): MediaSidecar {
  const now = new Date().toISOString()
  return {
    schema_version: "1.1",
    asset_id: assetId,
    source_file: entry.path,
    media_type: entry.media_type,
    created_at: now,
    updated_at: now,
    technical: {},
    summary: {
      title: "",
      short_caption: "",
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
    tags: {
      core: [],
      visual: [],
      audio: [],
      mood: [],
      style: [],
      editing: [],
      project: [],
    },
    quality: {
      overall_score: 0,
      reuse_score: 0,
    },
    rights: {
      owner: "user",
      source: "local_project_asset",
      license: "unknown",
      notes: "User-provided local media. Confirm rights before publishing.",
    },
    api_usage: {
      provider: "",
      model: "",
      media_uploaded_to_api: false,
    },
    source: { origin: "local_scan" },
  }
}

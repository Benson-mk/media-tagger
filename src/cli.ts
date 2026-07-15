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

program
  .name("media-tagger")
  .description(
    "Scan local media libraries and write tag sidecars (<name>.media.json, schema v1.1) plus a media_manifest.jsonl. Offline by default; --api sends evidence to an OpenAI-compatible VLM/audio endpoint.",
  )
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Examples:
  $ media-tagger scan ./library --dry-run     preview what would be scanned
  $ media-tagger scan ./library               write offline manifest
  $ media-tagger tag ./library                offline tag (empty AI fields)
  $ media-tagger tag ./library --api          VLM tagging (needs MEDIA_TAG_API_KEY)

Environment:
  MEDIA_TAG_API_KEY         API key for --api mode
  MEDIA_TAG_BASE_URL        OpenAI-compatible base URL (default: https://api.openai.com/v1)
  MEDIA_TAG_MODEL           model name (default: gpt-4o-mini)
  MEDIA_TAG_AUDIO_*         audio overrides; fall back to the non-audio variables

Requires ffmpeg/ffprobe on PATH for video/audio; degrades gracefully when absent.

Privacy: whole media files are never uploaded. Video sends sampled JPEG frames
only; audio sends the first 30s as an mp3 clip; and only when --api is set.`,
  )

program
  .command("scan <dir>")
  .description("Recursively scan <dir> for media and upsert entries into media_manifest.jsonl")
  .option("--dry-run", "print scan plan without writing files")
  .option("--output <path>", "write manifest to custom path (default: <dir>/media_manifest.jsonl)")
  .addHelpText(
    "after",
    `
Skips dotdirs, *.media.json sidecars, and the manifest itself.
Asset IDs are sha256:<hex> of file bytes.`,
  )
  .action(async (dir: string, options: ScanOptions): Promise<void> => {
    await runScanCommand(dir, options)
  })

program
  .command("tag <dir>")
  .description(
    "Tag media in <dir>: write <name>.media.json sidecars and update media_manifest.jsonl",
  )
  .option("--api", "enable AI tagging via an OpenAI-compatible API (default: offline)")
  .option("--api-key <key>", "API key (default: $MEDIA_TAG_API_KEY)")
  .option(
    "--api-base-url <url>",
    "API base URL (default: $MEDIA_TAG_BASE_URL or https://api.openai.com/v1)",
  )
  .option("--api-model <model>", "model name (default: $MEDIA_TAG_MODEL or gpt-4o-mini)")
  .option("--type <type>", "only tag one media type: image | video | audio | all", "all")
  .option("--sidecar", "write per-file sidecars (default)")
  .option("--no-sidecar", "manifest only; delete sidecars after tagging")
  .option("--skip-existing", "skip files that already have a sidecar")
  .option("--force", "overwrite existing sidecars (overrides --skip-existing)")
  .option("--dry-run", "print tag plan without writing files")
  .option(
    "--sample-interval <seconds>",
    "seconds between sampled video frames (default: 3, or duration/max-frames)",
  )
  .option("--max-frames <count>", "maximum sampled video frames per video (default: 20)")
  .option("--output <path>", "write manifest to custom path (default: <dir>/media_manifest.jsonl)")
  .addHelpText(
    "after",
    `
Examples:
  $ media-tagger tag ./library --type video --max-frames 10
  $ media-tagger tag ./library --api --skip-existing
  $ media-tagger tag ./library --no-sidecar --output ./out/manifest.jsonl

Video is sampled to JPEG frames via ffmpeg (.media_cache/); audio uses a 30s
mp3 clip. Whole files are never uploaded, even with --api.`,
  )
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

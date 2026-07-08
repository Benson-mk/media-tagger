import { rm, stat } from "node:fs/promises"

import { tagBgm } from "../bgm/tagBgm"
import { hashFile } from "../common/hashFile"
import { manifestPath as defaultManifestPath, sidecarPath } from "../common/paths"
import { type ScanEntry, scanLibrary } from "../common/scanLibrary"
import { tagImage } from "../image/tagImage"
import type { ApiClientConfig } from "../llm/vlmClient"
import { type SampleFramesOptions, sampleFrames } from "../video/sampleFrames"
import { tagVideoFootage } from "../video/tagVideoFootage"

export type TagCommandOptions = {
  readonly api?: boolean
  readonly apiKey?: string
  readonly apiBaseUrl?: string
  readonly apiModel?: string
  readonly type?: string
  readonly sidecar?: boolean
  readonly skipExisting?: boolean
  readonly force?: boolean
  readonly dryRun?: boolean
  readonly sampleInterval?: string
  readonly maxFrames?: string
  readonly output?: string
}

type TagType = "image" | "video" | "audio" | "all"

type ParsedTagOptions = {
  readonly api: ApiClientConfig
  readonly type: TagType
  readonly sidecar: boolean
  readonly skipExisting: boolean
  readonly force: boolean
  readonly dryRun: boolean
  readonly sampleInterval: number | undefined
  readonly maxFrames: number | undefined
  readonly output: string | undefined
}

export class TagCommandError extends Error {
  readonly name = "TagCommandError"
}

export async function runTagCommand(dir: string, options: TagCommandOptions): Promise<void> {
  const parsedOptions = parseOptions(options)
  if (!(await isDirectory(dir))) {
    process.exitCode = 1
    console.error(`path not found: ${dir}`)
    return
  }

  const entries = (await scanLibrary(dir)).filter((entry) => matchesType(entry, parsedOptions.type))
  if (entries.length === 0) {
    process.exitCode = 1
    console.error(`no media found: ${dir}`)
    return
  }

  const manifestFile = parsedOptions.output ?? defaultManifestPath(dir)
  for (const entry of entries) {
    await tagEntry(entry, manifestFile, parsedOptions)
  }
}

function parseOptions(options: TagCommandOptions): ParsedTagOptions {
  return {
    api: apiConfig(options),
    type: parseTagType(options.type),
    sidecar: options.sidecar !== false,
    skipExisting: options.skipExisting === true,
    force: options.force === true,
    dryRun: options.dryRun === true,
    sampleInterval: parsePositiveInteger("sample-interval", options.sampleInterval),
    maxFrames: parsePositiveInteger("max-frames", options.maxFrames),
    output: options.output,
  }
}

function apiConfig(options: TagCommandOptions): ApiClientConfig {
  const config = {
    api: options.api === true,
    base_url: options.apiBaseUrl ?? "https://api.openai.com/v1",
    model: options.apiModel ?? "gpt-4o-mini",
  }
  return options.apiKey === undefined ? config : { ...config, api_key: options.apiKey }
}

function parseTagType(value: string | undefined): TagType {
  switch (value ?? "all") {
    case "image":
      return "image"
    case "video":
      return "video"
    case "audio":
      return "audio"
    case "all":
      return "all"
    default:
      throw new TagCommandError(`invalid type: ${value}`)
  }
}

function parsePositiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  throw new TagCommandError(`invalid ${name}: ${value}`)
}

async function tagEntry(
  entry: ScanEntry,
  manifestFile: string,
  options: ParsedTagOptions,
): Promise<void> {
  const outputPath = sidecarPath(entry.path)
  if (
    options.force !== true &&
    options.skipExisting === true &&
    (await Bun.file(outputPath).exists())
  ) {
    console.log(`skip ${entry.media_type} ${entry.path} -> ${outputPath}`)
    return
  }

  if (options.dryRun === true) {
    const assetId = `sha256:${await hashFile(entry.path)}`
    console.log(`${assetId} ${entry.media_type} ${entry.path} -> ${manifestFile}`)
    return
  }

  switch (entry.media_type) {
    case "image":
      await tagImage({ ...options.api, path: entry.path, manifestPath: manifestFile })
      break
    case "video":
      await tagVideoFootage({
        videoPath: entry.path,
        assetId: `sha256:${await hashFile(entry.path)}`,
        manifestPath: manifestFile,
        api: options.api,
        dependencies: {
          sample: async (path) => await sampleFrames(path, sampleOptions(options)),
        },
      })
      break
    case "audio":
      await tagBgm({ ...options.api, mediaPath: entry.path, manifestFile })
      break
    default:
      assertNever(entry.media_type)
  }

  if (options.sidecar !== true) {
    await rm(outputPath, { force: true })
  }
  console.log(`written ${entry.media_type} ${entry.path} -> ${manifestFile}`)
}

function sampleOptions(options: ParsedTagOptions): SampleFramesOptions {
  const intervalSeconds = options.sampleInterval
  const maxFrames = options.maxFrames

  if (intervalSeconds !== undefined && maxFrames !== undefined) {
    return { intervalSeconds, maxFrames }
  }

  if (intervalSeconds !== undefined) {
    return { intervalSeconds }
  }

  if (maxFrames !== undefined) {
    return { maxFrames }
  }

  return {}
}

function matchesType(entry: ScanEntry, type: TagType): boolean {
  switch (type) {
    case "all":
      return true
    case "image":
      return entry.media_type === "image"
    case "video":
      return entry.media_type === "video"
    case "audio":
      return entry.media_type === "audio"
    default:
      return assertNever(type)
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

function assertNever(value: never): never {
  throw new TagCommandError(`unhandled value: ${value}`)
}

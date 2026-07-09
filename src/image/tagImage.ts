import { Buffer } from "node:buffer"
import { extname } from "node:path"
import { ZodError, z } from "zod"

import { hashFile } from "../common/hashFile"
import { sidecarPath } from "../common/paths"
import type { MediaSidecar } from "../common/schema"
import { MediaSidecarSchema } from "../common/schema"
import { writeSidecar } from "../common/writeJson"
import { updateManifestLine } from "../common/writeJsonl"
import type { ApiClientConfig } from "../llm/vlmClient"
import { analyzeImage } from "../llm/vlmClient"
import { probeImage } from "../metadata/probeImage"
import { buildImagePrompt } from "./buildImagePrompt"

const StringListSchema = z.array(z.string())

const ImageTagResponseSchema = z.object({
  title: z.string(),
  short_caption: z.string(),
  detailed_caption: z.string(),
  best_use: StringListSchema,
  not_recommended_for: StringListSchema,
  tags: z.object({
    core: StringListSchema,
    visual: StringListSchema,
    audio: StringListSchema,
    mood: StringListSchema,
    style: StringListSchema,
    editing: StringListSchema,
    project: StringListSchema,
  }),
  quality: z.object({ overall_score: z.number(), reuse_score: z.number() }),
  image: z.object({
    composition: z.object({
      shot_type: z.string(),
      main_subject: z.string(),
      background: z.string(),
      text_space: z.string(),
      usable_crops: StringListSchema,
    }),
    detected_text: StringListSchema,
    thumbnail_usefulness: z.string(),
  }),
})

type ImageTagResponse = z.infer<typeof ImageTagResponseSchema>
type ImageTechnical = Readonly<Record<string, string | number | null>>
type AvailableImageTechnical = {
  readonly width: number
  readonly height: number
  readonly orientation: number | null
  readonly aspect_ratio: string
}
type SidecarInput = {
  readonly options: TagImageOptions
  readonly assetId: string
  readonly technical: ImageTechnical
  readonly apiResponse: ImageTagResponse | null
}

export class TagImageResponseError extends Error {
  readonly name = "TagImageResponseError"

  constructor(readonly issues: readonly string[]) {
    super("image tag response did not match schema")
  }
}

export type TagImageOptions = ApiClientConfig & {
  readonly path: string
  readonly manifestPath: string
  readonly dryRun?: boolean
}

export type TagImageResult =
  | {
      readonly kind: "plan"
      readonly path: string
      readonly sidecarPath: string
      readonly manifestPath: string
      readonly asset_id: string
    }
  | {
      readonly kind: "written"
      readonly path: string
      readonly sidecarPath: string
      readonly manifestPath: string
      readonly asset_id: string
    }

export async function tagImage(options: TagImageOptions): Promise<TagImageResult> {
  const assetId = `sha256:${await hashFile(options.path)}`
  const outputPath = sidecarPath(options.path)

  if (options.dryRun === true) {
    return {
      kind: "plan",
      path: options.path,
      sidecarPath: outputPath,
      manifestPath: options.manifestPath,
      asset_id: assetId,
    }
  }

  const probe = await probeImage(options.path)
  const technical: ImageTechnical = probe.available
    ? ({
        width: probe.width,
        height: probe.height,
        orientation: probe.orientation,
        aspect_ratio: probe.aspect_ratio,
      } satisfies AvailableImageTechnical)
    : { probe_error: probe.error }
  const apiResponse = probe.available
    ? await requestImageTags(options, {
        width: probe.width,
        height: probe.height,
        orientation: probe.orientation,
        aspect_ratio: probe.aspect_ratio,
      })
    : null
  const sidecar = MediaSidecarSchema.parse(
    makeSidecar({ options, assetId, technical, apiResponse }),
  )

  await writeSidecar(options.path, sidecar)
  await updateManifestLine(options.manifestPath, sidecar.asset_id, sidecar)

  return {
    kind: "written",
    path: options.path,
    sidecarPath: outputPath,
    manifestPath: options.manifestPath,
    asset_id: assetId,
  }
}

async function requestImageTags(
  options: TagImageOptions,
  technical: AvailableImageTechnical,
): Promise<ImageTagResponse | null> {
  try {
    return await analyzeImage({
      ...options,
      image: { kind: "data_url", data_url: await imageDataUrl(options.path) },
      prompt: buildImagePrompt(technical),
      schema: ImageTagResponseSchema,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      throw new TagImageResponseError(error.issues.map((issue) => issue.path.join(".")))
    }
    throw error
  }
}

async function imageDataUrl(path: string): Promise<string> {
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer())
  return `data:${imageMimeType(path)};base64,${bytes.toString("base64")}`
}

function imageMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".avif":
      return "image/avif"
    case ".tiff":
      return "image/tiff"
    case ".bmp":
      return "image/bmp"
    default:
      return "application/octet-stream"
  }
}

function makeSidecar(input: SidecarInput): MediaSidecar {
  const now = new Date().toISOString()
  return {
    schema_version: "1.1",
    asset_id: input.assetId,
    source_file: input.options.path,
    media_type: "image",
    created_at: now,
    updated_at: now,
    technical: input.technical,
    summary: input.apiResponse === null ? emptySummary() : responseSummary(input.apiResponse),
    tags: input.apiResponse === null ? emptyTags() : input.apiResponse.tags,
    quality:
      input.apiResponse === null ? { overall_score: 0, reuse_score: 0 } : input.apiResponse.quality,
    rights: {
      owner: "user",
      source: "local_project_asset",
      license: "unknown",
      notes: "User-provided local media. Confirm rights before publishing.",
    },
    api_usage: {
      provider: input.apiResponse === null ? "" : "openai_compatible",
      model: input.apiResponse === null ? "" : input.options.model,
      media_uploaded_to_api: input.apiResponse !== null,
    },
    image: input.apiResponse?.image,
    internal: { origin: "local_scan" },
  }
}

function emptySummary(): MediaSidecar["summary"] {
  return {
    title: "",
    short_caption: "",
    detailed_caption: "",
    best_use: [],
    not_recommended_for: [],
  }
}

function responseSummary(response: ImageTagResponse): MediaSidecar["summary"] {
  return {
    title: response.title,
    short_caption: response.short_caption,
    detailed_caption: response.detailed_caption,
    best_use: response.best_use,
    not_recommended_for: response.not_recommended_for,
  }
}

function emptyTags(): MediaSidecar["tags"] {
  return { core: [], visual: [], audio: [], mood: [], style: [], editing: [], project: [] }
}

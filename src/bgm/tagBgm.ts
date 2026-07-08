import { z } from "zod"

import { hashFile } from "../common/hashFile"
import { logger } from "../common/logger"
import { BgmMetaSchema, type MediaSidecar } from "../common/schema"
import { writeSidecar } from "../common/writeJson"
import { updateManifestLine } from "../common/writeJsonl"
import { type AudioInput, analyzeAudio } from "../llm/audioClient"
import type { ApiClientConfig } from "../llm/vlmClient"
import { type AudioProbeResult, probeAudio as defaultProbeAudio } from "../metadata/probeAudio"
import { type ClipExtractionResult, extractFirstAudioClip } from "./analyzeAudioBasic"
import { buildBgmPrompt } from "./buildBgmPrompt"

const BgmApiResponseSchema = BgmMetaSchema.extend({ tags: z.array(z.string()) })

type BgmApiResponse = z.infer<typeof BgmApiResponseSchema>

type BgmTaggingOptions = ApiClientConfig & {
  readonly mediaPath: string
  readonly manifestFile: string
  readonly probeAudio?: (mediaPath: string) => Promise<AudioProbeResult>
  readonly extractClip?: (mediaPath: string) => Promise<ClipExtractionResult | null>
}

type SidecarParts = {
  readonly mediaPath: string
  readonly assetId: string
  readonly now: string
  readonly technical: MediaSidecar["technical"]
  readonly apiResult: BgmApiResponse | null
  readonly apiConfig: ApiClientConfig
}

export async function tagBgm(options: BgmTaggingOptions): Promise<MediaSidecar> {
  const probe = await (options.probeAudio ?? defaultProbeAudio)(options.mediaPath)
  const assetId = `sha256:${await hashFile(options.mediaPath)}`
  const now = new Date().toISOString()

  if (!probe.available) {
    logger.warn("BGM probe unavailable", { path: options.mediaPath, error: probe.error })
    const sidecar = makeSidecar({
      mediaPath: options.mediaPath,
      assetId,
      now,
      technical: {},
      apiResult: null,
      apiConfig: options,
    })
    await writeOutputs(options, assetId, sidecar)
    return sidecar
  }

  const technical = audioTechnical(probe)
  if (options.api !== true) {
    const sidecar = makeSidecar({
      mediaPath: options.mediaPath,
      assetId,
      now,
      technical,
      apiResult: null,
      apiConfig: options,
    })
    await writeOutputs(options, assetId, sidecar)
    return sidecar
  }

  const audio = await (options.extractClip ?? extractFirstAudioClip)(options.mediaPath)
  if (audio === null) {
    const sidecar = makeSidecar({
      mediaPath: options.mediaPath,
      assetId,
      now,
      technical,
      apiResult: null,
      apiConfig: options,
    })
    await writeOutputs(options, assetId, sidecar)
    return sidecar
  }

  const apiResult = await analyzeBgmAudio(options, audio, probe)
  const sidecar = makeSidecar({
    mediaPath: options.mediaPath,
    assetId,
    now,
    technical,
    apiResult,
    apiConfig: options,
  })
  await writeOutputs(options, assetId, sidecar)
  return sidecar
}

async function analyzeBgmAudio(
  config: ApiClientConfig,
  audio: AudioInput,
  probe: Extract<AudioProbeResult, { readonly available: true }>,
): Promise<BgmApiResponse | null> {
  return await analyzeAudio({
    ...config,
    audio,
    prompt: buildBgmPrompt(probe),
    schema: BgmApiResponseSchema,
  })
}

function audioTechnical(probe: Extract<AudioProbeResult, { readonly available: true }>) {
  return {
    duration: probe.duration,
    codec: probe.codec,
    sample_rate: probe.sample_rate,
    channels: probe.channels,
    bitrate: probe.bitrate,
  }
}

function makeSidecar(parts: SidecarParts): MediaSidecar {
  const bgm = parts.apiResult === null ? undefined : BgmMetaSchema.parse(parts.apiResult)
  return {
    schema_version: "1.0",
    asset_id: parts.assetId,
    source_file: parts.mediaPath,
    media_type: "audio",
    created_at: parts.now,
    updated_at: parts.now,
    technical: parts.technical,
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
      audio: parts.apiResult === null ? [] : [...parts.apiResult.genre, ...parts.apiResult.tags],
      mood: parts.apiResult?.mood ?? [],
      style: [],
      editing: parts.apiResult?.editing_use ?? [],
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
      provider: parts.apiResult === null ? "" : parts.apiConfig.base_url,
      model: parts.apiResult === null ? "" : parts.apiConfig.model,
      media_uploaded_to_api: parts.apiResult !== null,
    },
    bgm,
  }
}

async function writeOutputs(
  options: Pick<BgmTaggingOptions, "mediaPath" | "manifestFile">,
  assetId: string,
  sidecar: MediaSidecar,
): Promise<void> {
  await writeSidecar(options.mediaPath, sidecar)
  await updateManifestLine(options.manifestFile, assetId, sidecar)
}

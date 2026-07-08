import { logger } from "../common/logger"
import { manifestPath as defaultManifestPath } from "../common/paths"
import type { MediaSidecar } from "../common/schema"
import { writeSidecar } from "../common/writeJson"
import { updateManifestLine } from "../common/writeJsonl"
import type { ApiClientConfig, ChatContentPart } from "../llm/vlmClient"
import { requestStructuredChatCompletion } from "../llm/vlmClient"
import { probeVideo, type VideoProbeResult } from "../metadata/probeVideo"
import {
  buildVideoPrompt,
  type VideoTaggingResponse,
  VideoTaggingResponseSchema,
} from "./buildVideoPrompt"
import { type SampledFrame, type SampleFramesOptions, sampleFrames } from "./sampleFrames"

type VideoTaggingDependencies = {
  readonly probe?: (path: string) => Promise<VideoProbeResult>
  readonly sample?: (
    path: string,
    options?: SampleFramesOptions,
  ) => Promise<readonly SampledFrame[]>
}

export type TagVideoFootageOptions = {
  readonly videoPath: string
  readonly assetId: string
  readonly manifestPath?: string
  readonly api: ApiClientConfig
  readonly now?: () => Date
  readonly dependencies?: VideoTaggingDependencies
}

export async function tagVideoFootage(options: TagVideoFootageOptions): Promise<MediaSidecar> {
  const now = (options.now ?? (() => new Date()))().toISOString()
  const probe = options.dependencies?.probe ?? probeVideo
  const sample = options.dependencies?.sample ?? sampleFrames
  const probeResult = await probe(options.videoPath)

  if (options.api.api !== true) {
    const sidecar = baseSidecar(options, now, technicalMetadata(probeResult), false)
    await writeOutputs(options, sidecar)
    return sidecar
  }

  const duration = probeResult.available ? probeResult.duration : null
  const frames = await sample(
    options.videoPath,
    duration !== null && duration !== undefined ? { durationSeconds: duration } : {},
  )
  if (frames.length === 0) {
    logger.warn("video frame sampling produced no frames", { path: options.videoPath })
    const sidecar = baseSidecar(options, now, technicalMetadata(probeResult), false)
    await writeOutputs(options, sidecar)
    return sidecar
  }

  const response = await requestStructuredChatCompletion(
    { ...options.api, schema: VideoTaggingResponseSchema },
    [{ type: "text", text: buildVideoPrompt({ frames }) }, ...(await frameContentParts(frames))],
  )
  const sidecar = responseToSidecar(options, now, technicalMetadata(probeResult), frames, response)
  await writeOutputs(options, sidecar)
  return sidecar
}

async function frameContentParts(
  frames: readonly SampledFrame[],
): Promise<readonly ChatContentPart[]> {
  return await Promise.all(
    frames.map(async (frame) => ({
      type: "image_url",
      image_url: { url: await frameDataUrl(frame.path) },
    })),
  )
}

async function frameDataUrl(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer()
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`
}

function responseToSidecar(
  options: TagVideoFootageOptions,
  now: string,
  technical: MediaSidecar["technical"],
  frames: readonly SampledFrame[],
  response: VideoTaggingResponse | null,
): MediaSidecar {
  const base = baseSidecar(options, now, technical, response !== null)
  if (response === null) {
    return base
  }

  return {
    ...base,
    summary: response.summary,
    tags: response.overall_tags,
    quality: response.quality,
    video: {
      sampling: {
        interval_seconds: samplingInterval(frames),
        frames: frames.map((frame) => ({ time_seconds: frame.time, path: frame.path })),
      },
      segments: response.segments,
    },
  }
}

function samplingInterval(frames: readonly SampledFrame[]): number {
  const first = frames[0]
  const second = frames[1]
  return first !== undefined && second !== undefined ? second.time - first.time : 0
}

function technicalMetadata(result: VideoProbeResult): MediaSidecar["technical"] {
  if (result.available) {
    return {
      duration: result.duration,
      width: result.width,
      height: result.height,
      fps: result.fps,
      codec: result.codec,
      has_audio: result.has_audio,
    }
  }

  return { probe_error: result.error }
}

function baseSidecar(
  options: TagVideoFootageOptions,
  now: string,
  technical: MediaSidecar["technical"],
  mediaUploadedToApi: boolean,
): MediaSidecar {
  return {
    schema_version: "1.0",
    asset_id: options.assetId,
    source_file: options.videoPath,
    media_type: "video",
    created_at: now,
    updated_at: now,
    technical,
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
      provider: mediaUploadedToApi ? "openai-compatible" : "",
      model: mediaUploadedToApi ? options.api.model : "",
      media_uploaded_to_api: mediaUploadedToApi,
    },
  }
}

async function writeOutputs(options: TagVideoFootageOptions, sidecar: MediaSidecar): Promise<void> {
  await writeSidecar(options.videoPath, sidecar)
  await updateManifestLine(
    options.manifestPath ?? defaultManifestPath(options.videoPath),
    options.assetId,
    sidecar,
  )
}

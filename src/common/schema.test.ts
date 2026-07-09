import { expect, test } from "bun:test"
import { ZodError } from "zod"

import { BgmMetaSchema, ImageMetaSchema, MediaSidecarSchema, VideoMetaSchema } from "./schema"

function baseSidecar() {
  return {
    asset_id: "asset-123",
    source_file: "media/example.jpg",
    media_type: "image",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    technical: { width: 1920, height: 1080 },
    summary: {
      title: "Example",
      short_caption: "Example media sidecar",
      detailed_caption: "Example media sidecar with reusable visuals",
      best_use: ["hero"],
      not_recommended_for: [],
    },
    tags: {
      core: ["hero"],
      visual: ["bright"],
      audio: [],
      mood: ["calm"],
      style: ["clean"],
      editing: [],
      project: ["demo"],
    },
    quality: { overall_score: 80, reuse_score: 70 },
    rights: { owner: "team", source: "internal", license: "proprietary", notes: "" },
    api_usage: { provider: "openai", model: "gpt-4.1", media_uploaded_to_api: false },
  }
}

test("MediaSidecarSchema defaults schema_version when valid sidecar omits it", () => {
  // Given: valid sidecar fixture without schema_version
  const value = MediaSidecarSchema.parse({
    asset_id: "asset-123",
    source_file: "media/example.jpg",
    media_type: "image",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:00.000Z",
    technical: {
      width: 1920,
      height: 1080,
    },
    summary: {
      title: "Example",
      short_caption: "Example media sidecar",
      detailed_caption: "Example media sidecar with reusable visuals",
      best_use: ["hero"],
      not_recommended_for: [],
    },
    tags: {
      core: ["hero"],
      visual: ["bright"],
      audio: [],
      mood: ["calm"],
      style: ["clean"],
      editing: [],
      project: ["demo"],
    },
    quality: {
      overall_score: 80,
      reuse_score: 70,
    },
    rights: {
      owner: "team",
      source: "internal",
      license: "proprietary",
      notes: "",
    },
    api_usage: {
      provider: "openai",
      model: "gpt-4.1",
      media_uploaded_to_api: false,
    },
  })

  // Then: parser supplies current schema version
  expect(value.schema_version).toBe("1.1")
})

test("MediaSidecarSchema still parses v1.0 sidecars for backward compat", () => {
  const value = MediaSidecarSchema.parse({ ...baseSidecar(), schema_version: "1.0" })
  expect(value.schema_version).toBe("1.0")
})

test("MediaSidecarSchema round-trips a v1.1 sidecar with external source block", () => {
  const source = {
    origin: "external",
    provider: "pexels",
    source_id: "12345",
    source_url: "https://pexels.com/photo/12345",
    download_url: "https://images.pexels.com/12345.jpg",
    creator: { name: "Jane Doe", profile_url: "https://pexels.com/@jane" },
    license: "Pexels License",
    license_url: "https://pexels.com/license",
    credits: { required: false, text: "Photo by Jane Doe" },
    raw_metadata_path: ".media_raw/pexels-12345.json",
  }
  const value = MediaSidecarSchema.parse({
    ...baseSidecar(),
    schema_version: "1.1",
    source,
  })
  expect(value.source).toEqual(source)
  expect(value.source?.origin).toBe("external")
})

test("MediaSidecarSchema parses local_scan source block with only origin", () => {
  const value = MediaSidecarSchema.parse({
    ...baseSidecar(),
    schema_version: "1.1",
    source: { origin: "local_scan" },
  })
  expect(value.source?.origin).toBe("local_scan")
  expect(value.source?.provider).toBeUndefined()
})

test("MediaSidecarSchema rejects source block without origin", () => {
  expect(() =>
    MediaSidecarSchema.parse({
      ...baseSidecar(),
      schema_version: "1.1",
      source: { provider: "pexels" },
    }),
  ).toThrow()
})

test("MediaSidecarSchema rejects an unknown schema_version", () => {
  const parseBadVersion = (): void => {
    MediaSidecarSchema.parse({ ...baseSidecar(), schema_version: "2.0" })
  }
  expect(parseBadVersion).toThrow(ZodError)
})

test("MediaSidecarSchema throws ZodError when media_type is missing", () => {
  // Given: sidecar missing required media_type
  const parseMissingMediaType = (): void => {
    MediaSidecarSchema.parse({
      asset_id: "asset-123",
      source_file: "media/example.jpg",
      created_at: "2026-07-07T00:00:00.000Z",
      updated_at: "2026-07-07T00:00:00.000Z",
      technical: {},
      summary: {
        title: "Example",
        short_caption: "Example media sidecar",
        detailed_caption: "Example media sidecar with reusable visuals",
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
        overall_score: 80,
        reuse_score: 70,
      },
      rights: {
        owner: "team",
        source: "internal",
        license: "proprietary",
        notes: "",
      },
      api_usage: {
        provider: "openai",
        model: "gpt-4.1",
        media_uploaded_to_api: false,
      },
    })
  }

  // Then: Zod reports boundary parse failure
  expect(parseMissingMediaType).toThrow(ZodError)
})

test("type-specific metadata schemas parse plan fields", () => {
  // Given: valid image, video, and bgm metadata fixtures
  const image = ImageMetaSchema.parse({
    composition: {
      shot_type: "wide",
      main_subject: "workspace",
      background: "studio",
      text_space: "left",
      usable_crops: ["16:9"],
    },
    detected_text: ["MEDIA"],
    thumbnail_usefulness: "high",
  })
  const video = VideoMetaSchema.parse({
    sampling: {
      interval_seconds: 3,
      frames: [{ time_seconds: 0, path: ".media_cache/example/frame_001.jpg" }],
    },
    segments: [
      {
        start_seconds: 0,
        end_seconds: 3,
        caption: "Opening shot",
        tags: ["intro"],
        shot_type: "wide",
        camera_motion: "static",
        motion_level: "low",
        recommended_use: ["intro"],
        quality_score: 80,
      },
    ],
  })
  const bgm = BgmMetaSchema.parse({
    music_type: "instrumental",
    genre: ["ambient"],
    mood: ["calm"],
    energy: "low",
    tempo: { bpm: 90, confidence: 0.8 },
    key: { value: "C", confidence: 0.6 },
    structure: { has_intro: true, has_outro: true, loopable: false },
    voiceover: { vocal_presence: "none", safe_for_voiceover: true },
    editing_use: ["background"],
    avoid_use: [],
  })

  // Then: plan fields survive parsing
  expect(image.composition.shot_type).toBe("wide")
  expect(video.sampling.interval_seconds).toBe(3)
  expect(bgm.voiceover.safe_for_voiceover).toBe(true)
})

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

test("MediaSidecarSchema preserves Pixabay API, bootstrap, and normalized provider metadata", () => {
  const api = {
    id: 10359152,
    pageURL: "https://pixabay.com/photos/lake-swan-mountains-winter-nature-10359152/",
    type: "photo",
    tags: "lake, swan, mountains",
    previewURL: "https://cdn.pixabay.com/photo/preview.jpg",
    previewWidth: 150,
    previewHeight: 100,
    webformatURL: "https://pixabay.com/get/webformat.jpg",
    webformatWidth: 640,
    webformatHeight: 427,
    largeImageURL: "https://pixabay.com/get/large.jpg",
    imageWidth: 9504,
    imageHeight: 6336,
    imageSize: 24801427,
    views: 1200,
    downloads: 400,
    collections: 18,
    likes: 72,
    comments: 9,
    user_id: 5678,
    user: "photographer",
    userImageURL: "https://cdn.pixabay.com/user/avatar.jpg",
    noAiTraining: false,
    isAiGenerated: false,
    isGRated: true,
    isLowQuality: false,
    userURL: "https://pixabay.com/users/photographer-5678/",
    name: "Lake Swan Mountains Winter Nature",
  }
  const bootstrap = {
    id: 10359152,
    mediaType: "photo",
    mediaSubType: "photo",
    mediaDescriptiveType: "Photograph",
    name: "Lake Swan Mountains Winter Nature",
    title: "Lake swan mountains winter nature",
    description: "A swan crossing an alpine lake in winter.",
    alt: "White swan on a mountain lake",
    href: "/photos/lake-swan-mountains-winter-nature-10359152/",
    width: 9504,
    height: 6336,
    cameraName: "Sony Ilce-7rm3",
    lens: "E 70-180mm F2.8 A056",
    aperture: "8.0",
    exposureTime: "1/320",
    focalLength: "82.0",
    iso: "100",
    flash: false,
    uploadDate: "2026-07-02T10:12:00.000Z",
    publishedDate: "2026-07-02T10:12:00.000Z",
    isEditorsChoice: true,
    nsfw: false,
    qualityStatus: "accepted",
    fileFormat: "jpg",
    vector: false,
    isAiGenerated: false,
    isLowQuality: false,
    isVideoReady: false,
    statusName: "accepted",
    translated: false,
    lang: "en",
    primaryTag: "lake",
    tags: "lake, swan, mountains",
    tagList: ["lake", "swan", "mountains"],
    tagLinks: [{ name: "lake", href: "/images/search/lake/" }],
    unreviewedTags: [],
    genres: ["nature"],
    moods: ["peaceful"],
    movements: [],
    themes: ["winter"],
    sources: { large: "https://cdn.pixabay.com/photo/large.jpg" },
    downloadSources: [
      { label: "1920x1280", url: "https://pixabay.com/get/1920.jpg", size: 681223 },
    ],
    user: {
      id: 5678,
      username: "photographer",
      fullName: "Example Photographer",
      profileUrl: "https://pixabay.com/users/photographer-5678/",
      followerCount: 321,
    },
    attributionHtml:
      '<a href="https://pixabay.com/users/photographer-5678/">Example Photographer</a>',
    viewCount: 1190,
    downloadCount: 397,
    collectionCount: 18,
    likeCount: 70,
    commentCount: 9,
    likeHref: "/accounts/login/",
    commentHref: "#comments",
    canvaId: null,
    canvaRetouchUrl: null,
    competitionWins: [],
    contentIdCertificateUrl: null,
  }
  const providerMetadata = {
    media_subtype: "photo",
    flags: {
      no_ai_training: false,
      is_ai_generated: false,
      is_g_rated: true,
      is_low_quality: false,
      editors_choice: true,
      nsfw: false,
    },
    engagement: { views: 1200, downloads: 400, collections: 18, likes: 72, comments: 9 },
    contributor: {
      id: 5678,
      username: "photographer",
      avatar_url: "https://cdn.pixabay.com/user/avatar.jpg",
      profile_url: "https://pixabay.com/users/photographer-5678/",
    },
    original: { width: 9504, height: 6336, size: 24801427 },
    upload_date: "2026-07-02T10:12:00.000Z",
    published_date: "2026-07-02T10:12:00.000Z",
    file_format: "jpg",
    vector: false,
  }
  const source = {
    origin: "external",
    provider: "pixabay",
    source_id: "10359152",
    source_url: api.pageURL,
    download_url: api.largeImageURL,
    raw: { api, json_ld: null, bootstrap },
    provider_metadata: providerMetadata,
    exif: {
      Model: "Sony Ilce-7rm3",
      Lens: "E 70-180mm F2.8 A056",
      FNumber: 8,
      ExposureTime: "1/320",
      FocalLength: 82,
      ISO: 100,
      Flash: false,
    },
  }

  const value = MediaSidecarSchema.parse({
    ...baseSidecar(),
    schema_version: "1.1",
    source,
  })

  expect(value.source).toEqual(source)
  expect(value.source?.raw?.api).toEqual(api)
  expect(value.source?.raw?.bootstrap).toEqual(bootstrap)
  expect(value.source?.provider_metadata).toEqual(providerMetadata)
  expect(value.source?.exif?.["Flash"]).toBe(false)
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

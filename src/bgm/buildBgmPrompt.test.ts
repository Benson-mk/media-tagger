import { expect, test } from "bun:test"

import { buildBgmPrompt } from "./buildBgmPrompt"

test("buildBgmPrompt requests structured BGM fields when given technical metadata", () => {
  // Given: basic audio technical metadata
  const prompt = buildBgmPrompt({
    available: true,
    duration: 30,
    codec: "mp3",
    sample_rate: 44_100,
    channels: 2,
    bitrate: 128_000,
  })

  // When: prompt is checked for required response contract
  const requiredFields = [
    "music_type",
    "vocal_presence",
    "genre",
    "mood",
    "energy",
    "structure",
    "voiceover safety",
    "editing_use",
    "avoid_use",
    "tags",
  ]

  // Then: prompt asks model for every required BGM tag field
  for (const field of requiredFields) {
    expect(prompt).toContain(field)
  }
  expect(prompt).not.toContain('"bpm"')
  expect(prompt).not.toContain('"key"')
  expect(prompt).toContain('"safe_for_voiceover": boolean')
  expect(prompt).toContain("Use best estimates; do not return null")
})

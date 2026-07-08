import { expect, test } from "bun:test"

import { buildVideoPrompt } from "./buildVideoPrompt"

test("buildVideoPrompt requests structured video captions and includes sampled timestamps", () => {
  // Given: sampled frame timestamps from a clip
  const prompt = buildVideoPrompt({
    frames: [
      { time: 0, path: "frame_001.jpg" },
      { time: 3, path: "frame_002.jpg" },
      { time: 6, path: "frame_003.jpg" },
    ],
  })

  // Then: prompt asks for whole-video and segment-level reusable metadata
  expect(prompt).toContain("whole_video_caption")
  expect(prompt).toContain("segments")
  expect(prompt).toContain("shot_type")
  expect(prompt).toContain("camera_motion")
  expect(prompt).toContain("motion_level")
  expect(prompt).toContain("recommended_use")
  expect(prompt).toContain("quality_score")
  expect(prompt).toContain("overall_tags")
  expect(prompt).toContain("0s, 3s, 6s")
})

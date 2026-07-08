import { expect, test } from "bun:test"
import { z } from "zod"

import { analyzeAudio } from "./audioClient"

const AudioResultSchema = z.object({
  transcript: z.string(),
  mood: z.string(),
})

test("analyzeAudio returns parsed structured object and sends audio data payload", async () => {
  // Given: local OpenAI-compatible mock server
  const requests: unknown[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(await request.json())
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ transcript: "hello", mood: "calm" }) } }],
      })
    },
  })

  try {
    // When: audio analysis runs with base64 data URL
    const result = await analyzeAudio({
      api: true,
      base_url: server.url.href,
      model: "audio-test",
      api_key: "test-key",
      audio: { kind: "data_url", data_url: "data:audio/mpeg;base64,AAAA" },
      prompt: "transcribe and analyze",
      schema: AudioResultSchema,
    })

    // Then: caller schema parsed result and audio payload uses chat completions shape
    expect(result).toEqual({ transcript: "hello", mood: "calm" })
    expect(requests).toEqual([
      {
        model: "audio-test",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "transcribe and analyze" },
              { type: "input_audio", input_audio: { data_url: "data:audio/mpeg;base64,AAAA" } },
            ],
          },
        ],
      },
    ])
  } finally {
    server.stop(true)
  }
})

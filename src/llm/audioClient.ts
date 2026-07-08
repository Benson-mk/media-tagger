import type { z } from "zod"

import { type ApiClientConfig, requestStructuredChatCompletion } from "./vlmClient"

export type AudioInput =
  | { readonly kind: "data_url"; readonly data_url: string }
  | { readonly kind: "url"; readonly url: string }

export type AudioAnalysisOptions<T> = ApiClientConfig & {
  readonly audio: AudioInput
  readonly prompt: string
  readonly schema: z.ZodType<T>
}

export async function analyzeAudio<T>(options: AudioAnalysisOptions<T>): Promise<T | null> {
  const dataUrl = options.audio.kind === "data_url" ? options.audio.data_url : options.audio.url
  return await requestStructuredChatCompletion(options, [
    { type: "text", text: options.prompt },
    { type: "input_audio", input_audio: { data_url: dataUrl } },
  ])
}

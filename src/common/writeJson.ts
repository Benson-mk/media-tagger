import { rename, writeFile } from "node:fs/promises"

import { sidecarPath } from "./paths"

export type JsonRecord = Record<string, unknown>

type ProvenanceFields = {
  readonly source?: { readonly origin?: unknown }
  readonly rights?: unknown
}

export async function writeJson(filePath: string, value: JsonRecord): Promise<void> {
  const tempPath = `${filePath}.tmp-${crypto.randomUUID()}`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(tempPath, filePath)
}

export async function writeSidecar(mediaPath: string, value: JsonRecord): Promise<void> {
  const filePath = sidecarPath(mediaPath)
  await writeJson(filePath, await preserveProvenance(filePath, value))
}

// Re-tag must not drop ingester provenance: carry existing external source + rights forward.
async function preserveProvenance(filePath: string, value: JsonRecord): Promise<JsonRecord> {
  const existing = await readExistingSidecar(filePath)
  if (existing === null || existing.source?.origin !== "external") {
    return value
  }
  return { ...value, source: existing.source, rights: existing.rights }
}

async function readExistingSidecar(filePath: string): Promise<ProvenanceFields | null> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(await file.text())
    return typeof parsed === "object" && parsed !== null ? (parsed as ProvenanceFields) : null
  } catch {
    return null
  }
}

import { expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { extractExif } from "../extractExif"

const EXIF_JPEG_FIXTURE = new URL("../../../media/3A9B7654.jpeg", import.meta.url).pathname

test("extractExif returns full EXIF fields for jpeg with EXIF", async () => {
  // Given: a real jpeg fixture containing EXIF
  // When: EXIF is extracted
  const exif = await extractExif(EXIF_JPEG_FIXTURE)

  // Then: all JSON-safe ifd0 + exif fields are returned
  expect(exif).not.toBeNull()
  expect(exif?.["Make"]).toBe("Canon")
  expect(exif?.["Model"]).toBe("Canon EOS 5D Mark III")
  expect(exif?.["ISO"]).toBe(800)
  expect(exif?.["LensModel"]).toBe("70-300mm")
  expect(exif?.["ExposureProgram"]).toBe("Aperture priority")
  expect(exif?.["Flash"]).toBe("Flash did not fire, compulsory flash mode")
  expect(exif?.["WhiteBalance"]).toBe("Auto")
  expect(exif?.["MeteringMode"]).toBe("Partial")
  expect(exif?.["ExifImageWidth"]).toBe(5760)
  expect(exif?.["ExifImageHeight"]).toBe(3840)
  expect(exif?.["FocalLength"]).toBe(192)
  expect(exif?.["FNumber"]).toBeCloseTo(6.3, 1)
  expect(exif?.["ExposureTime"]).toBe(0.005)
  expect(exif?.["ShutterSpeedValue"]).toBe(7.625)
  expect(exif?.["ApertureValue"]).toBe(5.375)
  expect(exif?.["Orientation"]).toBe("Horizontal (normal)")
  expect(exif?.["LensInfo"]).toBe("70, 300, 0, 0")
  expect(exif?.["Lens"]).toBe("Tamron AF 70-300mm f/4-5.6 Di LD 1:2 Macro")
  expect(exif?.["SerialNumber"]).toBe("028021014149")
  // EXIF stores naive local time; exifr revives it in the system timezone,
  // so assert the ISO shape rather than an exact instant.
  expect(String(exif?.["DateTimeOriginal"])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  // Binary blobs (ComponentsConfiguration) must not leak into the record
  expect(exif?.["ComponentsConfiguration"]).toBeUndefined()
})

test("extractExif returns null for image without EXIF", async () => {
  // Given: a tiny png without EXIF
  const tempDir = await mkdtemp(join(tmpdir(), "media-tagger-exif-"))
  const pngPath = join(tempDir, "tiny.png")
  await writeFile(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAD9fD44AAAADUlEQVR42mP8z8BQDwAFgwJ/lK3uGQAAAABJRU5ErkJggg==",
      "base64",
    ),
  )

  // When: EXIF is extracted
  const exif = await extractExif(pngPath)

  // Then: no EXIF yields null
  expect(exif).toBeNull()
})

test("extractExif returns null for corrupt file instead of throwing", async () => {
  // Given: a corrupt image file
  const tempDir = await mkdtemp(join(tmpdir(), "media-tagger-exif-"))
  const badPath = join(tempDir, "corrupt.jpg")
  await writeFile(badPath, "not an image")

  // When: EXIF is extracted
  const exif = await extractExif(badPath)

  // Then: extraction fails soft
  expect(exif).toBeNull()
})

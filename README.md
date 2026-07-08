# media-tagger

Hybrid LLM skill repo plus Bun CLI backend for local media inventory and tagging.

## What this is

- LLM skill entrypoint: `SKILL.md`
- CLI backend: `src/cli.ts`
- Local-first scan/tag flow: offline by default
- Optional API tagging: OpenAI-compatible VLM endpoint when `--api` is passed

## Install

```sh
bun install
```

## Skill usage

Agents should load this skill when scanning local media folders, writing sidecars/manifests, tagging media with VLM analysis, or checking privacy behavior.

## CLI

Show help:

```sh
bun run src/cli.ts --help
```

Scan dry-run:

```sh
bun run src/cli.ts scan ./library --dry-run
```

Scan:

```sh
bun run src/cli.ts scan ./library
```

Tag offline:

```sh
bun run src/cli.ts tag ./library
```

Tag with API:

```sh
bun run src/cli.ts tag ./library --api
```

## API configuration

Copy `.env.sample` to `.env` and set `MEDIA_TAG_API_KEY`, or pass `--api-key`.

Optional flags: `--api-base-url`, `--api-model`, `--sample-interval`, `--max-frames`.

## Offline vs API mode

Offline mode writes hashes, technical metadata, sidecars, and manifests. AI summaries/tags/quality scores stay empty/default.

API mode sends selected evidence to the configured provider and fills AI-generated fields when the response validates.

## Video tagging

The CLI samples JPEG frames from video with ffmpeg and sends those sampled JPEG frames to the VLM. It does not upload the whole video file.

## Privacy

Do not enable API tagging for private, sensitive, or confidential media. Offline mode stays local.

## Supported media

Images: `jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`, `tiff`, `bmp`.

Video: `mp4`, `mov`, `avi`, `mkv`, `webm`, `m4v`.

Audio: `mp3`, `wav`, `ogg`, `flac`, `aac`, `m4a`, `wma`.

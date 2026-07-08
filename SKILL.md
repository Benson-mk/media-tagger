---
name: media-tagger
description: Use when scanning local image, video, or audio libraries; writing media sidecars or JSONL manifests; tagging local media with optional OpenAI-compatible VLM analysis; checking media tagging privacy behavior.
---

# media-tagger

## Overview

Local-first media inventory and tagging skill. Use the Bun CLI backend in this repo to scan media folders, write sidecar/manifest records, and optionally tag media with an OpenAI-compatible VLM API.

Default is offline. API tagging only happens when `--api` is passed.

## When to Use

- scan image, video, or audio folders
- create or explain sidecar JSON / JSONL manifests
- tag local media with optional VLM analysis
- configure API key, base URL, model, or frame sampling
- answer privacy questions about uploaded media evidence

## When Not to Use

- cloud asset management or DAM workflows
- face recognition or identity detection
- media editing/export pipelines
- local BPM analysis
- database-backed cataloging

## Quick Commands

```sh
bun install
bun run src/cli.ts --help
bun run src/cli.ts scan ./library --dry-run
bun run src/cli.ts scan ./library
bun run src/cli.ts tag ./library
bun run src/cli.ts tag ./library --api
```

## API Configuration

Set `MEDIA_TAG_API_KEY` in `.env` or pass `--api-key`. Configure OpenAI-compatible endpoints via `MEDIA_TAG_BASE_URL`/`MEDIA_TAG_MODEL` env vars or `--api-base-url`/`--api-model` flags (flags win).

## Privacy Behavior

Offline mode hashes/probes local files and writes local outputs. API mode may upload selected media evidence: images, sampled video frames, or audio clips. Do not enable API mode for private, sensitive, or confidential media.

## Outputs

- sidecar JSON next to media files unless `--no-sidecar`
- JSONL manifest at default path or `--output`
- stable `sha256:<hex>` asset IDs

## Common Mistakes

- forgetting `--api` and expecting AI tags
- setting API key but not enabling `--api`
- assuming whole video upload; VLM receives sampled JPEG frames
- using API mode on confidential media

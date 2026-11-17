# Profile Studio

A browser app for making and editing Parley profile cosmetics — avatar decorations, nameplates, profile effects and
profile frames — with live previews drawn the way Parley draws them. It works on Parley's assets-folder format, so
what you export imports straight into an instance.

Everything stays in your browser (autosaved to IndexedDB). Nothing is uploaded anywhere.

## Use it

```
npm install
npm run dev
```

1. **Open folder** (an instance's assets folder, or any folder laid out like one), **Open zip**, or drop either onto
   the page. Or start from **New**.
2. Edit names, descriptions, files, layers and frame layout. Problems Parley would refuse show as red badges; warnings
   are yellow.
3. **Export zip** (`parley-assets.zip`), then in Parley go to **Admin → Cosmetics → Import** and pick it (or its
   unzipped folder). In Chrome/Edge, **Save to folder** writes straight into a folder instead.

## The format

An assets folder has one subfolder per kind, each with a `metadata.json`:

```
avatar-decorations/   metadata.json + one picture per item      (png, apng, gif, webp)
nameplates/           metadata.json + one file per item         (png, apng, gif, webp, webm, mp4)
profile-effects/      metadata.json + <folder>/ per item        (layers: png, apng, gif, webp;
                                                                  optional static.png, reduced_motion.png, thumbnail.png)
profile-frames/       metadata.json + <folder>/ per item        (layers: png, apng, gif, webp)
```

`metadata.json` is `{"items": [...]}` (other top-level fields such as `item_count` are kept, and `item_count` is kept
true), written with a one-space indent and a trailing newline. Each item has `file` (decorations, nameplates) or
`folder` (effects, frames), `name` (≤ 60) and `description` (≤ 300). Fields the Studio doesn't edit are kept as read.

- **Effect layers**: `file`, `start_ms`, `duration_ms`, `loop`, `loop_delay_ms`, `z_index`, optional `random_variants`.
- **Frame layers**: `file`, `order` (`front`/`back`), `type` (`staple`/`rail`/`border`), `anchor`
  (`top`/`bottom`/`center`), optional `responsive`; plus a `layout` with `inner_width`, `overflow_top`,
  `overflow_bottom`, `overflow_horizontal`.

Limits match Parley's importer: files up to 8 MB, up to 32 layers, times up to 600000 ms, `z_index` up to 10000,
layout values up to 4096. File and folder names are letters, digits, `.`, `_` and `-`. An item's id in Parley is its
file stem or folder name, lower-cased — keep it once people wear the item.

The source of truth is Parley itself (`backend/src/routes/assets.rs`, `asset_layers.rs`, `asset_admin.rs`); when it
changes, `src/format/` changes to match.

## Develop

```
npx tsc -b       # types
npx oxlint       # lint
npx vitest run   # format unit tests
npm run e2e      # Playwright round trip, synthetic pictures only
npm run build
```

Commits use Conventional Commits; the hooks in `.githooks/` (enabled by `npm install`) check them.

Licensed under Apache-2.0.

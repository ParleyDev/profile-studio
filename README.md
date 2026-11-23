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
   the page. Or start from **New**. Opening one while items are open merges it in: items match by id the way Parley
   matches them, you pick which new and changed ones come in, and nothing open is removed (or choose **Replace
   everything instead**). What a merge brings in is marked New or Updated in the list until you clear the marks.
2. Edit names, descriptions, files, layers and frame layout. Problems Parley would refuse show as red badges; warnings
   are yellow.
3. **Export zip** (`parley-assets.zip`), then in Parley go to **Admin → Cosmetics → Import** and pick it (or its
   unzipped folder). In Chrome/Edge, **Save to folder** writes straight into a folder instead.
4. Or **Publish**: **Sign in with Parley** (Parley's own sign-in and approval page opens in a popup; the Studio only
   gets access to the instance's cosmetics, and never sees your password), **Compare**, then **Publish** the new and
   changed items. Nothing there is deleted. Your account must be able to manage the instance, and the instance needs
   the `cosmetics.manage` app permission (Parley's OAuth for third-party apps). Serve the Studio over https, on
   localhost, or on a private network address so Parley accepts it as a return address. What was published is
   remembered per instance, so later comparisons only download files you changed. **Pull from instance** goes the
   other way: the instance's assets-folder items are downloaded and merged into what's open, the same way.

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

- **Tags** (optional): `tags`, a list of up to 20 lower-case tags of up to 32 letters, digits, spaces, `-` and `_`
  (`["christmas", "winter sports"]`), for searching (`#christmas`) and grouping. Parley keeps fields it doesn't know,
  so tags already travel through export and Import. Publishing and pulling sync them with an instance whose admin
  list (`GET /api/admin/cosmetics/:kind`) reports each item's `tags` and whose edit
  (`PATCH /api/admin/cosmetics/:kind/folder/:id`) takes `tags` in `meta`; with older instances tags are left as
  Import wrote them.
  - **Special tags:** `color:<code>` and `theme:<code>` give the item that colour or theme, on top of the sync
    script's `colors` and `themes` (tags never take one away). The code is tidied like a `tag_labels` label:
    `theme:Cute & Cozy` is stored as `theme:cute_cozy`. Parley's Discover filters by both, and so do the Studio's
    search, group-by and Shop panel (tagged values dashed). A theme's display name comes from `tag_labels`, else
    from its code ("Holiday"). Suggested tags offer `color:` from the picture and `theme:` from the name and similar
    items, for items that lack them. Other `x:y` tags are plain tags.
- **Shop sync fields** (written by a shop sync script, kept as written and never edited here): `in_shop`, `price`,
  `availability`, `leaves_shop_at`, `shop_item_id`, `match_type`, `collection_id`, `base_name`/`variant_label`,
  `colors`, `themes`, `bundles` (`[{id, name}]`), `preview_url`/`video_url`, `palette` (nameplates), `dynamic`
  (effects). They show in the item's Shop panel; `colors` and `themes` are searchable (`#sci-fi`), offered as tag
  suggestions, and the gallery can group by theme or bundle. Top-level fields such as `tag_labels` (theme labels),
  `updated_at` and `collections` are kept; `collections` (`{id: {items: [file or folder]}}`) is rebuilt from each
  item's `collection_id` on save, so renames and deletions keep it true.
- **bundles.json** (beside the kind folders, optional): `{bundles: [{id, name, price, owned, collection_id, items:
  [{shop_item_id, name, type}]}]}`, `type` being `avatar_decoration`, `nameplate`, `profile_effect` or
  `profile_frame`. It's read with the folder, kept in the browser, and written back with exports and Save to folder;
  an item's Shop panel lists its bundles and links to the other items in them (matched by `shop_item_id`). Merging a
  folder that has one takes the incoming bundles.json.
- **bundles.local.json** (beside bundles.json): the Studio's own bundle changes, so the sync script can rewrite
  bundles.json without undoing them. **Bundles** (bottom of the sidebar) lists every bundle; open one to rename it,
  set its price or owned flag, add items of any kind, reorder or remove them, link a missing item to one in the folder,
  delete it, or make a new one. `{bundles: [...]}` where each entry has an `id`: for a bundle bundles.json has, only
  the changed fields (`name`, `price`, `owned`, or `items`, the whole list) or `deleted: true`; any other id is a
  bundle made in the Studio, kept whole. An item with no `shop_item_id` is referred to by `type` and `key` (its file or
  folder name). Undoing every change to a bundle ("Back to synced") removes its entry, and an empty file isn't
  written. bundles.json and the items' own `bundles` lists are never changed. When a folder is merged in, your
  changes win over the incoming file's for the same bundle.
- **Publishing bundles and folder settings**: on the Publish page, "Bundles and folder settings" compares bundles.json,
  bundles.local.json and each kind's top-level metadata.json fields (not `items`, `item_count` or `collections`, which
  both sides work out from the items) with the instance, and offers Push or Pull for each, whole. Pushes carry the
  instance's etag (`If-Match`, or `If-None-Match: *` to create), so a change made there since the comparison is
  refused (412) rather than overwritten. Parley API: `GET /api/admin/cosmetics/bundles` →
  `{files: {"bundles.json": {json, etag} | null, "bundles.local.json": …}}`; `PUT`/`DELETE
  /api/admin/cosmetics/bundles/:file`; `GET`/`PATCH /api/admin/cosmetics/:kind/metadata` (`{fields, etag}`, PATCH
  `{fields: {key: value | null}}`). Instances without it answer 404 and the section says so.
- **Item entry fields**: with instances whose admin list reports each folder item's whole `entry`, publishing an item
  also sends every field Parley doesn't handle itself (anything but file, folder, name, description, layers, layout
  and tags: colours, themes, bundles, shop details, …) as `meta.fields` (`{key: value | null}`), and pulling takes
  them from the instance's entry.
- **Layout**: each JSON file is written back with the indent and final newline it was read with (a file on one line,
  or a new one, gets Parley's one-space indent), and `items` keeps its place among the top-level fields, so saving
  back over a synced folder doesn't reformat it.
- **Suggested tags**: "Suggest tags" under an item's Tags, or "Suggest for N" in the gallery's Select mode, proposes
  tags worked out in the browser (nothing is sent anywhere): words in the name, file name and description matched
  against tags in use and a small built-in vocabulary (`santa` → `christmas`), the picture's main colours and whether it
  moves, and the tags shared by the most similar-looking items of the same kind (colour mix plus a difference hash of
  the first frame). Suggestions are only added when you pick them.

Limits match Parley's importer: files up to 8 MB, up to 32 layers, times up to 600000 ms, `z_index` up to 10000,
layout values up to 4096. File and folder names are letters, digits, `.`, `_`, `-`, spaces and `! & ' ( ) ,` (what
the Discord sync tool writes; folders without `.`), with no space at either end. An item's id in Parley is its
file stem or folder name, lower-cased — keep it once people wear the item.

Publishing only holds new items to the name rule (an item already on the instance keeps its name there; an effect's or
frame's layer files are checked whenever its layers change). **Fix names** in Publish's "Can't publish" group tidies
the names in one go (other characters become `_`: `café:1.png` → `caf_1.png`), after a look at each: new items get a new
file or folder name whose id clashes with nothing, items already on the instance only get their layer files renamed,
and bundles.local.json references follow.

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

# Data schema (v1)

All files are UTF-8 JSON, 2-space indent, trailing newline. Timestamps are ISO-8601
UTC (`2026-11-14T10:00:00Z`). Slugs are lowercase kebab-case `[a-z0-9-]+`.

## Recipe — `recipes/<slug>.json` (model-owned)
```jsonc
{
  "schemaVersion": 1,
  "slug": "garlic-butter-chicken-thighs",
  "title": "Garlic Butter Chicken Thighs",
  "summary": "One-line hook shown on cards.",
  "profile": "3–5 sentences: flavor profile (salt/fat/acid/heat/sweet/umami, texture, aroma) and deliverables (what you end up with, yield, how it's served, keeps/reheats). Primarily for the model; shown collapsed in the UI.",
  "status": "built",            // "built" = formatted by model; "custom" = typed by user, awaiting enrichment
  "source": {
    "type": "custom",           // custom | pdf | youtube | instagram | tiktok | web | image | text
    "url": null,                // original link, if any
    "files": [],                // archived originals, e.g. ["sources/<slug>/card.pdf"]
    "author": null
  },
  "image": "media/<slug>/hero.jpg",   // or null
  "servings": 4,                // number or null; drives the scaler
  "yield": "8 thighs",          // free text or null
  "time": { "prep": 10, "cook": 25, "total": 35 },  // minutes, any may be null
  "equipment": ["12-inch skillet"],
  "ingredients": [
    {
      "id": "i1",               // stable forever
      "section": null,          // optional group heading, e.g. "Sauce"
      "qty": 1.5,               // number or null ("to taste")
      "qtyMax": null,           // for ranges: qty..qtyMax
      "unit": "lb",             // short unit or null for counts
      "item": "boneless skinless chicken thighs",
      "note": "patted very dry" // prep / optional note or null
    }
  ],
  "steps": [
    {
      "id": "s1",               // stable forever — journal notes point here
      "section": null,
      "text": "Season thighs with 1 tsp kosher salt per lb and rest 15 minutes.",
      "timers": [ { "label": "Dry brine", "seconds": 900 } ],  // clickable timers
      "tip": null               // optional why/tip line
    }
  ],
  "createdAt": "2026-11-14T10:00:00Z",
  "updatedAt": "2026-11-14T10:00:00Z",
  "changelog": [
    { "date": "2026-11-14", "summary": "Cut salt 25% per note n-…", "notes": ["n-20261114-ab12"] }
  ]
}
```
Rules: new ingredient/step ids = next unused number (`i7`, `s9`); never renumber or
reuse ids. Deleting a step leaves a gap. Timers: every explicit duration in a step
should have a timer entry (the UI also auto-detects durations in text as a fallback).

## Library — `data/library.json` (user-owned)
```jsonc
{
  "schemaVersion": 1,
  "recipes": {
    "<slug>": {
      "tags": [],               // blank by default
      "rating": null,           // 1–10 or null (= "Unrated" filter category)
      "proficiency": null,      // 1–5 or null (= "Not set")
      "addedAt": "2026-11-14T10:00:00Z"
      // older entries may still carry "cooked"/"lastCooked": unused. The cook log is the
      // days with journal photos (journal entry `cookedOn`).
    }
  },
  "playlists": [
    { "id": "pl-k3x9", "name": "Weeknight", "recipes": ["<slug>"], "createdAt": "…" }
  ]
}
```

## Site password — `data/lock.json` (user-owned; absent = no password)
Written only by Settings → Password (`store.saveLock`, config built by `js/lock.js`). Never
edit it by hand except to delete it, which turns the password off (the recovery path if it's forgotten).
```jsonc
{
  "schemaVersion": 1,
  "kdf": "PBKDF2-SHA256",
  "iterations": 600000,         // PBKDF2-HMAC-SHA256 rounds; slow on purpose, the file is public
  "salt": "base64, 16 random bytes",
  "check": "hex SHA-256 of the 32-byte derived key",
  "updatedAt": "2026-11-14T10:00:00Z",
  "vault": {                    // absent = not saved yet (the first device with token + password saves it);
                                //   false = turned off in Settings → "Keep my GitHub token with the password"
    "alg": "AES-GCM",
    "iv": "base64, 12 bytes",
    "data": "base64 ciphertext of the GitHub token; key = SHA-256(derived key ‖ 'bigback token vault v1')"
  }
}
```
A lock screen, not encryption: it gates the app, and the data files stay public. Devices remember
the derived key (`bb.unlock` in localStorage), which stays valid only while it matches `check`.
When `vault` is present, unlocking on a device with no token restores it (wiped storage, a new
Home Screen app). Changing the password re-encrypts it; Disconnect in Settings turns it off.

## Journal — `journal/<slug>.json` (user-owned; model updates `status` only)
```jsonc
{
  "slug": "<slug>",
  "entries": [
    {
      "id": "n-20261114-ab12",
      "kind": "note",           // note | photo
      "scope": "step",          // step | recipe
      "stepId": "s3",           // when scope = step
      "stepText": "snapshot of the step text when the note was written",
      "text": "Too salty — halve the soy sauce.",
      "photo": null,            // kind=photo: "media/<slug>/journal/<id>.jpg"
      "cookedOn": "2026-11-14", // kind=photo: day it was cooked (the photo's EXIF date or picked; default
                                //   the upload day). "Cooked 3× · last Nov 14" counts distinct cookedOn days.
      "createdAt": "…",
      "status": "open",         // open → applied (recipe changed) | kept (personal note, no change)
      "resolution": null,       // model's one-line explanation of what it did
      "resolvedAt": null
    }
  ]
}
```

## Inbox item — `inbox/<id>/item.json` (+ uploaded files in the same folder)
```jsonc
{
  "id": "20261114-101500-ab12",
  "kind": "file",               // file | link | text
  "title": "Grandma's lasagna",  // user-supplied guess, may be blank
  "url": null,                  // for links (YouTube, Instagram, web)
  "files": ["inbox/<id>/recipe.pdf"],
  "text": null,                 // pasted caption/transcript/recipe text
  "hint": null,                 // user's note to the builder ("use the 2nd version")
  "blocked": null,              // set by the builder when it can't extract a recipe: "reason / what's needed"
  "createdAt": "…"
}
```
Anything in `inbox/` is **non-built**. Building it = write `recipes/<slug>.json`,
`git mv` files to `sources/<slug>/`, add a blank library entry, rebuild index.

## Index — `recipes/index.json` (generated by `scripts/build_index.py`)
```jsonc
{
  "recipes": [ { "slug", "title", "summary", "image", "time", "servings", "status",
                 "sourceType", "updatedAt", "openNotes" } ],
  "pending": [ { "id", "kind", "title", "url", "createdAt" } ]
}
```

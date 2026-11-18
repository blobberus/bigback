---
name: recipe-ingest
description: Turn a raw recipe upload from the Bigback inbox (PDF, photo of a card or cookbook page, YouTube / Instagram / TikTok / web link, pasted text) into a schema-valid recipes/<slug>.json with a flavor profile, timers and clean ingredients — or enrich a user-typed "custom" recipe the same way. Use when building inbox items during "update the site", when a recipe needs formatting, cleaning or a profile, or when deciding that an upload is too thin to build (blocked).
---

# Recipe ingest

Goal: a recipe the cook can follow on a phone mid-cook — faithful to the original author,
clarified, with timers and a `profile` that defines what success tastes like. The cook is
intermediate→advanced in a homestyle kitchen with a basic pantry: don't explain basics,
do give the one-line *why* for anything non-obvious.

Data shapes: `docs/SCHEMA.md` (Recipe + Inbox item). Reference quality bar:
`recipes/crispy-skillet-chicken-thighs.json` — read it once if you haven't.

## 1. Read the source
Start from the item's `pending.py` block, then `inbox/<id>/item.json`. Always honor `hint`
("use the 2nd version", "the one on the left page", "double it" → note it in the changelog).
Use `item.text` whenever present — it's what the user pasted and is often the best source.

| Source | How |
|---|---|
| PDF | Read tool on the file (`pages: "1-20"` per call for long PDFs). Transcribe every page the recipe spans. |
| Image (card, cookbook page, screenshot) | Read tool on each image, in upload order. Handwriting: pick the most plausible reading; log doubtful reads in the changelog ("read ⅓ cup from smudged card"). |
| Web link | `python .claude/skills/recipe-ingest/extract.py jsonld <url>` → schema.org Recipe (exact ingredient lines + steps). Exit 2 / error → WebFetch the URL asking for "the recipe's ingredient list and method verbatim, plus author, yield and times — don't summarize". |
| YouTube | `item.text` first. WebFetch the watch page for the description (often has the full recipe or a link to the written version — follow it with `extract.py jsonld`). If still thin: `yt-dlp --version`; if installed, `yt-dlp --skip-download --write-auto-subs --sub-langs en --write-description -o "<scratchpad>/%(id)s" <url>` then `python .claude/skills/recipe-ingest/extract.py vtt <scratchpad>/<id>.en.vtt`. Reconstruct from transcript + description. Shorts, or no subtitles: skill `.claude/skills/recipe-video/SKILL.md`. |
| Instagram / TikTok / Facebook video | Skill `.claude/skills/recipe-video/SKILL.md`: `reel.py <url>` gets the caption, a speech transcript and frame sheets of the on-screen text from the link alone (no login). `item.text` / `hint`, when present, still win. Follow any "recipe on my site" link. |
| Pasted text | `item.text` is the recipe. |

One upload with several recipes: build the one the hint/title names; if unclear, the main
one, and mention the others in your one-line reply.

**Not enough to build a faithful recipe?** (no ingredient list and no transcript, a
caption that just says "recipe in bio" with a video that doesn't show it, an unreadable photo) — don't invent one. Set
`"blocked": "<what's needed, ≤100 chars>"` in `inbox/<id>/item.json` (e.g. `"Private
account — paste the caption into the item"`), write no recipe, and report it.
Estimating amounts the video *shows* is fine (mark them `"note": "≈, eyeballed in video"`);
inventing a dish isn't.

## 2. Write `recipes/<slug>.json`
- **slug**: kebab-case of the short title, `[a-z0-9-]`, ≤60 chars, not already in `recipes/`.
- **title**: concise, specific, title case ("Mom's Baked Ziti with Sausage"); drop clickbait
  ("THE BEST EVER…"). Keep possessives/attributions the user uses.
- **summary**: ≤120 chars, the hook shown on cards: what it is + the payoff.
- **profile** (3–5 sentences — the definition of success for future refinement):
  1) flavor balance: salt/fat/acid/heat/sweet/umami, dominant aromatics; 2) texture and
  what "right" looks like (crackling skin, sauce that coats a spoon, tender-not-mushy);
  3) deliverables: yield, servings, total time / hands-on, how it's served or paired;
  4) storage + reheating (days in fridge, freezes?, best reheat method). Be concrete —
  a later "too sour" note gets judged against this paragraph.
- **status** `"built"`; **schemaVersion** 1; **createdAt/updatedAt** now (UTC `…Z`).
- **source**: `type` = pdf | image | youtube | instagram | tiktok | web | text (custom only
  for user-typed); `url` = the link; `author` = person / channel / site / book; `files` =
  the item's inbox paths (`finalize_inbox.py` rewrites them to `sources/<slug>/`).
- **image**: the upload's own photo of the *finished dish* (the user's, or a PDF's dish photo):
  copy it (don't move) to `media/<slug>/hero.jpg` and point to that. Otherwise find an openly
  licensed photo of the dish: `python .claude/skills/recipe-ingest/commons.py search "<dish>"`,
  Read the contact sheet, pick one that looks like *this* recipe (same dish, plated, appetizing),
  then `commons.py use <slug> "File:<title>"`. It saves the hero and sets `imageCredit`, which the
  page shows on the photo. Nothing fitting → `image: null`, no credit. Never copy the source
  site's or creator's photos: they're copyrighted and the repo is public.
- **servings** number (from the source; else estimate from quantities) · **yield** free
  text or null ("one 9x13-inch pan", "24 cookies").
- **time** minutes `{prep, cook, total}`; total = start to table incl. passive time
  (marinating, resting, chilling). Overnight steps: count them and say so in the summary.
- **equipment**: what's actually needed, sized ("12-inch skillet", "9x13-inch baking dish").

**Ingredients** — in order of use; `section` only when there are 2+ components ("Sauce",
"Marinade", "To serve"), else null. ids `i1…iN` in order.
- `qty` number (decimals: 0.25, 0.33, 0.5, 0.67, 0.75, 1.5 — the UI shows ¼ ⅓ ½ ⅔ ¾);
  ranges → `qty`+`qtyMax`; "to taste"/"for frying" → qty null + note.
- `unit` short + singular: tsp, tbsp, cup, fl oz, oz, lb, g, kg, ml, l, qt, pinch, clove,
  can, sprig, slice, stick, bunch, inch; null for counts ("2" + "large eggs").
- `item` = the ingredient, specific (unsalted butter, low-sodium chicken stock, whole-milk
  ricotta); `note` = prep or caveat ("finely chopped", "divided", "room temperature").
- Salt: use the source's brand if given. Unbranded "kosher salt" → assume Diamond
  Crystal (the Bon Appétit / Serious Eats default); plain "salt" → table salt (King
  Arthur's default). Always note the swap: Morton kosher ≈ 0.6× and table salt ≈ 0.5×
  the Diamond Crystal volume ("2 tsp" → "Diamond Crystal; use 1¼ tsp Morton or 1 tsp
  table salt"). Metric-only sources: keep grams for baking.
- `density` on every ingredient weighed in g/kg: grams per one tsp, tbsp, cup or ml of it as
  measured (`{ "g": 6, "per": "tsp" }` table salt, `{ "g": 2.8, "per": "tsp" }` Diamond Crystal,
  `{ "g": 18, "per": "tbsp" }` soy sauce, `{ "g": 80, "per": "cup" }` finely grated parmesan,
  `{ "g": 125, "per": "cup" }` flour). The site then shows one US measure next to the weight,
  "10 g (1¾ tsp*)", scaled with the servings (ml amounts get one automatically). Don't also
  write that measure in the note. `"density": null` when spoons and cups make no sense: pasta,
  a block of tofu, a cut of meat (the tap-to-convert panel still gives ounces). A source that
  states its own conversion ("10 g, about 1¾ tsp") sets the density: 10 ÷ 1.75 = 5.7 g per tsp.

**Steps** — ids `s1…sN`; each step is one coherent action group (2–4 sentences, one
pan/stage), not one sentence per step and not a wall of text.
- Lead with the action; include heat level, explicit temperatures `425°F (220°C)`, a time
  range, and the sensory cue that matters more than the clock ("until deep golden and it
  releases on its own, 18–22 minutes").
- **Temperatures** are always written `250°F (120°C)`: degree sign, then the other scale in
  parentheses, in steps, tips, notes and the profile. Sources (and the owner's own typing) often
  say `250F`, `250 F`, `250 degrees` or `350°`; fix them. Oven settings convert to the nearest
  10°C, like an oven dial (350°F → 180°C, 425°F → 220°C, 250°F → 120°C); food, oil, water and
  sugar temperatures to the whole degree (130°F → 54°C, 165°F → 74°C; ranges `125–130°F
  (52–54°C)`). Already inside parentheses, use a slash: `(165°F / 74°C)`. Temperature changes
  convert as changes: `lower it by 25°F (14°C)`. `python scripts/validate.py` warns about any it finds. On the site every
  temperature is also tap-to-convert (°C, oven dial, fan, convection: js/units.js `findTemps`).
- Quantities in the text only when an ingredient is split ("half the parmesan (¼ cup)").
- Name ingredients in steps by the last word(s) of their list name ("the butter", "the stock"
  for "cold unsalted butter" / "chicken stock"): the site turns those words into tap-for-amount
  links (js/components/recipe-mentions.js). A number right before the name suppresses the link.
- `timers`: one per explicit duration, `seconds` = the low end of the range, label 1–3
  words ("Simmer", "Rest", "Covered bake"). Skip "a few seconds" / "30 seconds" stirs
  only if trivial; anything ≥1 minute gets a timer.
- `tip`: one sentence of *why* or a homestyle alternative ("No Dutch oven? A heavy pot
  with foil under the lid works."), else null. Don't restate the step.
- Add implied basics the source skipped (preheat, salt the pasta water, rest meat).
- Meat, fish and eggs need a doneness cue. If the source gives none, add a pull
  temperature from `.claude/skills/recipe-refinement/references/adjustments.md` §5. Never
  set it below the USDA minimum unless the step includes a time-at-temperature hold.
  Before calling an amount an "obvious error", check it against the same file (salt §2,
  leavening and ratios §7).

**Fidelity**: keep the author's dish, amounts and method. Clarify vague bits; fix obvious
errors (ingredient listed but never used, wrong unit, impossible time) and log each fix in
the changelog. Adapt only for a home kitchen (equipment swaps in tips). Don't "improve"
the flavor — that's what notes + recipe-refinement are for.

**changelog**: one entry `{ "date": "<today>", "summary": "Built from <source>; <fixes>",
"notes": [] }`.

## 3. Check before you finish
- Valid JSON, 2-space indent; ids unique and sequential; every step ≥1 min has a timer.
- Every ingredient is used in a step; every step ingredient is listed.
- `python scripts/validate.py` (the router runs `finalize_inbox.py` + commit after you).

## Custom-recipe enrichment (`status: "custom"`)
The user typed it — it's theirs. Keep their title, wording, amounts and step order; fix
only typos and obvious unit slips (log them), and write temperatures as `250°F (120°C)`
(Steps → Temperatures).
- Keep every existing ingredient/step id exactly; only add new ones as next-unused numbers.
- Normalize ingredients: split "2 cups flour, sifted" into qty/unit/item/note.
- Add: `profile`, `summary` (if blank), `timers` for every duration, `tip`s where a why
  helps (sparingly), `time`, `equipment`, `servings` if inferable.
- Keep `source.type: "custom"`; set `status: "built"`, bump `updatedAt`, changelog
  `"Enriched: added profile, timers, normalized units"`.

## Complete example
Inbox item (`kind: "text"`): *"MOM'S BAKED ZITI — 1 lb ziti, 1 lb Italian sausage, 1 onion,
3 garlic, 28 oz can crushed tomatoes, 1 tsp oregano, 15 oz ricotta, 1 egg, ½ c parmesan,
1 lb mozzarella. Cook ziti. Brown sausage w/ onion & garlic, add tomatoes + oregano, simmer
15 min. Mix ricotta, egg, half the parm. Layer ziti, sauce, ricotta. Bake 375 for 30 min.
Serves 8."* → `recipes/moms-baked-ziti.json`:
```json
{
  "schemaVersion": 1,
  "slug": "moms-baked-ziti",
  "title": "Mom's Baked Ziti with Sausage",
  "summary": "Saucy sausage ziti with a creamy ricotta middle and a browned, stretchy mozzarella top. Feeds a crowd.",
  "profile": "Savory and gently sweet from Italian sausage simmered into crushed tomatoes, with oregano and garlic in the background and a salty, nutty lift from parmesan; the ricotta layer keeps it creamy and mild rather than sharp. The pasta should be tender but intact under a blistered, browned mozzarella top, and the pan should slice into squares that hold their shape after resting. Delivers one 9x13-inch pan (8 servings) in about 1 hour 20 minutes, half of it hands-off; serve with a green salad or garlic bread. Keeps 4 days refrigerated or 3 months frozen; reheat covered at 350°F (180°C) for 20–25 minutes with a splash of water around the edges.",
  "status": "built",
  "source": { "type": "text", "url": null, "files": [], "author": "Mom (family recipe card)" },
  "image": null,
  "servings": 8,
  "yield": "one 9x13-inch pan",
  "time": { "prep": 20, "cook": 60, "total": 80 },
  "equipment": ["large pot", "12-inch skillet", "9x13-inch baking dish", "aluminum foil"],
  "ingredients": [
    { "id": "i1", "section": "Pasta", "qty": 1, "qtyMax": null, "unit": "lb", "item": "ziti or penne", "note": null },
    { "id": "i2", "section": "Pasta", "qty": null, "qtyMax": null, "unit": null, "item": "kosher salt", "note": "Diamond Crystal; for the pasta water and to taste" },
    { "id": "i3", "section": "Sauce", "qty": 1, "qtyMax": null, "unit": "lb", "item": "Italian sausage", "note": "casings removed" },
    { "id": "i4", "section": "Sauce", "qty": 1, "qtyMax": null, "unit": null, "item": "yellow onion", "note": "diced" },
    { "id": "i5", "section": "Sauce", "qty": 3, "qtyMax": null, "unit": "clove", "item": "garlic", "note": "minced" },
    { "id": "i6", "section": "Sauce", "qty": 28, "qtyMax": null, "unit": "oz", "item": "crushed tomatoes", "note": "1 can" },
    { "id": "i7", "section": "Sauce", "qty": 1, "qtyMax": null, "unit": "tsp", "item": "dried oregano", "note": null },
    { "id": "i8", "section": "Ricotta layer", "qty": 15, "qtyMax": null, "unit": "oz", "item": "whole-milk ricotta", "note": null },
    { "id": "i9", "section": "Ricotta layer", "qty": 1, "qtyMax": null, "unit": null, "item": "large egg", "note": null },
    { "id": "i10", "section": "Ricotta layer", "qty": 0.5, "qtyMax": null, "unit": "cup", "item": "grated parmesan", "note": "divided" },
    { "id": "i11", "section": "Assembly", "qty": 1, "qtyMax": null, "unit": "lb", "item": "low-moisture mozzarella", "note": "shredded, divided" }
  ],
  "steps": [
    { "id": "s1", "section": null, "text": "Heat the oven to 375°F (190°C) with a rack in the middle. Bring 4 quarts of water to a boil in a large pot with 2 tablespoons of the salt.", "timers": [], "tip": "About 0.5% salt seasons the pasta without over-salting a dish that already has sausage and cheese." },
    { "id": "s2", "section": "Pasta", "text": "Cook the ziti until bendable but still firm at the center, 8–10 minutes (about 2 minutes short of the package time). Drain.", "timers": [{ "label": "Pasta", "seconds": 480 }], "tip": "It keeps cooking in the sauce and oven; fully cooked pasta turns soft and bloated." },
    { "id": "s3", "section": "Sauce", "text": "Meanwhile, brown the sausage in the skillet over medium-high heat, breaking it into small pieces, until no pink remains and some bits are deeply browned, 6–8 minutes. Add the onion and cook until soft and translucent, 4–5 minutes, then the garlic until fragrant, about 30 seconds.", "timers": [{ "label": "Brown sausage", "seconds": 360 }, { "label": "Onion", "seconds": 240 }], "tip": "Let the sausage sit undisturbed between stirs — the browned bits are the sauce's depth." },
    { "id": "s4", "section": "Sauce", "text": "Stir in the tomatoes and oregano, scraping up the browned bits. Simmer gently until slightly thickened, about 15 minutes. Taste and salt only if needed — the sausage brings plenty.", "timers": [{ "label": "Simmer", "seconds": 900 }], "tip": null },
    { "id": "s5", "section": "Ricotta layer", "text": "Stir together the ricotta, egg, half the parmesan (¼ cup) and a pinch of salt.", "timers": [], "tip": "The egg sets the ricotta so it stays a creamy layer instead of weeping." },
    { "id": "s6", "section": "Assembly", "text": "Toss the drained ziti with two-thirds of the sauce. Spread half in the baking dish, dollop the ricotta mixture over it and scatter on half the mozzarella. Top with the remaining pasta, the rest of the sauce, then the remaining mozzarella and parmesan.", "timers": [], "tip": null },
    { "id": "s7", "section": "Assembly", "text": "Cover with foil and bake 20 minutes, then uncover and bake until the cheese is bubbling and browned in spots, 10–15 minutes more.", "timers": [{ "label": "Covered bake", "seconds": 1200 }, { "label": "Uncovered", "seconds": 600 }], "tip": "Foil heats it through without drying the top pasta; the uncovered stretch browns the cheese." },
    { "id": "s8", "section": null, "text": "Rest 10 minutes before cutting so the layers set.", "timers": [{ "label": "Rest", "seconds": 600 }], "tip": null }
  ],
  "createdAt": "2026-11-14T10:00:00Z",
  "updatedAt": "2026-11-14T10:00:00Z",
  "changelog": [
    { "date": "2026-11-14", "summary": "Built from pasted family recipe card. Fixes: mozzarella was listed but never used (now layered and on top); the 30-minute bake split into covered/uncovered; pasta pulled 2 minutes early since it bakes further.", "notes": [] }
  ]
}
```

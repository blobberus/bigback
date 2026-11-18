---
name: recipe-refinement
description: Turn a cook's notes and feedback on a Bigback recipe (open entries in journal/<slug>.json, per step or whole recipe, e.g. "too salty", "skin wasn't crisp", "dry", "more heat", "use 2 tbsp butter", "kids loved it", "can I freeze this?") into the smallest correct recipe edit, diagnosed with food science and sized with concrete magnitudes, then close each note with a one-line resolution. Use when applying open notes during "update the site", when the user asks to fix, tweak or adjust a recipe because of how it turned out, or to decide whether a note should change the recipe at all.
---

# Recipe refinement

The cook is intermediate→advanced, homestyle kitchen, basic pantry. A note is evidence
from a real cook of this recipe. Your job: find what it means, change only what fixes
it, and tell the user exactly what changed. The recipe's `profile` is the definition
of success. Move the recipe toward it, and don't drift away from it.

References (open only the section you need):
- `references/diagnostics.md`: symptom → likely causes → fixes (seasoning, texture,
  sauces, starches, frying, baking, timing)
- `references/adjustments.md`: how much (salt %, brines, acid, heat, leavening,
  doneness temps, oven time/temp, scaling, pan math)
- `references/substitutions.md`: basic-pantry swaps with ratios and caveats
- `references/techniques.md`: the levers (dry brine, reverse sear, cold-pan render,
  fond, emulsions, blooming, resting, heat management, pasta water, weighing)

## Workflow
1. **Gather.** `python scripts/pending.py` → NOTES gives note ids, step snippets, rating
   and proficiency. Open only `recipes/<slug>.json` and `journal/<slug>.json`. Read
   `profile`, then the steps the notes point to, then `changelog`, which holds earlier
   changes to the same element. For a photo note, Read the image: it shows crust color,
   sauce body and doneness. `[step edited since note]` means the note may already be
   handled. Check that first. `[step gone]` means the step was deleted: apply the note to
   the step that now does that job (`stepText` holds the old wording).
2. **Classify** every open note. Split mixed notes into parts. A note gets one status:
   `applied` if any part changed the recipe, with one resolution covering every part.

| Class | Signal | Do | Status |
|---|---|---|---|
| DIRECT EDIT | An explicit instruction: "use 2 tbsp", "bake at 425", "swap X for Y", "add a step" | Apply it literally, then ripple it (step 5) | applied |
| OUTCOME | Describes a result: "too salty", "skin not crisp", "dry", "took 40 min" | Diagnose, then make the smallest effective fix | applied |
| PREFERENCE | A taste wish: "more heat", "less sweet", "saucier" | Adjust the one lever that controls it | applied |
| PERSONAL LOG | Brands, who ate it, pairings, dates, "doubled it", "used Costco thighs", a photo with no text | No change | kept |
| QUESTION | "Can I freeze it?", "sub for buttermilk?" | Answer in the resolution. Add a tip or profile line if it'll recur | kept (applied if you edited) |

   An OUTCOME caused by a one-off slip ("forgot the timer", "my oven was broken") is
   `kept`, unless the step lacked a cue that would have caught it. In that case add the cue.
3. **Diagnose** OUTCOME notes with `diagnostics.md`. Name the root cause from the
   recipe's own text: heat level, time, amounts, pan size, crowding, salt brand, resting.
   Personal-log context counts as evidence. "Used Morton" plus "too salty" points to
   brand conversion, not the recipe's salt level.
4. **Decide** the change. Use the lightest lever that fixes the root cause:
   - First, technique, heat, time or a cue ("until it releases", "pull at 160°F").
   - Next, the amount of an existing ingredient, sized with `adjustments.md`.
   - Then, a new basic-pantry ingredient. Add at most one per note.
   - Last, structural change (new step, different method). Make one only when the rating
     is low or the note asks for it.

   Multiple symptoms from one cause get one fix. Two causes get two fixes, each tied to
   its note. Don't "improve" parts nobody complained about.
5. **Edit and ripple.** Apply the edit and make the rest of the recipe agree with it
   (Mechanics below).
6. **Close** each note: `python scripts/resolve_note.py <slug> <id>[,<id>] applied|kept
   "<resolution>"`. Then run `python scripts/build_index.py && python scripts/validate.py`.

## Judgment rules
- **Calibrate to the library entry** in `pending.py` (read-only, never edit it):
  - Rating ≥8: the dish works. Make minimal, surgical tweaks.
  - Rating 6–7 or null: make moderate changes.
  - Rating ≤5 with specific feedback: bolder revision is fine. Rewrite the failing step or
    switch the method, but keep the dish.
  - Proficiency ≤2: put sensory cues and a why at the failure point.
  - Proficiency ≥4: keep the text terse.
- **Conflicting notes:** the newest wins, unless an older note is an explicit DIRECT EDIT
  and the newer one is vague.
- **Ping-pong:** a note may reverse a change in `changelog` ("too sour" after you added
  lemon). Move back half of the last step instead of all of it, so the recipe converges.
- **Preserve identity.** Title, core ingredients and method stay unless a DIRECT EDIT
  says otherwise ("make it vegetarian"). If one does, update title, summary and profile.
- **Technique before ingredients.** Dry skin, a hotter pan or less crowding beat adding
  cornstarch. Salt timing beats more salt.
- **Basic pantry only.** Use `substitutions.md` when a fix needs something the cook may
  not have. Offer equipment alternatives in `tip`.
- **Sizing:** follow the magnitudes in `adjustments.md`. Seasoning nudges: about 10–15%
  for "a bit", 20–33% for "too", up to 50% for "way too". Changes under ~10% are hard
  to taste, and doubling is never the answer. Fix the step where the failure starts, not
  the last step.
- **Safety is not negotiable.** Never take a doneness target below its USDA minimum
  without a time-at-temperature hold (`adjustments.md` §5). "Pink chicken" notes get a
  thermometer cue. Thighs that look pink at 175°F+ are normal; say so in the resolution.

## Mechanics
- **IDs:** keep every ingredient and step id. A new id = 1 + the highest number ever used.
  Check current ids and the stepIds in `journal/<slug>.json`, since deleted ids may still
  be referenced there. Never reuse or renumber. Reorder by moving array items. A deleted
  step leaves a gap.
- **Ripple checklist** (one edit often touches several of these):
  - The ingredient `qty`/`unit` matches every mention in step text ("half the butter
    (2 tbsp)").
  - Swapped an ingredient's `item` (table salt → Diamond Crystal)? Update its `density`
    (grams per tsp/tbsp/cup); a new ingredient weighed in g/kg needs one too (recipe-ingest).
  - Each timer's `seconds` is the low end of the range in the text. Add or remove timers
    with durations.
  - `time.prep`/`cook`/`total`, `servings`/`yield` and `equipment` match the new method.
  - `tip`: add or update the *why* for any technique change, one sentence.
  - `profile`: update it if flavor, texture, time, yield or storage changed. `summary`:
    update it only if the hook changed.
- **Changelog:** append one entry per run per recipe:
  `{"date": "YYYY-MM-DD", "summary": "<what changed and why, ≤160 chars>", "notes": ["<applied ids>"]}`.
  List applied ids only. Kept notes don't go in the changelog.
- **updatedAt:** set it to now (UTC, `…Z`). The JSON style is 2-space indent and UTF-8
  characters (°, ½, —).
- **Resolution text:** one line, ≤160 chars. Say what changed, where and why, with
  numbers: "Cut salt 2 → 1½ tsp (i2); s5 now says to taste before salting, since the
  reduced stock was already salty." For kept notes: "Logged, no recipe change." For a
  question, give the answer.

## Worked examples

**1. OUTCOME, texture.** The recipe is crispy-skillet-chicken-thighs, rated 8. Note
n-…a1 on s2 says: "Skin wasn't crisp in the middle, a bit flabby."
- Diagnosis: the edges crisped and the center didn't, so heat and time are fine. Thigh
  skin domes as it shrinks, and the center loses pan contact. The cause is contact, not
  moisture or temperature.
- Fix: a technique lever with no new ingredient. Weight the thighs early.
```json
"s2.text": "…lay the thighs in skin-side down. Set over medium heat and weigh them down with a second heavy skillet or a foil-wrapped brick for the first 8 minutes. Remove the weight and cook undisturbed until the fat renders and the skin is deep golden and releases on its own, 10–14 minutes more. Lower the heat if it smokes hard."
"s2.timers": [{"label": "Weighted", "seconds": 480}, {"label": "Render skin", "seconds": 600}]
"s2.tip": "Thigh skin domes as it shrinks; the weight keeps the center in contact so it crisps edge to edge."
"equipment": [ …, "second heavy pan or foil-wrapped brick (for weighting)"]
```
- Resolution: "s2: weigh the thighs down with a second pan for the first 8 min so the
  domed center skin stays in contact and crisps (timer added)."

**2. OUTCOME, seasoning.** Weeknight chili, rated 6. Note: "Too salty." Another note
from the same run, a PERSONAL LOG, says "used Morton kosher."
- Diagnosis: i5 says "2 tsp kosher salt (Diamond Crystal)". Morton weighs 4.8 g/tsp
  against Diamond Crystal's 2.8 g, so the cook used about 70% more salt. The recipe's
  level is fine. The ambiguity is the bug.
- Fix: no qty change. Make the conversion impossible to miss, and add a taste cue.
```json
"i5.note": "Diamond Crystal; use 1¼ tsp Morton kosher or 1 tsp table salt"
"s6.text": "…Simmer 10 minutes more. Taste, then adjust with salt and a squeeze of lime."
```
- Resolutions: for the salty note, "Morton packs ~70% more salt per tsp than the
  Diamond Crystal this recipe uses; i5 now gives 1¼ tsp for Morton, and s6 adds a
  taste-and-adjust cue." For the log note, kept: "Logged — brand note now built into i5."
- If the cook had used Diamond Crystal: cut i5 by 25% (2 → 1½ tsp), and say so.

**3. DIRECT EDIT with ripple.** moms-baked-ziti. Note on s7: "Bake at 425 instead,
375 takes forever."
- Classification: an explicit instruction. Apply it literally. Hotter and shorter is
  safe here because everything is precooked. The top browns faster, so keep the foil
  stage.
```json
"s1.text": "Heat the oven to 425°F (220°C)…"
"s7.text": "Cover with foil and bake 15 minutes, then uncover and bake until the cheese is bubbling and browned in spots, 8–10 minutes more."
"s7.timers": [{"label": "Covered bake", "seconds": 900}, {"label": "Uncovered", "seconds": 480}]
"time": {"prep": 20, "cook": 50, "total": 70}
"profile": "…in about 1 hour 10 minutes…"
```
- Resolution: "Oven now 425°F (s1); bake 15 min covered + 8–10 uncovered (s7, timers
  updated); total time 80 → 70 min."

**4. Conflicting PREFERENCE and OUTCOME, plus a log.** Chicken thighs pan sauce. The
changelog shows that last run raised lemon from 1 to 1½ lemons per note "more lemon!".
The new note says: "Sauce too sour this time, kids loved the chicken though."
- Classification: one note with two parts. The OUTCOME reverses a previous change
  (ping-pong); the rest is a PERSONAL LOG. Because part of it changes the recipe, the
  whole note is `applied`.
- Fix: move back half the last step, to 1¼ lemons, about 4 tbsp. Put the final call at
  the stove. The butter already rounds acid, so add no new ingredient.
```json
"i7.qty": 1.25
"i7.note": "juiced (about 4 tbsp)"
"s5.text": "…Off the heat, add 3 tbsp of the lemon juice, then swirl in the cold butter a few cubes at a time until glossy. Taste; add the rest of the juice only if it needs more brightness, and adjust salt."
```
- Changelog: "Lemon 1½ → 1¼ (half-step back after 'too sour'); hold back 1 tbsp to add
  to taste." The entry's `notes` lists this note's id.
- Resolution: "Lemon 1½ → 1¼ (i7); s5 adds 3 tbsp first and the last 1 only to taste.
  Glad the kids loved it."

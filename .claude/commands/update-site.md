---
description: Build new inbox uploads, enrich custom recipes and apply open notes, then push
argument-hint: "[optional scope, e.g. 'notes only' or an inbox id/slug]"
---
Update the Bigback site. Read `.claude/router/update-site.md` and follow it exactly,
step by step (sync → pending.py → build inbox → enrich custom → apply notes → validate →
push → short report).

Scope from the user (if any — restrict the run to it, otherwise do everything): $ARGUMENTS

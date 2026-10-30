# Book Compendium Converter — 0.0.5 experimental

Foundry VTT 14 / D&D5e 6.0.6. **Not Character Builder certified yet.**

## Data directory

Install/extract the **contents** of a user-provided 5etools release to:

`FoundryVTT/Data/bcc/5etools/`

Confirm `Data/bcc/5etools/data/books.json` exists. Do not add a release-version folder between `5etools/` and `data/`. This module ships no book content.

## Official repository and distribution

Source: https://github.com/hammer-PvP/Book-Compendium-Converter

Manifest (after the first GitHub release is published):
`https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/module.json`

Release ZIP (after publication):
`https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/book-compendium-converter.zip`

Releases are built from `v<version>` Git tags. The published ZIP contains only runtime
files (module.json, README.md, LICENSE, scripts/, styles/), never local testing data,
Plutonium code, 5etools content, or proprietary book assets.

## Install

Extract `book-compendium-converter.zip` under `FoundryVTT/Data/modules/`, resulting in `Data/modules/book-compendium-converter/module.json`. Enable it in a GM test world. Do not enable Plutonium.

The **Book Compendium Converter** button is always offered to GMs at the top of the **Compendiums** sidebar tab. Click it to open the importer; it reappears when the tab redraws. The developer-console command `game.bcc.open()` remains supported as a fallback.

Choose a book; click **Analisar livro** then **Criar compêndios**. The BCC creates World Compendium packs in a named compendium folder. Existing documents with identical deterministic IDs are *not overwritten*. Use a clean test world for each import during this early release.

After import, click **Baixar relatório JSON** and send the file for review. It lists unresolved links, incomplete mechanical conversions and unlocalized images.

## What this early release supports

- Reading the source library without hardcoding localhost, a Windows path, or release number.
- All titles in the 5etools book catalog; source-based identification of category JSONs.
- Native World Compendium creation grouped in a book folder, stable IDs, local UUID links.
- Experimental native Item conversions: species, backgrounds, feats, classes, subclasses, class features, optional features, spells, equipment. Native Actors and chapter Journals where present.
- Initial Size, Skill, Resistance, Ability Score Improvement, Hit Points, ItemGrant, ScaleValue transformations; 5etools Foundry supplements applied where available.
- Re-runs skip existing records to avoid overwriting changes. Errors are reported per document.

## 0.0.5: Offline deterministic Spell Activity generation (pilot)

- **No Plutonium runtime dependency.** No Plutonium package calls or bundled Plutonium code; no remote services, AI inference, online SRD lookup or compendium fallbacks. `Data/bcc/5etools/data/` remains the user-supplied local source.
- A new first-party `scripts/spell-activities.mjs` maps structured 5etools Spell data into native D&D5e 6.x `save`, `attack`, `damage`, `heal` and `utility` Activities when a supplemental Activity is not available. It handles spellcasting attributes, spell activation/range/duration/materials/components, concentration, some measured areas and recognizable dice/scaling.
- **Authoritative 5etools Foundry supplemental Activities still take priority** when resolvable. If an unsupported external summon reference prevents importing the supplement, a locally generated utility `Cast` can remain available, *with an explicit incomplete warning*, rather than treating the spell as wholly functional.
- The import report flags unsupported/ambiguous data and spells that have a basic `Cast` Activity but require additional manual/automated mechanics. Activity presence is **not** proof of spell correctness.
- **Local static pilot** (not in Foundry): 391 XPHB spells converted with 0 missing Activities; 110 received one generated Activity when the native supplement supplied none, including 27 Save, 7 Attack, 4 Heal, 72 Utility. 507 5etools spell records from XPHB/TCE/XGE were independently parsed without JavaScript exceptions. Some special rules, AoE semantics, target counts, conditions, and summons remain incomplete. Real D&D5e DataModel + rolls and Character Builder testing **are still required**.
- **For QA import into a clean world** (`Testes`), or back up and explicitly remove only old BCC test packs: the importer skips previously persisted IDs and does not overwrite v0.0.4 documents. Never test in an active campaign such as Reinos de Humeth.

## 0.0.4: Persistent Compendium shortcut and generic choice conversion

- New permanent, one-click **Book Compendium Converter** button in the **Compendiums** tab for GMs, with safe reinsertion on v14 sidebar redraw. Does not create extra buttons on repeated rendering. Already-open app comes to front.
- Source-driven `ItemChoice` for `optionalfeatureProgression` and `featProgression`. Progression counts are derived from 5etools, and pools contain only UUIDs of items imported by BCC. Supports an Eldritch Invocations progression **without checking for the Warlock by name**.
- Initial `ItemChoice` for class cantrips/prepared-spell progressions using the 5etools generated spell-source lookup (also local). Records when a class's spell list includes spells from other books; no official compendium fallback.
- Initial `ItemChoice` for `additionalSpells` recipes with class/level selection (including the pattern used by Magic Initiate). Variant coupling, fixed grants and casting semantics not yet certified; incomplete cases are listed in the report.
- Native `Subclass` advancement at the first `gainSubclassFeature` level declared by the source, retaining source context in advancement flags.
- Local deterministic indexes and provenance retained. This is an experimental mechanical pass, **not a claim of full Character Builder support**, and it requires testing in Foundry 14 / D&D5e 6.0.6.

## 0.0.3 repair scope

- Use the active D&D5e system document constructors from `CONFIG.Actor.documentClass`,
  `CONFIG.Item.documentClass`, and `CONFIG.JournalEntry.documentClass` for
  preflight and persistence. Fixes the 15 NPC preflight errors in 0.0.2
  (`this.parent.getCRExp is not a function`) caused by using Foundry's
  unextended core `Actor` constructor.
- Explicitly reject an NPC preflight when the expected Actor5e method is
  absent, instead of counting it as successfully validated.
- No changes to the source data directory, compendium identity scheme,
  existing imported documents, asset handling, or mechanical conversion scope.

## 0.0.2 repair scope

- Translate 5etools `@spell[...]` and `@creature[...]` in supplemental Activities into typed native Compendium UUIDs when that document is part of the imported book. Unsupported external references are reported, and dependent activities are withheld instead of emitting invalid Foundry documents.
- Remap enchantment effect riders' `foundryId` fields into 16-character native Activity/Effect IDs.
- Use V14 Active Effect change `type` rather than deprecated numeric `mode`; update report saving API.
- Add initial Ability Score Improvement Advancements to Feats with explicit 5etools ability data (e.g., War Caster).
- Validate documents before submission, verify persisted pack indexes after writes, retry intermittent write failures, and distinguish creation errors from the unresolved mechanical backlog.
- Repeat imports do not replace already-present documents. **For apples-to-apples QA, test in a fresh world or remove only the v0.0.1-generated compendiums** after taking any required backups.

## Explicitly NOT completed

- **No verified Character Builder compatibility or complete level-up** (requires end-to-end QA).
- Not all options, multiclass progressions, spell Activities, spell lists, Subclass flows, proficiencies, Foundry overlays or variant entries are converted yet.
- Source data `_copy`/`_versions` are not fully expanded; report/review these before serious use.
- No image download/localization, export/import backup, or source update workflow yet.
- No guarantee that every chapter element is faithfully rendered; unknown 5etools tags are simplified.

DO NOT DISTRIBUTE third-party book text or images with this module. They are read from the operator's separate source files.

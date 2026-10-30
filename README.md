# Book Compendium Converter — 0.0.7 experimental

An offline book importer targeting **Foundry VTT 14.369 / D&D5e 6.0.6**.
This build expands native world-compendium generation. **Foundry and Character
Builder end-to-end validation is still pending.**

Source: https://github.com/hammer-PvP/Book-Compendium-Converter

## Install and local source data

Extract the module ZIP into `FoundryVTT/Data/modules/book-compendium-converter/`
so that `module.json` is directly inside that directory. Enable BCC in a GM test
world.

Separately extract the contents of your own 5etools data release into
`FoundryVTT/Data/bcc/5etools/`. Confirm that
`Data/bcc/5etools/data/books.json` exists, without an extra release-version
directory. The development reference for this build was 5etools 2.39.0.

BCC ships no book text, artwork, source data, Plutonium code, or 5etools code.
It does not require Plutonium, web services, AI inference, or online SRD lookups.
All conversion code is original to BCC. Native system enum labels may be read
locally to match tool and weapon proficiency keys; their item mechanics are not
used as conversion fallbacks.

The public release assets are named `module.json` and
`book-compendium-converter.zip`. A development ZIP can be installed manually
before a release is published; the `latest` links continue to refer to the
published release.

- Manifest: https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/module.json
- ZIP: https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/book-compendium-converter.zip

## Import into world compendiums

1. Open **Book Compendium Converter** at the top of the **Compendiums** sidebar.
   The console fallback is `game.bcc.open()`.
2. Select a book and click **Analisar livro**. The preview includes local
   dependencies needed by the selected publication.
3. Choose the handling of existing documents, then click **Criar compêndios**.
4. Download the JSON report. A successful write does not establish mechanical
   completeness: review unresolved links and incomplete conversions separately.

Output remains in world compendiums under a book folder. Internal folders group
equipment by category, spells by level, and features by parent and progression.
Chapter order follows the source book. Referenced equipment in text tables is
also resolved to actual source Item records when available.

| Existing-document mode | Behavior |
| --- | --- |
| Add missing | Creates missing IDs and preserves existing documents. Existing mechanics are not regenerated. |
| Update unchanged BCC | Updates BCC documents whose saved fingerprint still matches. Preserves local edits and older documents without fingerprints. |
| Rebuild this book's BCC documents | Replaces matching BCC documents, including manual edits, while retaining their IDs. Refuses unrelated documents. Requires confirmation in the importer. |

For comparison with older versions, use a **fresh test world**. Rebuild updates documents
in the current conversion graph; it does not delete obsolete documents left by
older conversions. Reload the world after rebuilding to refresh native spell
list contributions.

## 0.0.7 changes

- Ordinary class spells and cantrips no longer create a second ItemChoice
  queue, regardless of whether Character Builder is enabled during import.
  Native progression, scales and registered lists supply the class data.
  Genuine species, feature, invocation and additional-spell choices remain.
- Explicit initial cantrip grants followed by a long-rest replacement rule
  retain the fixed grant. Replacement timing and filter are saved as metadata;
  this release does not add a replacement UI or automate the later rest choice.
- Open selectors stay within the selected publication and required parent-class
  catalogs. Named mechanical dependencies can cross publications, with reasons
  in the report. Narrative references and reading copy bases do not import an
  entire catalog. Supplemental classes without local spells use one compatible
  base catalog from their declared class-list membership.
- Scale Values are consolidated by effective identifier and primary/multiclass
  domain; native supplements override inferred values in their own domain.
- Registered system ActiveEffect change types are preserved. Missing effect or
  rider definitions are reported explicitly and never replaced by invented IDs.
- Starting equipment supports multiple equipment categories and resolvable
  special item labels. Property-filtered weapon proficiencies become native
  trait grants/choices.
- Import progress includes percentage, phase and counts. Completion and its OK
  button follow actual writes, index/page checks and saved import settings.
  Native preparation warnings are included in the report; deferred resource
  bindings are listed as information rather than missing mechanics.
- Class/subclass spell lists are pages in one **Spell Lists** Journal inside
  **Book & Chapters**, without an additional sidebar pack.
- A GM can right-click any World compendium and choose **Excluir tudo**.
  The confirmation identifies the pack and document count, and requires the
  content-deletion checkbox. It deletes that pack and its contents using the
  native API; module/system packs are blocked. Existing copies on actors or in
  world directories remain.

Updating the module does not rewrite imported documents or existing actors.
Re-import to apply fixes. Rebuild retains IDs but does not prune obsolete data.
For a clean comparison, use a fresh test world, or explicitly delete the old
World packs before importing again. Old standalone Spell Lists packs are not
silently deleted; their BCC registrations are superseded on re-import. Reload
Foundry afterward to refresh the native registry and reselect CB source packs.

## Existing conversion coverage

- **Source preparation:** context-aware copies, supported modification modes,
  templates, variants, subraces, native supplements and dependency traversal.
  Unknown modes and unresolved dependencies are reported.
- **Species and options:** exclusive feature choices when a source variant only
  replaces one feature; complete variants when other mechanics change. Feature
  grant levels, native traits, uses, recovery and supplemental effects are
  preserved where representable.
- **Classes and backgrounds:** native starting-equipment groups, quantities,
  currency and linked items; primary and multiclass proficiency distinctions;
  source-derived ASI advancements, progression scales and spell lists.
- **Selection:** source level prerequisites, bounded spell selectors and
  source spell metadata. Ordinary class
  spell progression is supplied through native scales/lists; creation and
  selection workflows belong to the native system and its consumers.
- **Equipment:** weapons, armor, tools, consumables and containers, including
  basic damage, attacks, mastery, properties, charges and supported recovery.
  Structured item spell recipes can generate linked native Cast activities
  when a supplemental activity definition is absent.
- **Actors:** NPC features, actions, bonus actions, reactions, legendary/lair
  entries, spellcasting, slots and referenced equipment are embedded rather
  than leaving Actors with only statistics. Object and vehicle conversion also
  preserves supported statistics and component actions.
- **Persistence:** native document-class preflight, deterministic IDs, reference
  auditing, categorized output and explicit update ownership checks.

These rules are driven by source structure and target-system schemas, with no
book-specific or entity-name conversion branches. PHB examples are regressions,
not the boundary of supported publications.

## Character Builder setup and validation

In Character Builder, enable the generated BCC packs as sources, including
dependency equipment, spells and options. Native equipment category choices use
Character Builder's configured source registry. Its settings also control
selection and level-up behavior. BCC does not modify Character Builder code.
The development reference was Character Builder 0.9.921.

Keep BCC enabled while granting items that need deferred resource references:
its original resource-binding hook resolves imported UUID references to the
Actor's embedded Item IDs. Native spell-list registration also runs through
BCC. The generated world output is not yet a standalone distributable module.

Development checks exercise source contracts, document blueprints, dependency
graphs and a mocked persistence transport. They do **not** execute Foundry's
native DataModels, Character Builder workflows, combat rolls or rest recovery.
The importer performs native schema preflight when run inside Foundry.
For 0.0.7, static generation covered XPHB, Eberron: Forge of the Artificer,
Arcana Unleashed and Tasha's Cauldron of Everything. Regression checks also
covered Goliath ancestry, later species grants, Blight, equipment, NPC embedded
features, cross-book scope, class-domain scales, deletion guards, preparation
warnings and persistence/progress ordering. These checks are not live Foundry
or Character Builder certification.

## Known limits

- Complex prerequisite expressions, conditional grants, coupled ability
  choices, legacy casting formulas and some multiclass or replacement flows
  need live QA. Native level/item prerequisites cannot encode every source
  condition; unsupported conditions remain in provenance and the report.
- Compound attacks, follow-up saves, alternative damage, shared spell-use
  pools, weekly recovery, unusual item recipes and vehicle station mechanics
  may require manual work. Ambiguous damage is not automatically summed.
- Native supplements take priority over inferred activities. A supplement can
  still leave source mechanics incomplete; such cases are reported.
- Full image localization, token artwork, complete book-layout reproduction,
  every copy/modification mode and every supplement are not guaranteed.
- Books represented only by unstructured prose cannot automatically become
  complete mechanical records. Missing structured data is reported.
- No world-to-module exporter is included. That phase follows functional
  validation of world imports.

## Development and distribution

Every version requires a discussed and approved scope before implementation.
Once an approved version is prepared, publish its source and GitHub release
automatically so it can be installed through Foundry for testing. Publication
does not establish end-to-end validation. The current development scope is
broader world import; exporting a selected folder and its dependencies is deferred.

Public source and release ZIPs must exclude official content, Plutonium,
5etools, test files, fixtures and QA data. Release archives contain only
`module.json`, `README.md`, `LICENSE`, `scripts/` and `styles/`.

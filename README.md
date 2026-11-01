# Book Compendium Converter — 0.1.2 experimental

An online book importer and content-module exporter targeting **Foundry VTT 14.369 / D&D5e 6.0.6**.
This build expands native world-compendium generation. **Foundry and Character
Builder end-to-end validation is still pending.**

Source: https://github.com/hammer-PvP/Book-Compendium-Converter

## Install and start

Install BCC in **Foundry VTT 14.369 / D&D5e 6.0.6**, enable it in a GM test
world, then open **Book Compendium Converter** in the Compendiums sidebar.
The default **5etools online** source reads current JSON and artwork from
`https://cdn.5e.tools/2024/`. No Plutonium, local 5etools release, manually
downloaded image collection or separate server is required. Internet access
is required to analyze and import online content.

Resolved artwork is saved automatically through Foundry's native file API under
`Data/assets/srd5e/`. Online artwork is checked again on later imports and reused
by its actual byte hash when unchanged. Imported documents and exported content
modules use these saved files rather than depending on the provider at play time.

The **Atualizar catálogo** button refreshes the book catalog. Each analysis uses
a fresh data session; its JSON files are cached within that session and returned
as independent copies. The import report records source URLs, timestamps and
SHA-256 hashes of the files actually read. The live CDN is not an immutable
release archive; these fingerprints identify the consumed data without claiming
an atomic snapshot of a numbered upstream release.

For an existing local setup, select **5etools local (opcional)** in BCC's
**Fonte de dados** setting. That mode still reads
`FoundryVTT/Data/bcc/5etools/data/books.json` and the corresponding data tree.
Its default artwork root is `bcc/5etools/img`; an optional image-root override
is available. The local conversion fixtures used for regression testing were
5etools 2.39.0. Local mode is optional and does not configure the online mode.

BCC ships no book text, artwork, mechanical source records, Plutonium code, or 5etools code.
The image-only association catalog contains names, identifiers and core icon paths;
it is compiled from supplied native image metadata and Plutonium icon mappings.
The association catalog requires no Plutonium or AI inference. Online imports
use the 5etools CDN; native system mechanics are not fetched from online SRDs.
All conversion code is original to BCC. Native system enum labels may be read
locally to match tool and weapon proficiency keys; their item mechanics are not
used as conversion fallbacks.
Source-folder colors are metadata from the 5etools source-color palette.

The public release assets are named `module.json` and
`book-compendium-converter.zip`. A development ZIP can be installed manually
before a release is published; the `latest` links continue to refer to the
published release.

- Manifest: https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/module.json
- ZIP: https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/book-compendium-converter.zip

## Import into world compendiums

1. Open **Book Compendium Converter** at the top of the **Compendiums** sidebar.
   The console fallback is `game.bcc.open()`.
2. Search by book name or abbreviation, select the target rules, and click **Analisar livro**. The preview includes local
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

## Export an installable content module

1. Click **Exportar** beside **Analisar livro** and **Criar compêndios**. The
   exporter is available even when the local 5etools source is unavailable.
2. Select the imported books, enter a module title, stable identifier and version,
   and click **Validar seleção**. Export reads the current saved compendium data,
   including manual edits; it does not rerun the source conversion.
3. Review the included documents and required supplier modules.
   Validation checks document references, supported embedded collections and
   media bytes. Missing references, unresolved resource targets and missing files
   block packaging. Mechanical completeness still requires gameplay testing.
4. Click **Gerar ZIP**. Extract the contained module folder into
   `FoundryVTT/Data/modules/`, restart Foundry, and enable the exported module in
   a D&D5e test world. This is a local/manual distribution, without a hosted
   update manifest. Exporting does not install or modify another world.

The ZIP contains a module manifest, native LevelDB packs, their internal folders,
deduplicated media, a validation report and a minimal resource-binding runtime.
Internal World-compendium UUIDs and media paths are remapped to the new module.
The D&D5e manifest flag registers the exported native spell lists. BCC, Plutonium
and the original 5etools data are not required in the destination world. Explicit
references to installed system/module packs remain external and required module
dependencies are declared in the manifest. Core/system artwork remains supplied
by Foundry/D&D5e; other referenced media is copied into the ZIP.

Validation freezes a read-only snapshot, including the checked media bytes.
Changes made after validation require validating again to include them. Export
does not synchronize existing character inventories. Export one or several
books per package; this version limits selected media to 512 MiB.

## 0.1.2 changes

### Character creation and class casting

BCC now serializes persistent Document data before making transaction copies.
Native compatibility accessors and live Proxy identities do not become part of
snapshots. An unsupported persistent value is reported with its data path before
the protected commit runs. The same normalization covers creation, level-up,
container copies and exported runtime support.

Casting profiles describe the source progression algorithm, explicit slot table,
spell-access model, preparation data and fixed spellbook acquisitions. Optional
Character Builder adapters interpret those profiles without changing class names
or native slot progression. Full-list, limited-selection and spellbook access
remain separate models. A source-defined casting-option table becomes a native
choice: its selected feature supplies the spell list and ability. Unknown or
unavailable lists are explicit errors, rather than a successful empty selection.
No Character Builder files are modified. Native class and spell ownership remain
with D&D5e and the Builder.

### Separate modules and dependency scope

For separate content modules, uncheck **Incluir dependências no pacote**, open
**Plano de módulos fornecedores**, review/edit each module ID and version, and
click **Confirmar plano de fornecedores**. Generate every supplier ZIP using
those exact destinations, then install and enable them in the destination World.
This permits supplements to be exported before their providers. Saving a plan
only records destinations; it does not generate or install the provider modules.
Changed supplier data invalidates its recorded fingerprint. Dependency cycles
are reported: export the involved books together or include their dependencies.

A genuine required document must exist in the importing World. Book-only import
does not manufacture an absent provider. Import the required publication or use
an appropriate foundational book with its dependencies; this does not require
copying that foundation into every supplement. Exporting reads persisted data
and never silently re-imports the online source to repair a missing document.

With **Incluir dependências no pacote** enabled, export follows required
documents, registered class-list pages, container trees and their folder
ancestors. It no longer copies every unused document from a supplier pack.
Embedded copies' provenance does not require packaging their original catalog
record. Unavailable narrative links become readable text; executable references
remain validated. Supplier packs receive default folders as well.

### Equipment, prerequisites and diagnostics

Magic-variant requirements are evaluated against source-qualified base records
before selecting an edition-compatible equivalent. Modern properties and mastery
are preserved; source-qualified variants are no longer silently omitted.

Initial random charges are stored separately from deterministic native capacity.
They are rolled once for each acquired physical instance, including separate
units in a batch. Initialized copies, transaction transfers and rollback do not
reroll. When source and supplemental Activity pools conflict, their definitions
remain in metadata and the conflicting automatic consumption is withheld and
reported for manual adjudication; conditional killing/charge expenditure is not
invented. Independent, unambiguous pools keep their own behavior.

Source feat-category requirements and exclusivity use category metadata. The GM
may explicitly configure campaigns through **BCC · Política de campanha**. Actor
qualification can be set through `game.bccRuntime.setPrerequisitePolicy(actor,
policy)`, available to the GM. A policy can contain `campaigns`, `renown` keyed by
the source organization identifier, and `featCategories` keyed by Item ID for
otherwise unclassified feats. Policies are stored in GM-controlled World settings;
Actor flags alone cannot establish qualification. Installing a book never establishes campaign or
renown eligibility. Missing policy data remains an explicit review requirement.

A sole anonymous supplemental Effect can be associated with a sole referenced
Effect ID when there is exactly one possible non-transfer definition. Multiple
candidates remain unresolved. This repairs missing associations without creating
new mechanical effects or applying reading/training benefits immediately.

Import diagnostics group repeated causes and put pending reconciliation from
other publications in a separate section. Export diagnostics summarize supplier
problems and retain affected document names in the JSON report.

**Updating from 0.1.1:** rebuild affected BCC documents and regenerate **all active
BCC content-module ZIPs** before character tests. Previously exported modules
have their own runtime; updating BCC alone does not replace those copies. Old
exports active alongside new ones are reported. Existing Actors are not
synchronized. Folder defaults may require reopening the World after first
activation; BCC does not reset the GM's compendium organization.

Validation covers source-free regressions, real source conversion graphs,
Character Builder service creation/save and selected level-up contexts, separate
and standalone exports, and native LevelDB round trips. This is automated
integration coverage, not a live Foundry gameplay certification. Missing upstream
Martial Arts rider Activities and the Focused Strike Effect remain explicit.

## 0.1.1 changes

### Level-up transactions and prerequisites

BCC validates new acquisitions against the complete confirmed draft before the
live Actor is changed. Its creation guard uses the same projected Item set
while Character Builder materializes the batch, instead of inspecting a
transiently empty Actor. Captured rollback Items are checked against the
original snapshot; restoration preserves original class identity. Acquired
features being retained are not treated as newly selected features. Safety
locks and snapshot verification remain enabled. BCC integrates the public
creation/level-up commit services without modifying Character Builder files.

Armor/shield and simple/martial weapon proficiency predicates are evaluated
against native Actor traits. The recognized special-acquisition sentence form
is compiled into a class-level plus feature predicate. Unrecognized operators
remain explicit review requirements. These rules use source structure rather
than specific feat, spell, class or book names.

### Import a book with or without external dependencies

The **Incluir dependências de outros livros** checkbox defaults to on. Turn it
off and analyze again to import the selected publication without copying the
external catalog into its packs. The analysis lists external source books and
available, missing or ambiguous providers. A matching provider must have the
BCC source identity and compatible rule metadata; bundle components are not
catalog templates. Confirmed references are reused; unresolved mechanical
references remain reported until the supplying book is imported. Ordinary
unavailable narrative links are rendered as text.

Importing a supplying book reconciles declared BCC compendium links. Existing
Actor inventories are not synchronized. Existing dependency copies from older
imports are not deleted by this checkbox; use a fresh test World to compare
clean organization. A book may require more than PHB: some AU items reference
XMM summon profiles. The dependency list reports what the source actually uses.

### Export separate or combined modules

The exporter suggests the module title, identifier and ZIP name from the
selected source abbreviations, such as `bcc-xphb` or `bcc-au`. Multiple selections
produce a stable combined suggestion. Fields remain editable; manually edited
fields are preserved when the selection changes.

The exporter has its own **Incluir dependências no pacote** checkbox. Leave it
on for a self-contained package. To export separate providers and supplements,
export the providers first, then turn it off for the supplement. BCC records the
provider's module ID, pack address and document fingerprint in the World. It
remaps supplement references and declares the required modules in the manifest.
If provider documents changed, re-export the provider before the supplement.
Install and enable all declared providers in the destination World.

A combined export consolidates mechanically equivalent BCC catalog copies and
remaps references. Divergent manual edits remain separate and are reported.
Container instances and their sibling contents remain independent; deduplication
does not merge physical inventory trees.

### Conditional spells, resources and reports

Source `prepared.sN` recipes generate native ItemGrant Advancements with an
explicit slot-level condition. Optional entries prevent consumers unaware of
that condition from granting spells early. BCC's included runtime reconciles
eligible grants using native available slot levels, keeps spells **Always
Prepared**, and records native grant ownership and `value.added`. Spent slots
still count by their maximum; both ordinary slots and Pact Magic are considered.
The same support ships in exported modules. These are not character-level-N
Advancements. Unsupported conditional spell choices remain reported.

Actor-dependent consumption references can remain intentionally deferred until
an unambiguous resource exists on the receiving Actor. Missing, ambiguous or
stale bindings block Activity use. Shared daily/rest spell groups on NPCs now
use a single embedded native pool; `each` groups retain individual pools.
Variant tokens inherit the declared base identity unless a specific token is
provided. Image 404s remain failures even when a later fallback fills the field.
The report separates persistence, unresolved references, partial mechanics,
source definition gaps and recovered image failures.

**Remaining source gaps:** the supplied XPHB supplement references an absent
`martialArts` rider Activity; AU references an absent `focusedStrike` Effect.
Inspection of the supplied official modules also found the corresponding
unresolved references. BCC retains the available enchantment/Activity and
reports the gap; it does not invent the missing definition or remove the alert.

For this revision, rebuild affected BCC compendium documents and regenerate
content-module ZIPs. Previously exported modules contain their own runtime;
updating BCC alone does not replace it. Restart Foundry after updating modules.
A character already safety-locked requires inspection/restoration from its
preserved backup before further advancement tests.

Validation includes source-free transaction, prerequisite, grant and export
regressions in CI; real XPHB/AU/EFA/TCE conversion graphs; clean/separate/combined
export scenarios; and native LevelDB reads. Browser/gameplay homologation in a
running Foundry instance remains required.

## 0.1.0 changes

- Online JSON and artwork are the default. Fresh installations need only BCC,
  Foundry/D&D5e and internet access. Source failures include the affected path;
  malformed online data is rejected rather than silently used as partial JSON.
- SHA-256 uses WebCrypto where available and a matching fallback otherwise.
  Deterministic IDs and fingerprints remain the same on HTTP remote sessions,
  avoiding the localhost-only dependency on `crypto.subtle`.
- Source `packContents` becomes native containers with separate, linked Item
  instances. Starting equipment links the complete bundle. Shared components
  have independent IDs in each pack. The grouping container contributes only
  any unallocated declared source weight; physical components are not counted
  twice. The package purchase price and component catalog prices are preserved
  separately as source data. Literal components without standalone statistics
  keep their supplied names/quantities and are reported for review.
- Native container acquisitions with multiple units become independent trees,
  including when a consumer sets the count in `createWithContents`.
- Structured prerequisites are compiled to a versioned logical expression.
  Spell references and filters, class/character levels, ability conditions and
  alternatives are evaluated from data. Unknown conditions remain explicit
  review items and cannot silently enable a choice. No feature-name exception
  produces the eligibility result.
- An optional adapter connects the provided Character Builder Level Up service
  to that evaluator. It evaluates owned and projected spell acquisitions before
  commit; damage, attack, range and acquisition-class requirements remain in
  effect. The adapter does not modify or bundle Character Builder source code.
- Exported modules include the original standalone prerequisite/container
  support, with no BCC dependency. Container parent IDs and cycles are checked
  during export validation.

Reimport/rebuild affected books to regenerate their data. Existing Actor
inventories are not synchronized. Rebuild replaces matching imported documents,
including manual edits; keep those edits in an exported snapshot when needed.
The preserved **v0.0.11** tag and release assets remain the last local-first
baseline. Installing an older module does not roll back a World's documents.

Validation includes complete XPHB/EFA/TCE conversion-to-export graphs and native
LevelDB reads, source-derived prerequisite positive/negative cases and projected
Level Up inputs, nested container cloning, unchanged ID/fingerprint tests, UI
DOM behavior and prior mechanics/persistence regressions. Live CDN tests read
XPHB and EFA with no local source data or images and validate artwork bytes;
Foundry's upload API is mocked in that test. End-to-end Foundry/Character Builder
interaction still requires live testing. Conversion reports may retain genuine
source gaps and unsupported mechanics; this release does not claim full rules
coverage for every publication.

## 0.0.11 changes

- Adds the exporter above, with three equally sized main action buttons and a
  dedicated selection/review screen. It creates fresh native LevelDB files in
  the browser instead of copying database files that the server has open.
- Removes all BCC World-compendium and folder deletion menu hooks. Foundry's
  own controls are unchanged; BCC no longer adds cleanup actions.
- Explicit multi-channel cantrip scaling tables produce separate manual damage
  Activities with native level scaling. Weapon-hit damage and movement/secondary
  damage stay separate; follow-up rolls do not cast the spell again. This covers
  the supplied Booming Blade and Green-Flame Blade records through their data
  structure, without name-specific conversion rules.
- Explicit slot-scaled feature damage with a conditional creature bonus and
  declared caps produces two alternate Activities sharing the source's slot
  consumption rules. This covers the PHB Divine Smite feature without turning
  it into the mechanically different XPHB bonus-action spell.
- Structured consumption targets now resolve both explicit entity UIDs and named
  resource pools to unique Items before creating Actor bindings. Ambiguous or
  missing definitions remain reported; the exporter blocks unresolved targets.
- The supplied Booming Blade supplemental definition contains only one damage
  Activity. The original scaling metadata provides both channels; BCC now uses
  that metadata to complete the conversion.

Tests open generated databases with a native ClassicLevel reader, check ZIP
extraction, UUID/media remapping, preservation of manual edits, dependency
closure across complete XPHB/EFA/TCE conversions, standalone resource binding
and rejection of broken content. Cantrip
damage tables are checked at levels 1/5/11/17; conditional slot damage is checked
at slot levels 1/2/4/9. Reimport affected books to regenerate damage Activities
and resource references; export preserves saved documents as they are. Live installation and gameplay in Foundry remain pending.

## 0.0.10 changes

- Explicit, unconditional fixed AC bonuses on feature documents become native
  transferable Active Effects. Existing source effects take precedence and
  prevent duplicate bonuses. Conditional or activated AC benefits are not
  converted into permanent bonuses; unsupported cases remain reported.
- A supplemental class's own spells no longer suppress its core spell-list
  dependencies. The supplied EFA Artificer graph now includes 80 linked spells,
  including 17 cantrips and 14 first-level spells. The native `artificer`
  progression is preserved; Character Builder's progression support is separate.
- Object and vehicle cargo uses the native `tn` weight unit. Preflight observes
  non-throwing native preparation errors as failures and releases its error
  listener after each document. Effect durations use current value/unit fields.
- Target rules can preserve all source variants or prefer 2014/2024 variants.
  Compatibility copies are classified by their parent class rules. For 2024,
  initial subclass choices, grants, spell choices and scales are delayed to
  class level 3; later levels remain unchanged. This is subclass compatibility,
  not a complete rewrite of every legacy base-class mechanic. Source provenance
  remains recorded separately. Both source variants are labeled when retained.
- Species variants which differ in one named feature and supported trait fields
  become exclusive native feature choices on one species. Each option carries
  its own proficiencies or sense effect. This includes Custom Lineage's
  Darkvision versus Skill Proficiency without granting both benefits.
- Artwork resolution supports short fluff identities, explicit fluff aliases
  and declared copy ancestry. Actors can use their declared local token when
  portrait art is absent. Embedded monster features prefer monster-feature
  icon sources; optional features can inherit an unambiguous owning class's art.
- Explicit summon stat-block references can supply native Actor profiles when
  a source supplement has no profile. Summon scaling, commands and lifecycle
  remain subject to live validation; no unspecified formulas are invented.
- Books are searchable and alphabetized. Imported folders use source colors;
  level folders use numeric ordering, including managed folders on reimport.
  Dependency reasons remain included in the report for review.

Validated offline generation across XPHB, EFA, AU and TCE, plus targeted effect,
variant, spell-list, summon-reference, folder-order, error-capture and persistence
regressions. These checks do not execute the native Foundry or Character Builder
UI. The supplied PHB Witch Bolt effect reference and two Martial Arts activity
riders still lack complete source definitions and remain reported. They are not
filled from mechanically different versions.

For a clean comparison, import into a fresh test world. Rebuild does not remove
obsolete variants or dependencies already written by earlier versions. Existing
characters are not automatically updated. The multi-book cleanup interface is
deferred.

## 0.0.9 changes

- Compendium image indexes request the complete `system.source` object rather
  than conflicting nested fields. Binary image signatures are checked at byte
  offsets, including WebP headers containing non-UTF-8 length bytes.
- An image-only association catalog supplements installed compendium indexes.
  Matching uses native document type, name/identifier, rules and parent context;
  ambiguous results remain reported. It reuses core `icons/` files without
  requiring Plutonium or enabling a premium content source. These associations
  select artwork only; they do not supply mechanics or expand imported sources.
- Class/subclass, background and species portraits prefer their supplied local
  illustrations. Spells and features prefer specific icons before inherited
  parent illustrations. Species-derived features retain their base-species
  image identity, including complete variants. No species flow is reorganized.
- Image reporting includes coverage per document category, provider, inherited
  portraits, category fallbacks and failed sources. Reimports can replace a
  previous fallback while reusing the shared deterministic asset cache.
- Open equipment categories are bounded to the selected book, the declared
  parent context and one rules-compatible base-equipment catalog. Namespaced
  weapon properties and textual item filters become native proficiencies.
- Explicitly named physical resources created by a source rest rule can become
  standalone Items, with links back to their creating feature. Creation remains
  consumer-managed: BCC does not add another acquisition grant. This supplies
  the Book of Shadows represented in the XPHB source. The corresponding native
  document type comes from reference metadata, not a name-specific code branch.
- Structured point pools supply uses/recovery. Resource-priced spell recipes
  become linked Cast activities whose resource IDs bind when embedded in an
  Actor. A missing effect may be recovered only when a save explicitly refers
  to it and the source defines one unambiguous, registered condition.
- GM folder menus add **Excluir pasta e todo o conteúdo** both inside World
  compendiums and on sidebar folders containing World compendiums. Confirmation
  names the target and counts its contents, requires a checkbox and revalidates
  the scope. System/module packs are blocked, unrelated contents remain, and
  internal-pack lock state is restored. Individual World-pack deletion remains.

Local data and images remain the source; no migration to an online provider is
included. Existing Actor inventories are not synchronized. Reimport in a fresh
test world, or explicitly remove old World packs before importing: rebuild
does not prune obsolete dependencies from older versions.

Two XPHB Martial Arts rider references have no Activity definition in the supplied
supplement. The enchantments and their defined effects are retained, and the
missing riders remain explicit in the report. Full live character creation,
level-up and combat validation remains pending; static checks are not live QA.

## 0.0.8 changes

- Native Item and Actor icons are resolved from explicit source image metadata,
  matching installed compendium index entries, supplied local artwork metadata,
  and native type/school/category fallbacks. Only image metadata is reused;
  mechanics continue to come from the selected local source data.
- Images are copied into **FoundryVTT/Data/assets/srd5e/** using the native
  FilePicker API. Documents store **assets/srd5e/** paths. A deterministic
  SHA-256 filename derived from the image origin permits reuse across imports,
  books and worlds without downloading the original again. Existing asset files
  and originals are preserved.
- Coverage includes Items, Actor portraits, embedded Items, Activity and effect
  images, and explicit token images (with portrait fallback). Source matching
  uses type, identifier/name, source, rules and available class context; ambiguous
  matches fall back rather than selecting an arbitrary image.
- Image payload types/signatures, upload responses and persisted paths are
  checked. The progress bar covers image work, and the JSON report includes
  copied/reused files, fallback fields, unavailable sources and ambiguities.
- Localized fields retain provenance under `flags.bcc.assets`. The collection
  helper produces paths and `assets/<filename>` destinations for a future
  module exporter. The exporter itself remains a later development phase.
- Additional spell recipes now share one source-driven timing policy. Choices
  tied explicitly to a resource conjured after rest are retained as deferred
  data, without adding acquisition ItemChoices. This removes the extra native
  queue for Pact of the Tome while allowing Character Builder's own flow.
- Additional class cantrips represented by native derived scales use transfer
  effects instead of a second spell selector. This covers the source patterns
  used by Thaumaturge and Magician without branches for those names. Existing
  scale effects take precedence; conflicting values remain reported.
- Equivalent native spell choices share their progression buckets. Feat/feature
  acquisition choices use level 0, while later thresholds remain intact. Native
  choices such as Magic Initiate, Fey-Touched and Ritual Caster are preserved.

### Artwork source and reuse

The destination is fixed at `Data/assets/srd5e`; it is shared rather than nested
inside a particular world. Installable module ZIPs contain no artwork.

Installed system/module icons can be copied immediately. For illustrations
referenced by 5etools data, supply the corresponding image files separately at
`Data/bcc/5etools/img/`, or set **Source artwork directory or URL** in the BCC
module settings to the appropriate image root. Remote origins require browser
access/CORS support; unavailable images fall back to installed/native icons.
Three transport failures suspend that remote provider for the current import.

Re-import with **Update unchanged BCC** or **Rebuild** to apply images to existing
BCC documents. **Add missing** preserves existing documents. Updating the module
alone does not change existing documents or actors. Rebuild replaces matching
BCC document data, including local changes, and still does not prune obsolete
records. Reimports reuse saved files when the same source image is encountered.

Deferred choices retain their counts, pools, spell configuration and timing as
data. BCC does not supply a universal rest-choice UI; consumers still need to
handle the corresponding mechanic. Genuine native Advancement choices remain
interactive where required. Full Journal illustration/layout import is outside
this icon patch.

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
BCC. The exporter includes the required original runtime in generated content modules.

Development checks exercise source contracts, document blueprints, dependency
graphs and a mocked persistence transport. They do **not** execute Foundry's
native DataModels, Character Builder workflows, combat rolls or rest recovery. Image tests use mocked file/index transports, not a live Foundry server.
The importer performs native schema preflight when run inside Foundry.
For 0.0.8, static generation covered XPHB, Eberron: Forge of the Artificer,
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
- Compound attacks, follow-up saves, alternative damage, weekly recovery, unusual item recipes and vehicle station mechanics
  may require manual work. Ambiguous damage is not automatically summed.
- Native supplements take priority over inferred activities. A supplement can
  still leave source mechanics incomplete; such cases are reported.
- Full Journal illustration/layout reproduction, implicit token lookup,
  every copy/modification mode and every supplement are not guaranteed.
- Books represented only by unstructured prose cannot automatically become
  complete mechanical records. Missing structured data is reported.
- Export validation checks package structure and files, not complete rules
  automation. Live installation and character workflows require testing.

## Development and distribution

Every version requires a discussed and approved scope before implementation.
Once an approved version is prepared, publish its source and GitHub release
automatically so it can be installed through Foundry for testing. Publication
does not establish end-to-end validation. Direct online source import remains
deferred; the exporter uses persisted World compendiums.

Public source and release ZIPs must exclude book text, official mechanical
records, artwork, third-party conversion code, test files, fixtures and QA data.
The image association catalog contains metadata only. Release archives contain only
`module.json`, `README.md`, `LICENSE`, `scripts/` and `styles/`.

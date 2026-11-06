# Book Compendium Converter — 0.1.3 experimental

Native World compendium import and installable content-module export for
**Foundry VTT 14.369 / D&D5e 6.0.6**.

- [Repository](https://github.com/hammer-PvP/Book-Compendium-Converter)
- [Installation manifest](https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/module.json)
- [Module ZIP](https://github.com/hammer-PvP/Book-Compendium-Converter/releases/latest/download/book-compendium-converter.zip)

## Import

Open **Book Compendium Converter** in the Compendiums sidebar as GM. Search for a
book, select destination rules, **Analisar livro**, then **Criar compêndios**.
Download the JSON report to review coverage and pending mechanics.

Every book publishes only its own content. There is no dependency-copy option.
Supplements reference their supplying classes, spells and other resources;
they do not copy them or their entire class spell lists. Missing supplying books
are declared requirements and do not block World import or ZIP generation.

Default **5etools online** reads current JSON/artwork from
`https://cdn.5e.tools/2024/`. Analysis/import requires Internet access, without a
separate server, Plutonium installation or manually downloaded source collection.
Each session records source fingerprints; the mutable CDN is not an atomic release
snapshot. Optional local mode reads `Data/bcc/5etools/data/`, with artwork under
`bcc/5etools/img` or the configured override. Development fixtures: 5etools 2.39.0.
Resolved images are stored under `Data/assets/srd5e/` and reused by byte hash.

**Add missing** preserves existing data. **Update unchanged BCC** preserves local
edits by fingerprint. **Rebuild** replaces matching BCC data, including its manual
edits, after confirmation. It also removes obsolete, unedited dependency copies
from this book; edited copies and containers with edited contents are preserved
and reported. It is not a World cleaner and does not synchronize Actor inventories.

## Export

Click **Exportar**, select books and review the suggested ID/title/version.
Optional supplier plans assign customized destinations. **Validar seleção** reads
persisted data, including edits; **Gerar ZIP** packages the validated snapshot.
Extract the folder into `FoundryVTT/Data/modules/`, restart Foundry and activate it.

Suppliers do not have to exist locally or have been exported already. Each ZIP
contains only the selected books, native LevelDB packs/folders, saved media,
validation report and original support runtime. BCC, Plutonium and source JSON
are unnecessary in the destination World. Install/enable the supplying books and
their consumer source packs before using features that reference them.

External book identities are resolved against active BCC libraries, including
custom module names. Multiple providers remain ambiguous. Requirements appear in
the report and manifest (`flags.bcc.requiredBooks` and module recommendations),
allowing unrelated content to activate. Missing local documents, unidentified
executable references, invalid resource targets and invalid media still block
packaging. A missing supplier is not an invented or empty granted resource.

Checkbox changes and validation preserve scroll and selections. Only successful
ZIP generation clears selections and returns to the top. Failed generation keeps
state. Revalidate to include later edits; media is limited to 512 MiB per export.

## Generic feature interpretation

Source structure and Foundry supplements precede bounded prose interpretation.
Rules apply to species, class/subclass features, feats and optional features;
entity/book names do not select special fixes.

- Fixed initial cantrips and optional rest replacements are separate. Supported
  prose/filter patterns retain initial grants and casting ability. Compatible
  catalogs supply replacement candidates.
- Structured proficiencies and supported mixed skill/tool/language choices become
  native Trait advancements. A skill-or-tool rule is a single choice.
- Supported replacements have utility Activities. Complete a Long Rest, then use
  the feature's replacement Activity if desired. Creation/level-up cannot unlock
  it. Ownership and casting ability are preserved; ambiguous/shared grants and
  expertise loss require manual review.
- Source effects/Activities retain precedence. Gated passive analysis avoids
  turning conditional bonuses into unconditional effects. Random multi-rest
  recovery remains manual and is reported; save-success replacement resources
  do not ask the user to roll the failed saving throw again.
- Reports record recognized patterns, representation counts and unsupported
  clauses. Arbitrary or contradictory prose is not certified as full automation.

Homogeneous ammunition lots use native consumable quantities, unit weight/price
and variant properties. They do not become containers holding ordinary ammo.
Mixed kits retain native physical contents. Physical contents are distinct from
republishing another book's catalog.

Class data retains ASI levels, spell-list pages, casting profiles and equipment.
Subclasses reference their supplying classes. Optional consumer adapters do not
modify Character Builder files. Random charges, source-derived prerequisite
policies and resource bindings remain supported with explicit coverage limits.

## Updating and validation

Update BCC, restart Foundry and refresh the browser. Reanalyze/rebuild affected
books and regenerate all active BCC library ZIPs. Previously exported libraries
contain their own runtime. Existing Actors are not automatically migrated.
Reload the World after rebuilding and reselect the intended Builder source packs.

Automated checks cover structure, source conversion, isolated export without
suppliers, portable identities, native LevelDB reads, rest gating/ownership,
UI state and Character Builder service interfaces (reference 0.9.921). They do
not run a live Foundry server or certify complete gameplay. Native schema checks
run during import in Foundry. Complex damage, conditions, absent definitions,
unusual recovery and arbitrary prose can require manual work; findings remain
visible. Use a GM laboratory World before campaign deployment.

BCC ships original conversion/runtime code and image-association metadata only.
Releases contain `module.json`, `README.md`, `LICENSE`, `scripts/` and `styles/`.
Book records/text/artwork, third-party conversion code, tests, fixtures and QA
files are excluded from release archives.

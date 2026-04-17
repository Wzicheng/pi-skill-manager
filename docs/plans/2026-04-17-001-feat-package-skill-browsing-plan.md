---
title: feat: Reorganize skill browsing around package groups
type: feat
status: completed
date: 2026-04-17
origin: docs/brainstorms/2026-04-17-001-package-based-skill-browsing-requirements.md
---

# feat: Reorganize skill browsing around package groups

## Overview

Change `pi-skill-manage` so `/skills-zh` defaults to package-oriented browsing instead of the current hardcoded functional categories. Package identity will be inferred read-only from `SlashCommandInfo.sourceInfo.path` using a hybrid strategy: recognize known bundle patterns first, then fall back to source-root heuristics, and finally place ambiguous skills into `other`. The same package model will also drive package-level translation coverage and untranslated reporting while preserving direct single-skill lookup through `/skill-zh`.

## Problem Frame

The current browsing model is optimized for functional discovery, but the origin document makes clear that the primary user behavior is package-oriented exploration after installation (see origin: `docs/brainstorms/2026-04-17-001-package-based-skill-browsing-requirements.md`). Users want to answer “what did this newly installed package give me?” rather than mentally reconstruct package membership across broad capability buckets.

Today the extension already has the source-path data needed for detail display, but it does not use that information to organize the top-level browsing and status flows. This creates a mismatch between installation reality and browsing structure. The planned change addresses that mismatch without requiring upstream skill metadata changes and without expanding the command surface.

## Requirements Trace

### Browsing Model

- R1. `/skills-zh` defaults to package-oriented browsing.
- R3. The package view exposes all skills belonging to an inferred package and shows translated descriptions when available.
- R5. Direct single-skill lookup remains available through `/skill-zh`.
- R6. The command surface stays minimal, with `/skills-zh` remaining the primary entry point.

### Package Inference

- R2. Package grouping is inferred automatically from installation source or directory structure.
- R7. Ambiguous or unrecognized skills remain visible under `other`.

### Reporting

- R4. Translation status and untranslated reporting become package-oriented.

## Scope Boundaries

- No upstream skill metadata requirements.
- No manual package override UI or config in this iteration.
- No redesign of translation quality or model behavior.
- No preservation of the legacy functional-category browsing mode.
- No cache schema rewrite unless implementation reveals the existing per-skill cache cannot support package reporting cleanly.

## Context & Research

### Relevant Code and Patterns

- `extensions/index.ts` contains the full extension implementation, including command registration, UI selection flows, cache access, refresh status tracking, and current categorization logic.
- `pi.registerCommand("skills-zh", ...)` already multiplexes subcommands (`refresh`, `all`) and otherwise shows a top-level selection UI; this is the natural place to swap the first-level model from categories to packages.
- `showSkillSelection(...)` and `showSkillDetails(...)` already implement a two-step browse flow: choose a group, then choose a skill, then inspect bilingual details.
- `showSkillDetails(...)` currently exposes `skill.sourceInfo.path`, which confirms path data is available at browse time and can support package inference.
- `skills-zh-status` already calculates translated vs untranslated sets from the current per-skill cache, so package-level reporting can likely be derived rather than requiring an immediate cache format change.
- Current grouping is driven by `CATEGORIES`, `categorizeSkills(...)`, `getCategoryForSkill(...)`, and `findCategory(...)`; these are the main seams to replace or remove.
- The repo currently has no automated tests and no existing `docs/solutions/` institutional learnings.

### Institutional Learnings

- No `docs/solutions/` directory or prior learnings were present during research.

### External References

- None used. The codebase is small, self-contained, and already exposes strong local patterns for command registration and UI flow.

## Key Technical Decisions

- **Introduce a package inference layer instead of inlining path parsing inside command handlers:** This keeps package naming rules, fallback behavior, and reporting consistent across `/skills-zh`, `/skills-zh all`, `/skills-zh untranslated`, and `/skills-zh-status`.
- **Keep cache storage per skill for now:** Package status can be derived from per-skill cache entries at read time. This satisfies the current scope with lower carrying cost than a package-level cache migration.
- **Preserve `/skill-zh` unchanged except for package label display:** Direct lookup already solves the known-skill use case and should remain independent of the new top-level browse model.
- **Replace, not supplement, the category system:** The origin document explicitly removes the legacy category view, so the plan should delete category-oriented helpers rather than layering a parallel mode on top.
- **Use stable user-facing labels rather than raw paths:** The requirements explicitly reject exposing filesystem details as the main package identity; ambiguous cases go to `other`.

## Open Questions

### Resolved During Planning

- **Should package-oriented reporting require a new cache schema?** No. The current cache is keyed per skill and already contains enough information to compute package coverage on demand; keep the existing schema unless implementation uncovers a hard limitation.
- **Should the package inference rules be centralized?** Yes. A shared helper layer reduces drift between browsing, status, and untranslated reporting.

### Deferred to Implementation

- **Exact known-pattern list for external bundles:** The implementation may refine recognizable patterns once real `sourceInfo.path` samples are inspected during coding.
- **Final label normalization details:** Exact formatting rules for package labels, including casing and path-segment cleanup, can be finalized when implementation sees real package names.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
registered skills
  -> shared package inference helper
      -> known pattern match? use stable bundle label
      -> else source-root heuristic? use normalized root label
      -> else use "other"
  -> group skills by inferred package
  -> derive per-package counts from translation cache
  -> feed grouped data into:
       - /skills-zh default package picker
       - /skills-zh all package-expanded summary
       - /skills-zh untranslated package-oriented drilldown
       - /skills-zh-status package coverage summary
```

## Implementation Units

- [x] **Unit 1: Replace category grouping with centralized package inference**

**Goal:** Introduce a single package-grouping model that all command flows can reuse.

**Requirements:** R1, R2, R7

**Dependencies:** None

**Files:**
- Modify: `extensions/index.ts`
- Test: `tests/package-inference.test.ts`

**Approach:**
- Remove the hardcoded `CATEGORIES`-driven browsing logic from the primary flow.
- Add helper types and functions that infer package identity from `skill.sourceInfo.path`, recognize known source/bundle patterns first, then fall back to closest meaningful source-root labels, and finally collapse ambiguous cases into `other`.
- Add grouping helpers that return package objects with stable keys, user-facing labels, and sorted skills.
- Keep the inference read-only and derived entirely from currently available command metadata.

**Patterns to follow:**
- `getSkillCommands(...)` for creating sorted, reusable filtered skill lists
- `categorizeSkills(...)` as the structural pattern to replace with grouped summaries
- `showSkillDetails(...)` as proof that `sourceInfo.path` is already available in command flows

**Test scenarios:**
- Happy path — a skill path matching a known bundle pattern is grouped under the expected human-readable package label.
- Happy path — multiple skills from the same inferred package root are grouped together under one package entry.
- Edge case — a skill with a missing or empty `sourceInfo.path` is grouped into `other`.
- Edge case — two skills with different filenames but the same inferred source root resolve to the same package key.
- Error path — a malformed or overly generic path does not throw during grouping and instead lands in `other`.
- Integration — the package grouping helper returns stable ordering so package pickers and summary commands present the same package sequence across flows.

**Verification:**
- The extension has one shared package inference/grouping layer and no remaining dependency on functional category definitions for browse flows.

- [x] **Unit 2: Make `/skills-zh` and `/skills-zh all` package-first**

**Goal:** Change the primary browse commands to present package groups before individual skills.

**Requirements:** R1, R3, R6, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `extensions/index.ts`
- Test: `tests/skills-zh-browsing.test.ts`

**Approach:**
- Update the default `/skills-zh` flow so the no-argument path shows inferred packages with counts and translated coverage rather than functional categories.
- Keep existing subcommand routing (`refresh`, `all`) but change `all` output to render package sections instead of category sections.
- Add package-aware selection display strings that help users recognize a package at a glance, including package size and translated coverage.
- Preserve query-based direct skill search behavior where the user types a skill name, but stop supporting category-name matching.

**Patterns to follow:**
- Existing `skills-zh` command branching structure in `extensions/index.ts`
- `showSkillSelection(...)` two-step selection pattern
- Existing summary rendering in `showAllSkills(...)`

**Test scenarios:**
- Happy path — running `/skills-zh` with no arguments shows package groups, selecting a package shows only skills from that package, and selecting a skill shows the existing bilingual detail view.
- Happy path — running `/skills-zh all` outputs sections grouped by package and includes translated descriptions when cached.
- Edge case — if only one package exists, the browse flow still shows a valid package selection or predictable direct drilldown behavior without crashing.
- Edge case — packages with zero translated skills still appear with a clear untranslated indicator.
- Error path — a user query that no longer matches any skill or package returns a warning instead of silently falling back to category logic.
- Integration — selecting a skill from a package group still shows the underlying `sourceInfo.path` detail and does not break `/skill-zh` lookup semantics.

**Verification:**
- A user entering `/skills-zh` sees package groups first, and `all` output is package-oriented rather than category-oriented.

- [x] **Unit 3: Rework untranslated and status reporting around packages**

**Goal:** Make progress and untranslated views answer “what in this package is left to translate?”

**Requirements:** R3, R4, R6, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `extensions/index.ts`
- Test: `tests/package-status-reporting.test.ts`

**Approach:**
- Replace the current flat untranslated listing with package-grouped results so users can inspect untranslated skills within each inferred package.
- Extend `skills-zh-status` to include package-level coverage summaries alongside the existing global totals.
- Derive package counts from current registered skills plus per-skill cache presence; do not change the underlying cache file format unless necessary.
- Ensure the `other` bucket participates in totals and reporting so ungrouped skills remain visible.

**Patterns to follow:**
- `skills-zh-status` aggregate reporting style
- Existing cache access via `loadCache()` and `toSkillKey(...)`
- Existing untranslated derivation in the `skills-zh` command handler

**Test scenarios:**
- Happy path — `/skills-zh untranslated` groups untranslated skills by inferred package and allows drilling into a package-specific list.
- Happy path — `/skills-zh-status` includes overall totals plus package-level translated/untranslated counts.
- Edge case — a package with all skills translated appears with full coverage and no untranslated entries.
- Edge case — the `other` bucket is included in status output when ambiguous skills exist.
- Error path — if cache data is empty or missing, package status still renders with zero translated counts rather than failing.
- Integration — after a refresh populates cache entries, package-level status reflects the same translated set that single-skill detail views display.

**Verification:**
- Users can identify untranslated work and translation coverage per inferred package without reading a flat global list.

- [x] **Unit 4: Update help text, README, and command descriptions to match package-first behavior**

**Goal:** Align built-in command descriptions and external docs with the new package-oriented mental model.

**Requirements:** R1, R4, R6

**Dependencies:** Units 2 and 3

**Files:**
- Modify: `extensions/index.ts`
- Modify: `README.md`
- Test: `tests/documentation-alignment.test.ts`

**Approach:**
- Update command descriptions so `/skills-zh`, `/skills-zh all`, `/skills-zh untranslated`, and `/skills-zh-status` clearly describe package-oriented behavior.
- Refresh README capability and command sections to replace category-based wording with package-based browsing and package-level translation progress language.
- Keep examples simple and consistent with the final user flow.

**Patterns to follow:**
- Existing bilingual README style in `README.md`
- Existing inline command descriptions in `extensions/index.ts`

**Test scenarios:**
- Happy path — README command descriptions match the implemented package-oriented behavior of `/skills-zh`, `/skills-zh all`, and `/skills-zh-status`.
- Edge case — documentation still explains direct single-skill lookup without implying the old category browse mode exists.
- Test expectation: none -- documentation and inline description updates do not introduce standalone runtime behavior beyond alignment checks.

**Verification:**
- User-facing docs and command help no longer mention category-first browsing and consistently describe package-first behavior.

## System-Wide Impact

- **Interaction graph:** Package inference now sits between raw registered skill metadata and every browse/reporting surface: `/skills-zh`, `/skills-zh all`, `/skills-zh untranslated`, and `/skills-zh-status`.
- **Error propagation:** Path parsing or grouping failures must degrade to `other` instead of breaking command handlers or browse UIs.
- **State lifecycle risks:** The main risk is drift between inferred package grouping and per-skill cache-driven translation counts; keeping one shared grouping helper reduces that risk.
- **API surface parity:** `/skill-zh` remains a direct skill lookup path and should continue to work regardless of how package browsing evolves.
- **Integration coverage:** Cross-flow checks should prove that the same package inference result drives browse selection, all-output summaries, untranslated lists, status summaries, and detail views.
- **Unchanged invariants:** Translation refresh, cache reuse, failure logging, model selection, and single-skill detail rendering remain functionally unchanged apart from showing package-derived grouping context.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Real `sourceInfo.path` patterns are more varied than expected | Centralize heuristics, start with known patterns plus conservative fallback to `other`, and avoid throwing on unrecognized paths |
| User-facing package labels become too path-like or unstable | Normalize labels at the helper layer and prefer stable bundle names over raw directories |
| Package-oriented reporting diverges across commands | Reuse one grouping/counting layer across browse, `all`, untranslated, and status flows |
| Removing category browsing reduces discoverability for capability-oriented users | Preserve direct skill-name lookup and make package labels/counts descriptive enough to support scan-based discovery |

## Documentation / Operational Notes

- Update README examples to reflect package-first browsing terminology.
- No rollout, migration, or external operational work is needed because this extension is local-package based and uses existing cache files.
- If tests are added in this repo for the first time, document the chosen test harness briefly in README or package scripts as part of implementation.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-17-001-package-based-skill-browsing-requirements.md`
- Related code: `extensions/index.ts`
- Related docs: `README.md`
- Package metadata: `package.json`

---
title: Reframe skill browsing around package-based grouping
type: feature
status: active
date: 2026-04-17
---

# Reframe skill browsing around package-based grouping

## Overview

`pi-skill-manage` currently helps users browse registered skills, inspect bilingual descriptions, and translate English skill descriptions into Chinese. The current browsing model is primarily organized by functional categories. The desired change is to make package-based grouping the default browsing experience so users can understand a newly installed skill package as a coherent set, while preserving enough backward compatibility that existing translation and lookup workflows continue to feel familiar.

## Problem Frame

The current functional-category view is useful when users want to search by capability, but it does not match the most common discovery workflow for this extension: a user installs a new skill package and wants to quickly understand everything that package provides. In practice, users often explore skills in installation clusters such as CE skills, not as isolated commands spread across broad functional buckets.

This mismatch creates extra mental work:
- Users must infer which skills came from the same installed package.
- A package-level understanding requires hopping across multiple functional categories.
- Translation progress and untranslated-skill review do not naturally answer the question "what did this newly installed package give me?"

The product goal is to make package-level understanding the default mental model, especially for newly installed skill bundles, without requiring upstream skill authors to add new metadata.

## Users and Primary Use Case

### Primary user
- A Pi user who installs or updates a skill package and wants to quickly understand the package's commands in a familiar language.

### Primary use case
- After installing a package such as a CE skill bundle, the user opens `/skills-zh`, sees package groups, enters the newly installed package, and reviews all skills in that package with translated descriptions.

### Secondary use cases
- Inspect which skills in a package remain untranslated.
- Check translation coverage and status in a package-oriented way.
- Still inspect a single skill directly when the user already knows its name.

## Desired Outcomes

- Package-level browsing becomes the default experience.
- Users can understand a newly installed package as a coherent set of skills.
- Translation status and untranslated reporting become more useful for package-oriented review.
- The extension keeps command surface area small instead of introducing many parallel commands.

## Requirements

- R1. `/skills-zh` must default to a package-oriented browsing flow instead of the current functional-category-first flow.
- R2. Package grouping should be inferred automatically from installation source or directory structure; the system should not require new package metadata to exist on skill definitions.
- R3. The package view should help users browse all skills belonging to the same installed package, including translated descriptions when available.
- R4. Translation status and untranslated reporting should be reorganized so package-level progress is visible and useful.
- R5. Existing direct skill lookup for known skill names should remain available.
- R6. The design should stay minimal and avoid command proliferation; the preferred experience is to keep `/skills-zh` as the main entry point.
- R7. The feature should gracefully handle skills whose package cannot be confidently inferred.

## Scope Boundaries

### In scope
- Changing the default browsing information architecture from functional grouping to package grouping.
- Defining how package inference works from installation source or skill path.
- Updating package-level browsing presentation.
- Updating translation coverage and untranslated views to be package-oriented.
- Preserving direct single-skill inspection where appropriate.

### Out of scope
- Requiring upstream skill authors to add new metadata fields.
- Building a full manual package taxonomy editor in this iteration.
- Keeping or redesigning the legacy functional-category browsing mode; this iteration replaces it.
- Redesigning translation quality, translation prompt strategy, or model selection behavior.
- Changing how raw translations are produced beyond whatever is necessary to support package-oriented presentation and status.
- Expanding the command set significantly just to expose alternate browsing modes.

## Key Product Decisions

- **Default mental model:** Package grouping should become the default primary view because it matches the most common real-world exploration flow after installation.
- **Package inference strategy:** Use a hybrid strategy: recognize common source/path patterns first, apply path-based heuristics as a fallback, and place unrecognized or ambiguous skills into `other`.
- **Command strategy:** Keep `/skills-zh` as the main entry point rather than splitting behavior across several new commands.
- **Legacy category view:** Fully remove the current functional-category view in this iteration instead of keeping it as a secondary entry point.
- **Package labeling fallback:** When package identity cannot be inferred confidently, group the skill under a user-facing `other` bucket instead of exposing raw path details.

## Assumptions

- Skill command metadata already exposes enough source information to derive a useful package grouping in many cases.
- A meaningful package grouping can usually be inferred from source path patterns such as extension roots, installed package directories, or known bundle layouts.
- Common installed packages such as CE skills should be handled by explicit recognizable patterns when possible.
- If path-based inference is ambiguous or unreliable, `other` is preferable to a misleading package label.

## Package Inference Rules

Use a hybrid package inference model:

1. **Recognize common patterns first**
   - If the skill source path clearly belongs to a known installed package or bundle, use a stable human-readable package label for that bundle.
   - CE skills should be grouped together when the path/source pattern clearly indicates the CE skill set.

2. **Use path-based heuristics as fallback**
   - When no explicit known pattern matches, infer the package from the closest meaningful source root rather than from the individual skill filename.
   - Prefer labels that look like package or bundle names, not raw full paths.

3. **Use `other` for ambiguity**
   - If the source path is missing, malformed, too generic, or maps ambiguously to multiple possible packages, place the skill in `other`.
   - `other` is a deliberate safe fallback, not an error state.

4. **Keep inference read-only**
   - Do not require skill files or upstream package metadata to change.
   - Do not introduce manual grouping configuration in this iteration.

## Open Questions

### Resolve before planning
- None.

### Deferred / lower priority
- Whether package-level translation cache structure should change internally, or whether package-oriented reporting can be derived from the existing per-skill cache.
- Whether users should eventually be able to override inferred package names manually.

## Constraints

- The extension should remain simple to use and simple to maintain.
- All file references in follow-up planning documents should stay repo-relative.
- The design should prefer low ongoing carrying cost over speculative flexibility.

## Success Criteria

- A user who installs a new package can open `/skills-zh` and immediately understand which grouped commands came from that package.
- A user can review translated descriptions for all skills in that package without switching across unrelated category buckets.
- Package-oriented progress reporting makes it obvious which skills in a package still need translation.
- Skills that cannot be confidently assigned still remain discoverable and appear under a stable `other` package bucket.

## Risks to Watch

- Package inference may be noisy if source path conventions vary widely.
- Raw path-derived labels may feel too technical or unstable for end users.
- Removing functional grouping entirely could reduce discoverability for users who think in terms of capability rather than package.
- Package-oriented status views may expose cache-model mismatches if the current cache is too skill-centric.

## Sources & References

- Related code: `extensions/index.ts`
- Related docs: `README.md`
- Package metadata: `package.json`

# Site Content Firestore Schema

Phase 1 contract for Admin-Managed Public Website Content
(`Hakkımızda` / `Hizmetlerimiz` / `İletişim`).

This document defines the security-aligned data paths and field contract only.
It does not create live documents, UI, public renderers, or seeded content.

## Supported Page Keys

- `about` — Hakkımızda
- `services` — Hizmetlerimiz
- `contact` — İletişim

Only these three fixed page IDs are allowed by Firestore Rules.

## Draft Paths

`siteContent/{pageKey}/draft/current`

Examples:

- `siteContent/about/draft/current`
- `siteContent/services/draft/current`
- `siteContent/contact/draft/current`

## Published Paths

`siteContent/{pageKey}/published/current`

Examples:

- `siteContent/about/published/current`
- `siteContent/services/published/current`
- `siteContent/contact/published/current`

Parent documents under `siteContent/{pageKey}` are not required and are not granted permissions.

## Draft Document

Required conceptual fields:

| Field | Type | Notes |
|-------|------|--------|
| `pageKey` | string | Must equal path `{pageKey}` (`about` \| `services` \| `contact`) |
| `schemaVersion` | number | Currently `1` |
| `content` | map | Structured page body (see Content Map) |
| `updatedAt` | Firestore timestamp | Last draft save |
| `updatedBy` | string | Super Admin UID |

## Published Document

Required conceptual fields:

| Field | Type | Notes |
|-------|------|--------|
| `pageKey` | string | Must equal path `{pageKey}` |
| `schemaVersion` | number | Currently `1` |
| `content` | map | Frozen public snapshot of validated draft content |
| `publishedAt` | Firestore timestamp | Last successful publish |
| `publishedBy` | string | Super Admin UID who published |

## Content Map

Planned structured fields inside `content`:

| Field | Type | Notes |
|-------|------|--------|
| `title` | string | Page title |
| `subtitle` | string | Optional supporting line |
| `seoTitle` | string | Document `<title>` / SEO title |
| `metaDescription` | string | Meta description |
| `sections` | array | Array of structured section maps |
| `ctaButtons` | array | Array of structured CTA maps |
| `disclaimer` | string | Where applicable (e.g. informational footer note) |

No raw HTML blobs. No inline scripts, event handlers, or inline CSS.

## Section Model

Each entry in `content.sections` is a map with planned fields:

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Stable section id within the page |
| `type` | string | One of the allowed section types below |
| `heading` | string | Section heading text |
| `paragraphs` | array of string | Body paragraphs |
| `items` | array of string | Bullet / benefit items when applicable |

Allowed planned section types:

- `hero`
- `text`
- `list`
- `benefits`
- `ctaGroup`
- `disclaimer`

## CTA Model

Each entry in `content.ctaButtons` is a map with planned fields:

| Field | Type | Notes |
|-------|------|--------|
| `label` | string | Button label |
| `href` | string | Destination URL |
| `kind` | string | Presentation hint (e.g. primary / secondary) |

Planned allowed URL schemes:

- Internal root-relative paths beginning with `/`
- `https://`
- `mailto:`

Explicitly prohibited:

- `javascript:`
- `data:`
- inline HTML
- inline scripts
- inline event handlers
- inline CSS

URL allowlisting and structured DOM rendering are enforced in later UI/renderer phases; Phase 1 rules only gate access and require `pageKey` + `schemaVersion`.

## Access Summary (Rules)

| Path | Guest / public / student / institution | Super Admin |
|------|----------------------------------------|-------------|
| `.../published/current` | Exact `get` only | Exact `get`, `create`, `update` |
| `.../draft/current` | No access | Exact `get`, `create`, `update` |
| Collection `list` | Denied | Denied |
| `delete` | Denied | Denied (Phase 1) |

## Publishing Contract

Future behavior (not implemented in Phase 1):

1. Admin edits `draft/current`.
2. Saving a draft does not affect the public page.
3. Publishing copies the complete validated draft into `published/current`.
4. Public pages read only `published/current`.
5. Draft content is never rendered through a public URL.
6. Publishing must be atomic in the future UI phase.
7. Public rendering must use structured DOM APIs and `textContent`.
8. Admin-entered strings must never be injected through unrestricted `innerHTML`.

## Phase Boundaries

- Phase 1 contains no UI.
- Phase 1 contains no live documents.
- Phase 1 contains no public renderer.
- Phase 1 contains no content seeding.
- Phase 1 contains no deployment.

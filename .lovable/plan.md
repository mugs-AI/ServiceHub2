# WP2C-01 Map Buttons and Mobile Dashboard

## Implementation

- Add pure, tested map-link helpers that accept only successful GPS evidence with finite, in-range coordinates.
- Render compact `Map In` and `Map Out` external links only for coordinates already present in authorised attendance rows, choosing Apple Maps on iPhone/iPad and Google Maps elsewhere.
- Correct the administrator dashboard header so mobile shows a full-width identity block followed by a full-width 2×2 action grid, while preserving the compact desktop layout.
- Keep the workload table contained with local horizontal scrolling on narrow screens.

## Verification

- Extend focused attendance tests for URL validation, device selection, visibility, labels, and safe external-link attributes.
- Add a focused dashboard source contract for 320px/390px layout classes and desktop preservation.
- Run repository lint, typecheck, full tests, production build, and diff checks.
- Confirm no migration, generated types, routes, APIs, packages, lockfiles, deployment, or publication changes.

## Technical details

- Only the attendance card, dashboard route, and focused tests will change.
- Map URLs will use encoded coordinate queries and no raw coordinate text, SDK, embed, key, or new endpoint.
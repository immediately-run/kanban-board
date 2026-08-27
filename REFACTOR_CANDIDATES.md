# REFACTOR / FINDINGS — new-project-template

Recorded by the 2026-06 code-verification pass (R3-124; plan `08-system-apps.md`).
**Record only — nothing actioned.** This is the scaffold every "Create" app forks,
so it has 0 spec-refs by design (it is the starting point) and a violation here
would be high-signal.

## R3-122 — `$schema` on the `immediately.run` manifest field (BLOCKED, record)

`package.json` has **no `immediately.run` config object at all** (the field is
absent), so there is no `$schema` either. R3-122's exit criterion includes
"`$schema` referenced in `new-project-template`".

**Status: blocked on the site-main half.** The template is the *consumer* of a
generated JSON Schema that site-main must publish first (the schema is generated
from + drift-gated against the Zod source of truth `immediatelyRunConfig.ts`). No
published schema URL exists in this environment (site-main is not in this
checkout). **Do NOT invent a `$schema` URL.** When site-main publishes the schema
URL, adding the `$schema` line (and a minimal `immediately.run` object to hang it
on) is a one-line change gated on `npm run build && npm run lint`.

→ Roadmap dependency: template `$schema` lands when the published schema URL exists.

## Test-toolchain scaffold delta (proposed/unscheduled, record)

The template ships **no test setup** — no `vitest` dep, no `test` script, no
`src/test/` — unlike file-explorer / agent-demo (which carry `vitest ^4.1.8` +
`"test": "vitest run"`). The APP_ONBOARDING / future test-toolchain delta proposes
the scaffold include a session-runnable test toolchain (vitest + a
SessionStart-hook-friendly `npm test`) so Created apps can run tests in web
sessions (cross-ref the `session-start-hook` skill — the mechanism that ensures
`npm test`/lint run in web sessions).

**Status: proposed, unscheduled** (APP_ONBOARDING_SPEC is a proposal with no
status doc). **Do NOT scaffold tests in this pass** — recorded as a gap/candidate.

## SDK-version skew (record only)

Pins `@immediately-run/sdk` at **`0.8.1`** (fleet spread: `0.2.8` / `0.8.1` /
`0.11.0` / `^0.12.0`). Coordinated fleet bump is owed; do not bump here.

## CLAUDE.md / scaffold conformance (verified)

Confirm at execution: `src/App.tsx` is the entry (CSS imported from it, not
`main.tsx`), MDX shim wired (`src/mdx.d.ts`). The CLAUDE.md "Editing: delegate to
the platform editor" section is consistent with `EDITOR_FIRST_EDITING_SPEC`.
`dev/fsSmokeTest.ts` (if present) must be dev-only, not in the rendered tree.

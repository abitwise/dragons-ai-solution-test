---
phase: 04
slug: logger-cli-live-smoke
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-11
register_authored_at_plan_time: true
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Verification of the plan-time STRIDE register against the implemented code.
> The register was authored at plan time across all four `04-*-PLAN.md` `<threat_model>`
> blocks; each disposition below was verified by reading the actual source and locating the
> control with `file:line` evidence — documentation/intent alone was not accepted.
> Read-only audit: no implementation files were modified.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Live Mugloar API → bot | HTTP responses from the public game API parsed in `api.ts` | Untrusted ad/shop strings (probability, message, name) — no credentials/PII |
| CLI args + env → bot | `process.argv` flags and `LOG_LEVEL` / `MUGLOAR_BASE_URL` env | Untrusted operator-supplied verbosity + base-URL override |
| Bot → terminal (stdout) | Leveled pino narration + the FINAL SCORE banner / failure line | Decision narration (untrusted strings ride as structured fields) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-04-01 | Tampering (log injection) | `logger.ts` foldArgs + `runner.ts` narration + `index.ts` error line | mitigate | `foldArgs` routes caller values into pino's merge object, never the message string (`logger.ts:45-58`); verified at all 13 `logger.*` sites — `runner.ts:117,129-134,138-143,184,207,213,224-230,231,236`, `index.ts:231`; catch logs error as a field (`index.ts:219,231`) | closed |
| T-04-02 | Information Disclosure (raw objects above DEBUG) | `runner.ts` narration | mitigate / accept | Raw catalog/candidate arrays confined to `logger.debug` (`runner.ts:117,148,207,231`); INFO carries only scannable scalar lines (`:184,213,224-230`). Accepted-risk basis: game API carries no PII/credentials | closed |
| T-04-03 | Denial of Service (untrusted log level) | `index.ts` resolveLogLevel | mitigate | Closed `PINO_LEVELS` Set (`index.ts:41`); flag + lowercased env validated against it (`:72-77`); bogus value rejected → `"info"` default (`:79`), never passed raw into pino | closed |
| T-04-04 | Tampering (unknown CLI flag) | `index.ts` parseArgs | accept | `strict: true` throws on unknown flag (`index.ts:68`); `safeResolveLogLevel` degrades a bad flag to `info` for verbosity only (`:161-167`); genuine failure → exit 2 via `main` catch (`:233`) + launch `.catch` (`:242-246`) | closed |
| T-04-05 | Information Disclosure (banner/failure leak) | `index.ts` printBanner + failure line | accept | `printBanner` reads only typed `report.score`/`turns`/`reason` (`index.ts:143-145`); `reason` narrowed to the `EndReason` ASCII union (`types.ts:111-114`); failure line prints an Error from our own taxonomy (`api.ts:52-77`), not raw response bytes | closed |
| T-04-06 | Spoofing/Tampering (live host integrity / SSRF) | `api.ts` DEFAULT_BASE_URL | accept | Hardcoded `https://` constant (`api.ts:33`); `this.baseUrl` assigned exactly once at construction (`:177`), never from a response; request URL = `baseUrl + path` (`:237`) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Backstop in code | Accepted By | Date |
|---------|------------|-----------|------------------|-------------|------|
| AR-04-02 | T-04-02 | Raw API arrays/objects appear in logs at DEBUG; game API carries no credentials/PII (stated project assumption); DEBUG is the operator's deliberate choice on a local terminal | Raw arrays confined to `logger.debug` (`runner.ts:117,148,207,231`) | operator | 2026-06-11 |
| AR-04-04 | T-04-04 | Unknown CLI flag is user-supplied input on a local single-user CLI; strict parser is the mitigation, the catch is the backstop — no uncaught crash, no partial run | `strict: true` (`index.ts:68`) + `main` catch → exit 2 (`:233`) + launch `.catch` (`:242-246`) | operator | 2026-06-11 |
| AR-04-05 | T-04-05 | Banner/failure line print only typed `GameReport` fields and our own `Error` taxonomy; no secrets in scope | Typed-only banner (`index.ts:143-145`); error from `api.ts` taxonomy (`api.ts:52-77`) | operator | 2026-06-11 |
| AR-04-06 | T-04-06 | Public game API, no auth, no secrets; a hostile response can at worst end the run (`BoundaryError` → exit 2); base URL never derived from a response (SSRF guard) | Hardcoded HTTPS const (`api.ts:33`); single construction-time assignment (`:177`) | operator | 2026-06-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

All four SUMMARY files carry `## Threat Surface` sections stating "No new threat surface beyond
the plan's `<threat_model>`." Two code paths introduced during implementation but absent from the
original 6-threat register were reviewed for new surface:

- **`isHelpRequested` / `USAGE` (`index.ts:98-132`)** — help-detection parse using `strict: false`
  / `allowPositionals: true` (`:128-129`). No new surface: reads boolean `--help`, prints a static
  string, exits 0 before any game runs. The loosened parse is intentional (honor a help request
  even with a typo'd flag); the verbosity resolution keeps `strict: true`, so T-04-04 is unaffected.
- **Launch-site `.catch` (`index.ts:242-246`)** — maps any escape from `main` to a deterministic
  exit 2. Strengthens the D-08 exit-code contract; error message rides in a stdout line from our own
  values, consistent with T-04-01 / T-04-05.

Neither opens an attack surface that maps to no threat; both are covered by existing dispositions.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-11 | 6 | 6 | 0 | gsd-security-auditor (opus) — read-only verification against source |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-11

# Dashboard and performance review

14 October 2026. Scope: CRM overview and CRM record-list rendering. This is not a claim that every route or production integration has been load-tested.

## Verdict

**Technology fit: 8.5/10. Current enterprise readiness: 7/10.** These are engineering judgments, not benchmark scores. Keep Next.js, React, TypeScript and Supabase/Postgres. The immediate constraint was unnecessary rendering, not the choice of framework. No stack migration or additional chart/state-management library is justified by this evidence.

The application is a modular monolith: authentication establishes a tenant and role; server-rendered pages read through Supabase with RLS; database functions protect consequential transitions; a durable worker coordinates external providers. Attendance remains a separate workspace. AI assists with drafting, not autonomous statutory decisions. This is a practical foundation for a firm CRM, but not yet evidence of MNC-scale capacity.

## Reproduced bottleneck and improvement

Command: `npx vitest run 'src/app/(portal)/crm/[module]/page-performance.test.tsx' --reporter=verbose --silent=false`.

The test renders the real CRM list page with mocked query responses: 50 tasks, 1,000 clients and 100 employees. Previously, native closed details panels still contained every fully rendered editor and its entire dropdown lists.

| Deterministic fixture | Before | After |
| --- | ---: | ---: |
| Server-rendered HTML | 2,638,464 bytes | 9,755 bytes |
| Option elements | 56,411 | 5 |
| Regression budget | Failed | Passed |

HTML reduction is approximately 99.6% for this fixture. This is **not** a 99.6% production speedup, compressed transfer comparison, or measured heap reduction. React Server Component serialization, JavaScript and actual database/network latency are not included in these HTML byte counts.

Changes:

- Editors mount on first expansion. Their inputs remain mounted after that, preserving unsaved edits when closed/reopened.
- Client, employee and invoice receipt lookups use maps; document versions are grouped once rather than filtering all versions for every row. Render-time lookup work changes from repeated scans to one-pass indexing plus direct lookup.
- Assignment-query errors no longer silently display incomplete selection lists.
- Existing 50-record pagination remains intact. No authorization checks were removed and no tenant data was put into shared caches.

Trade-off: opening every editor still accumulates its controls. The client/employee option datasets also still travel to the page. Next scaling step is a permission-aware, server-searched picker, not a larger dropdown or arbitrary silent truncation.

## Dashboard delivered

- Real counts for active clients, requested/rejected documents, unfiled compliance and unfinished tasks.
- Six earliest unfiled compliance deadlines, including overdue work; real empty and unavailable states.
- Direct task, AI workbench, reporting and module navigation; administrator-only automation link.
- Restrained navy/teal surfaces, readable system typography, consistent cards and responsive single-column mobile sections.
- Server rendering and a Suspense fallback; no chart dependency, remote font download or dashboard polling loop.
- Count-only queries and a bounded deadline projection, dispatched in parallel with explicit organization filters and the authenticated RLS client.
- Unavailable counts remain unavailable, not misleading zeros.

The codebase-design skill guided the small `loadCrmOverview` read interface, separating query behavior from presentation. The diagnosis skill required a failing render-budget test before the rendering fix.

## Verification

- 98 tests across 18 files passed, including editor open/reopen behavior, initial-render budget, tenant-filtered overview query shape, and unavailable/role-based UI states.
- Lint, TypeScript and production build passed.
- Authenticated HTTP test against a local production server and an isolated empty Supabase organization passed. Temporary Auth/profile/organization fixtures were cleaned up without touching real accounts.
- Warm full-response samples: overview 1,271 / 314 / 290 ms (median **314 ms**); task list 293 / 114 / 121 ms (median **121 ms**). First-byte medians 27 ms and 18 ms respectively.
- These timings describe one local test run with three warm samples, not production p95/p99, mobile Core Web Vitals or a concurrent-user capacity test. Streamed first byte is not the same as complete dashboard data.
- Browser layout inspection of the real server-rendered view with clearly labelled illustrative data passed at 1280, 390 and 320 pixels, with no horizontal page overflow. Screenshots are local QA artifacts under `tmp/crm-visual/`. This fixture is static: interactive editor behavior is covered separately by the DOM test, and the live signed-in visual check remains pending because the browser is still at login.

Reproduce HTTP checks with `PERF_BASE_URL=http://localhost:3102` and `PERF_CRM_ONLY=1`, then run `node --env-file=.env.local scripts/benchmark-portal.mjs` against a production build. It creates and removes isolated test fixtures; use only the intended test database.

## Remaining priorities

1. Replace full-list client/employee pickers with paginated search. Verify current Supabase row-limit behavior and preserve selected values outside the current search result.
2. Profile count queries and RLS under realistic tenant sizes. Count-only responses bound network memory, but exact counts still have database cost. Use EXPLAIN/Index Advisor before adding indexes or aggregate tables. [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization).
3. Measure real user performance, with no PII in telemetry. Target p75 LCP at most 2.5 seconds and INP at most 200 ms; these targets are not yet verified. [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds/).
4. Run staged load tests for multiple tenants and concurrent writes; define p95 response and queue-lag budgets. Do not stress the firm's production database without a planned window.
5. Review report-query waterfalls and use parallel independent reads; preserve consistency for finance and closed attendance snapshots. This pass did not change report calculations.
6. Productionize integrations: credential rotation, provider delivery tests, safe retry operations, dead-letter recovery, alerting and backup-restore exercises. The worker's 20-per-hour outbound cap is a pilot limit, not an MNC guarantee.

A defensible 10/10 requires demonstrated reliability, isolation, accessibility, recovery and measured capacity—not just a newer UI or more dependencies.

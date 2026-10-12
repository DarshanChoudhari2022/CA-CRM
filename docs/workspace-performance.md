# Attendance separation, ERP styling and performance

12 October 2026.

## Workspace contract

Attendance sign-in: `/admin/login` and `/employee/login`; success opens `/dashboard`. Attendance navigation contains attendance, leave, daily work and role-appropriate approvals/people/calendar/settings/reports only. No client, invoice, support or automation links are included in that navigation.

CRM sign-in: `/crm/login`; success opens `/crm`. CRM navigation and overview are separate and contain no attendance administration. `/modules` is an explicit workspace switcher, not a combined module dashboard. These are separate experiences using the same protected organization/account model; CRM data and integrations were preserved, not deleted. Module separation is not a second authentication database or a new permission entitlement.

## Typography and mobile behavior

Use the installed Segoe UI Variable/Segoe UI fonts on Windows, with native system fallbacks on other devices. No external web-font download is required. The scale is 14px body, 13px navigation, 18px card headings and 28px desktop/24px mobile page titles. White surfaces, slate navigation, restrained blue actions, and status-specific colors replace the ornamental serif headings. This is based on [Microsoft Fluent typography](https://fluent2.microsoft.design/typography), not a claim that every ERP uses identical styling.

At phone widths, navigation uses an accessible menu button instead of a long horizontal menu; controls retain 44px touch targets, input text is 16px, cards stack, and wide data tables scroll inside their own container. Reduced-motion preferences stop loading animation. Mobile login has a compact header so the form is easier to reach.

## Changes addressing measured bottlenecks

- One verified active-profile read instead of separate identity RPC and onboarding queries. React's cache deduplicates layout/page callers within one server render only. There is no persistent/shared cache of private identity or records.
- Share the Supabase client during a server render, and issue independent history/correction and reminder/outbox reads in parallel.
- Stream a lightweight loading shell while authentication completes; keep page loading feedback under the shared workspace layout.
- Explicit organization filters and uncorrelated role/owner checks allow database indexes to be used instead of running a security-definer access helper for each CRM row.
- Add organization/date/status indexes, trigram title-search indexes, direct-report lookup, pending reminder indexes and requester/audit indexes. Bound/paginated screen queries remain in place. No destructive data migration.
- Configure Vercel functions in Mumbai (`bom1`) for the India-facing app. [Vercel region configuration](https://vercel.com/docs/functions/configuring-functions/region). Do not infer the original function region from a static CDN response. Actual function/edge region traces are printed by the authenticated benchmark after deployment.

RLS patterns follow [Supabase's RLS performance guidance](https://supabase.com/docs/guides/database/postgres/row-level-security). Direct table writes remain denied; mutations still use audited business functions. Tests cover organization isolation, manager direct-report visibility, unrelated employees, inactive access and temporary-password onboarding.

## Reproducible measurements

`node --env-file=.env.local scripts/benchmark-portal.mjs` measures authenticated local production-build responses on port 3100. It creates an isolated fixture account/organization and removes them in `finally`; no real user passwords or records are modified. Set `PERF_BASE_URL=https://ca-crm-theta.vercel.app` to measure this project's deployed site. `PERF_MAX_MS` defaults to 1700ms warm median. `PERF_ASSERT_ISOLATION=1` also checks the rendered shell's workspace classification.

Before changes: deployed attendance median 2049ms and CRM automations 2438ms. Local baseline medians: attendance 238ms and automations 270ms. Optimized local medians: attendance 117ms and automations 164ms. These are three warm full-response samples, not cold-start, mobile rendering or high-concurrency guarantees. Deployment results should be recorded separately after verifying the new build.

`node --env-file=.env.local scripts/benchmark-crm-query.mjs` runs the actual role-scoped sorted list query with 10,000 synthetic task records, using `EXPLAIN ANALYZE`. All records are transaction-rolled-back. Database execution before: 1851.484ms; after: 0.694–0.732ms. This is a single synthetic list-query benchmark, not proof that all future workloads scale without limit.

Verification: 24 unit tests, type checking, lint, production build, hosted rollback-only CRM/workspace permission tests and the 10,000-record query test. The identity unit tests model React's render-cache lifecycle; authenticated HTTP measurements exercise the actual deployed/local rendering path.

Operational caveats: network distance, database/service plan limits and cold starts still affect response times. Authenticated phone-width portal interaction needs a signed-in browser session; do not substitute mocked screenshots for that journey. Larger concurrency, real organization data and statistical p95/load testing remain separate acceptance work.

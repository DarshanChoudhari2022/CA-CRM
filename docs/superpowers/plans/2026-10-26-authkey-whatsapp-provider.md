# Authkey WhatsApp Provider Implementation Plan

## Implementation outcome

Implemented the outbound demo in the provider layer and existing admin Support messaging form. Exact operator steps: `docs/authkey-demo-setup.md`. Corrections from inspection: the supplied PDF uses `https://console.authkey.io/restapi/requestjson.php`; the three values are explicit typed fields, never inferred from free-text CRM messages. Authkey is excluded from general worker dispatch because the approved template is for leave updates only. Sender and language are selected by WID, so AUTHKEY_TEMPLATE_LANGUAGE is unnecessary. No Authkey callback is connected to the existing Meta webhook. Live deployment and delivery remain pending the private API key and funded provider account. No commit, push or external send was performed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Authkey as a selectable outbound WhatsApp provider for approved template WID `52797` while preserving Meta support and manual-review safety.

**Architecture:** Keep the existing `sendWhatsApp(recipient, body)` boundary and route inside the server-only provider module using `WHATSAPP_PROVIDER`. Convert the CRM dispatch body into the three positional Authkey template values, call Authkey’s JSON endpoint, and return its provider message identifier. Leave inbound/receipt handling on the existing Meta path until Authkey webhook details are configured.

**Tech Stack:** Next.js/TypeScript, Zod, Vitest, Supabase-backed CRM worker, Authkey REST API.

**Spec:** `docs/superpowers/specs/2026-10-26-authkey-whatsapp-provider-design.md`

## Global Constraints

- Authkey credentials remain server-only Vercel secrets.
- Authkey sends use `POST https://api.authkey.io/restapi/requestjson.php`.
- Demo template WID is `52797`; country code is `91`; type is `text`.
- WhatsApp remains disabled/review-only until a manual recipient test succeeds.
- Provider acceptance is not delivery confirmation; uncertain sends are never auto-replayed.
- Meta configuration continues to work when `WHATSAPP_PROVIDER=meta`.

## Review Focus

- Missing or partial Authkey variables must report not-ready and never make a network request; test in Task 1.
- Indian numbers with `+91`, `91`, or local `10` digits must normalize consistently; malformed numbers must fail closed; test in Task 1.
- Authkey HTTP errors and malformed responses must surface as provider failure; test in Task 1.
- Template values must not allow arbitrary secrets or unbounded payloads; test bounded values in Task 1.
- Existing Meta payload behavior must remain unchanged; preserve the existing provider tests in Task 1.

### Task 1: Add the Authkey provider implementation

**Files:**
- Modify: `src/modules/crm/providers.ts`
- Test: `src/modules/crm/providers.test.ts` (or the existing provider test location)

**Interfaces:**
- Consumes: existing `integrationStatus()` and `sendWhatsApp(recipient, body)` callers in the CRM worker.
- Produces: Authkey-aware `integrationStatus()` and `sendWhatsApp()` with the existing return type `Promise<string>`.

- [ ] **Step 1: Write failing tests** for Authkey readiness, provider selection, exact POST URL/headers/body, valid number normalization, malformed-number rejection, non-OK response rejection, and malformed response rejection.
- [ ] **Step 2: Run the focused provider tests** and confirm the new Authkey cases fail before implementation.
- [ ] **Step 3: Implement Authkey routing** in `providers.ts` using `WHATSAPP_PROVIDER=authkey`, `AUTHKEY_API_KEY`, `AUTHKEY_TEMPLATE_ID`, `AUTHKEY_COUNTRY_CODE`, and optional `AUTHKEY_TEMPLATE_LANGUAGE` readiness. Use Basic Auth, JSON body `{ country_code, mobile, wid, type: "text", bodyValues: { "1": ..., "2": ..., "3": ... } }`, and return the first provider message ID from the documented response shape.
- [ ] **Step 4: Keep Meta routing unchanged** for `WHATSAPP_PROVIDER=meta` and preserve existing Meta readiness semantics.
- [ ] **Step 5: Run focused tests** and confirm all new and existing provider tests pass.
- [ ] **Step 6: Commit** with `feat: add authkey whatsapp provider`.

### Task 2: Update configuration and operator documentation

**Files:**
- Modify: `.env.example`
- Modify: `docs/remaining-setup-walkthrough.md`
- Modify: relevant automation configuration guide if needed

**Interfaces:**
- Consumes: the exact variable names implemented in Task 1.
- Produces: copyable Vercel configuration without secret values.

- [ ] **Step 1: Add documented Authkey variable names** and a provider selector to `.env.example`, with no credentials or real recipient numbers.
- [ ] **Step 2: Document WID `52797`, template approval prerequisite, manual-review rollout, and the Authkey API contract.
- [ ] **Step 3: Document that Authkey inbound webhooks and delivery receipts remain a later integration until Authkey supplies the callback contract.
- [ ] **Step 4: Run `git diff --check` and verify no secret-like value was added.
- [ ] **Step 5: Commit** with `docs: document authkey whatsapp setup`.

### Task 3: Full verification and deployment handoff

**Files:**
- No source changes unless verification exposes a defect.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: verified deployment instructions and a safe demo checklist.

- [ ] **Step 1: Run the project test suite, lint, typecheck, and production build using the repository’s existing commands.
- [ ] **Step 2: Confirm the local tree has no secrets, `.env.local` remains ignored, and only intended files changed.
- [ ] **Step 3: Set Authkey variables in Vercel as Production secrets/config values; do not commit them.
- [ ] **Step 4: Redeploy and confirm Automation Centre reports Authkey credentials present while automation remains paused.
- [ ] **Step 5: Add one consenting test recipient, queue one reviewed leave-approved message, run the scheduler once, and verify provider acceptance and actual receipt.
- [ ] **Step 6: Do not enable automatic reminders until the manual test is successful.
- [ ] **Step 7: Commit any final verification-only documentation changes and report the deployment URL/status.

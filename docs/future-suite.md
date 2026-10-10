# Future CA Automation Suite — Scope and Pitch

Version 0.1 · 10 October 2026 · Future concept, excluded from attendance delivery

## 1. Evidence reviewed

| Source | Observed facts | Limits |
| --- | --- | --- |
| User's current request | Attendance is the first module; broader automation will be pitched next | Future modules are not authorized implementation scope for this delivery |
| [Notion: CA firm Automation + dashboard](https://holly-deposit-2c0.notion.site/CA-firm-Automation-dashboard-3c0fc7b8a9e28071a3c5edebb7bc14a2) | Browser-loaded page contains an embedded ca-crm (1).html dashboard and a workflow JSON attachment | Only the visible dashboard was inspected; no claim that all linked screens work |
| Embedded dashboard | Navigation includes AI Support Agent, Document Hub, Compliance, Lead Pipeline, Invoice & Fees, Clients, Tasks, Reports and Settings | Example firm is CA Sharma & Associates; displayed counts, fees and deadlines are illustrative, not PSB data or verified compliance dates |
| User-supplied Pasted text.txt | Valid JSON named CA Firm Automation Suite — Zero to Pro Automation; 152 nodes; active=false; nine entry points described by its notes | Static inspection, not an executed/tested integration; placeholder credentials and IDs remain |
| Existing PSB website | Header combines CA India mark, PSB & Associates LLP and Chartered Accountants subtitle | Website office hours do not establish employee attendance policy |

Workflow inventory reviewed: all node names/types and all branch notes, plus selected visible configuration in the supplied JSON. This is a product/source assessment, not a full code or security audit. The Notion attachment was not separately downloaded or proven identical to the pasted file.

The workflow references Google Sheets tabs Clients, Documents_Tracker, Compliance_Calendar, Leads, Invoices, Query_Log and Error_Log; WhatsApp, Gmail, Telegram and a Groq-backed model. It contains no attendance branch. Its existence is not evidence of an operational CRM.

## 2. Future module map

| Module | Evidence | Candidate feature scope | Dependencies and release gate |
| --- | --- | --- | --- |
| Client management | Dashboard Clients; workflow client lookup | Client records, contacts, assigned owner, service engagements, activity history | Define identity/deduplication and access before integrations |
| Client support | WhatsApp incoming router and email support | Shared query inbox, client context, suggested replies, human escalation, query log | Channel ownership/permissions, client identity, retrieval correctness and human-reviewed pilot |
| Document hub | Request Documents, WhatsApp receipt and daily follow-up branches | Checklists, requests, secure upload/storage, received/pending/review states, reminder history | Secure file handling, reliable document matching, human verification |
| Compliance calendar | Daily compliance branch | Per-client filing tasks, maintained due dates, reminders and escalation | Named owner for authoritative dates and updates; no automatic filing implied |
| Lead pipeline | Website/email/WhatsApp lead branches and daily follow-up | Capture, deduplicate, assign, classify, track follow-up and convert | Channel permissions, qualification criteria and audit of automation decisions |
| Invoice and collections | Invoice follow-up and payment confirmation | Invoice register, outstanding balance, reminder queue, partial/full payment reconciliation | Verified payment source, amounts/currency, refunds and duplicate event handling |
| Tasks and reports | Visible dashboard navigation | Assignments, due dates, firm workload and module-level reporting | Product specification needed; navigation alone is not implementation evidence |
| Leave management | Earlier user HR intent, not supplied workflow | Request/approve leave, balances, policies and holiday integration | HR policy agreed; update attendance through its interface |
| Automation operations | Error log and Telegram nodes | Run history, delivery status, retries, failed-job queue, replay and pause controls | Tested credential handling, monitoring and operational ownership |

## 3. Workflow behavior versus production commitments

The template notes describe compliance reminders at 7/3/1 days, due date and overdue; document follow-up after 3 days; lead nudges every 3 days and closure after 4 attempts; escalating invoice reminders. These are template policies, not approved PSB business rules.

Before activation, each branch needs input authentication, duplicate-event protection, reliable client matching, channel-specific delivery handling, failure recovery and scoped access. The static template uses placeholders, so simply linking Supabase cannot make it production-ready.

Specific gaps to resolve during future design:

- Receiving a file is not verification of its correctness. The dashboard's “Docs Auto-Verified” label must not become a sales claim without defined verification and evidence.
- Payment confirmation must not blindly mark an invoice paid. Reconcile amount, balance, currency, partial payments, trusted event source and duplicate/reversed events.
- AI must not invent filing dates or assert completion. Use maintained structured records, human escalation and an evaluation set.
- Unknown senders and short/similar phone numbers need conservative identity matching before exposing client context.
- Inbound payload acknowledgement must not imply durable processing unless intake has actually been persisted.
- A reminder attempt is not confirmed delivery. Track channel outcomes and retries separately.
- Validate the template's error handling and timezone configuration in a sandbox; comments are not proof of catch-all recovery.
- Google Sheets is the template's store. For the portal, propose Supabase as authoritative, with an explicit reviewed import/mapping if existing sheet data is later migrated. Avoid uncontrolled dual writes.

No automation, message delivery, payment update or external workflow activation is part of attendance v1.

## 4. Follow-on pitch

Suggested positioning: “Start with reliable attendance and monthly visibility. Expand the same PSB portal to reduce document chasing, track client deadlines and follow up outstanding work.”

Pitch sequence after a successful attendance pilot:

1. Demonstrate a real attendance journey: employee punch, correction approval, monthly close and report.
2. Show measured pilot adoption and admin time, with a baseline; do not promise an invented ROI.
3. Demonstrate a clearly labeled future concept using synthetic clients and documents.
4. Propose one next module with a narrow success metric. Document collection plus compliance reminders is a candidate, not a fixed commitment.
5. Scope integrations and recurring costs before quoting delivery or savings.

Suggested order: attendance → client records and document collection → compliance reminders → leads and collections → AI-assisted support and consolidated reporting. Leave can be prioritized next if internal HR needs outweigh client automation.

Commercial separation: attendance setup/support as the first package; future modules individually scoped; hosting, email/WhatsApp delivery, model usage and n8n operation budgeted separately. No prices or vendor-plan capabilities are asserted in this draft.

## 5. What the pitch can honestly claim

Now: documented attendance specification and reused PSB assets.
After implementation and pilot: only the attendance capabilities demonstrated and tested.
Future roadmap: candidate modules inspired by the reference, each subject to its own implementation and verification.

Do not present the 152-node template, illustrative financial figures or reference dashboard as a live integrated PSB system.

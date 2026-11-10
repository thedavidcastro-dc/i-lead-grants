# GrantBridge — Phase 1 build spec

Companion to the design document (draft 5, Nov 2026). Phase 1 delivers the whole grant
subledger end to end against a **read-only** QuickBooks connection: sync, grant records,
budget ingestion and mapping, expense classification, payroll allocation from uploaded
reports, funder submissions (invoices and expenditure reports), the reported ledger, and the
monthly tie-out. Pilot grant: PDE Job Training and Education Programs, FC 4100102789.

## Principles that constrain the code

1. **QuickBooks is never written.** The Intuit app has the accounting scope; no code path
   issues a POST to QuickBooks. Reviewers should treat any such change as a design change.
2. **Every synced or classified row keeps its QuickBooks identifiers** (`txn_type`, `txn_id`,
   `line_id`, `sync_token`), so write-back could be added later without rework.
3. **Nothing the model produces is recorded without a human approval.** Claude writes to
   `suggestion` / `draft` columns; people write to `kind`, `allocations`, `status = approved`.
4. **Rules live in tables and documents, never in code**: budget lines, mappings, allowability,
   indirect rules, report row mappings, funder instructions, house notes.
5. **A source line is reported once.** `submission_lines (source_kind, source_id)` is unique.
6. **Every model call is logged** in `grants.ai_calls` with tokens and cost.

## Stack

Next.js 16 (App Router, `proxy.ts`, dynamic rendering — `cacheComponents` off), Tailwind 4,
`@supabase/ssr`. Supabase project `ilead-ledger`, schema `grants`, Storage bucket
`grant-documents`. Auth, `public.profiles` and `public.invitations` are shared with the
revenue ledger app; roles `admin`, `bookkeeper`, `viewer`. Vercel project `i-lead-grants`.
Claude API server-side via `ANTHROPIC_API_KEY`.

## Bundles (delivery order)

| # | Contents | Done when |
|---|----------|-----------|
| 1 | Scaffold, login, QuickBooks OAuth with encrypted tokens, reference sync (accounts, classes, vendors, employees), schema migration 0001 | Admin can sign in, connect the sandbox company, sync, and browse the chart of accounts and classes. **This bundle.** |
| 2 | Transaction sync: initial load by date range, CDC incremental sync on a schedule, webhook receiver, change detection → `sync_flags`, sync-health page | July 2026 onward is in `qbo_lines`; editing a transaction in the sandbox produces a flag. |
| 3 | Funders, grants (lifecycle), documents upload, budget ingestion (Claude extraction → editable draft), mapping screen, budget versions; Claude service layer with schema-validated outputs and `ai_calls` logging | PDE grant onboarded from its application/agreement with four budget lines mapped. |
| 4 | Classification queue: dispositions, Claude suggestions by confidence, split editor, approval, corrections feedback; grant view (budget vs. actual) | July–Oct PDE expenses classified; grant view shows spent per line. |
| 5 | Payroll: report upload + Claude extraction, GL check against synced payroll entries, employees + allocation profiles, drafted splits, certification screen | Four months of Paycor reports allocated and certified; totals tie. |
| 6 | Submissions: assemble unreported lines, Claude draft against funder instructions/template, review screen, approve → `submission_lines`, package generation (xlsx/pdf), sent/paid; tie-out report | PDE interim report drafted; tie-out shows zero difference. |
| 7 | Users/invitations admin, roles polish, audit views, cron for CDC, production cutover checklist | Bookkeeper invited; nightly sync running; production keys in place. |

## Data model (schema `grants`)

See `supabase/migrations/0001_grants_schema.sql`. Groups:

- **Sync**: `qbo_connection` (single encrypted token row), `qbo_accounts`, `qbo_classes`,
  `qbo_vendors`, `qbo_employees`, `qbo_transactions`, `qbo_lines` (one row per expense-side
  line, with `content_hash` for change detection), `sync_runs`, `sync_flags`.
- **Grants**: `funders`, `grants` (lifecycle, funding type, `indirect_rule`, `match_rule`,
  `reporting`, `funds_received`), `documents`, `budget_versions` (one `is_current`),
  `budget_lines` (funder category, amount, allowability, `cap_rule`, `report_row`,
  `planned_curve`, `detail`), `budget_line_accounts`.
- **Classification**: `dispositions` (one per line; `suggestion` from Claude; `kind` set by
  a person), `allocations` (grant splits).
- **Payroll**: `employees`, `allocation_profiles` (fixed percentages, certified),
  `payroll_periods` (with `gl_check`), `payroll_period_employees`, `payroll_allocations`.
- **Submissions**: `submissions` (invoice | interim_report | final_report), `submission_lines`
  (the reported ledger).
- **Audit**: `audit_log`, `ai_calls`.

RLS: members read everything but the token row; admins write everything; bookkeepers write
classification, payroll, flag resolution, and payroll-report documents. Server jobs use the
service role after checking the caller's role.

## QuickBooks integration

- OAuth2 authorization-code flow (`/api/qbo/connect` → Intuit → `/api/qbo/callback`).
  State in an httpOnly cookie. Tokens AES-256-GCM encrypted with `QBO_TOKEN_ENCRYPTION_KEY`.
- Access tokens refreshed within 5 minutes of expiry; refresh tokens last ~100 days and are
  renewed on every refresh. Refresh expiry marks the connection disconnected.
- Queries use `/v3/company/{realm}/query` with `minorversion=75`, paged 1,000 at a time.
- Incremental sync uses `/cdc` (window ≤ 30 days) on a schedule plus webhooks; the initial
  load queries by `TxnDate` range.
- Sandbox vs production is a single switch (`QBO_ENVIRONMENT`) plus the matching client ID.

## Setup checklist

1. Apply `0001_grants_schema.sql` (Supabase MCP `apply_migration` or SQL editor).
2. Supabase → Settings → API → **Exposed schemas**: add `grants`.
3. Supabase → Authentication → URL Configuration → Redirect URLs: add
   `https://grants.i-leadusa.org/auth/confirm` and `http://localhost:3000/auth/confirm`.
4. Vercel env: paste `QBO_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
5. Intuit app redirect URIs (done): localhost and production callback.
6. Cloudflare: CNAME `grants` → the Vercel project's DNS target; add the domain on Vercel.
7. Invite the bookkeeper: insert into `public.invitations (email, role)` with role `bookkeeper`.

## Known consequence to decide later

`public.is_member()` in the ledger app grants read access to anyone with a profile. A
bookkeeper invited for GrantBridge therefore also gets read access to the revenue ledger.
If that matters, add an `apps text[]` column to `profiles` and teach both apps' `is_member`
to check it.

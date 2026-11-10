# GrantBridge

I-LEAD's grant subledger: reads QuickBooks Online (never writes), classifies expenses and
payroll to grants, and produces funder invoices and expenditure reports. Design doc and
`docs/phase1-spec.md` describe the system.

## Local development

```bash
cp .env.example .env.local   # fill in the server-only values
npm install
npm run dev                  # http://localhost:3000
```

Sign in with an invited email (shared `public.profiles` / `public.invitations` with the
revenue ledger app). Connect the Intuit sandbox company under QuickBooks settings, then
sync.

## Deploy

Pushes to `main` deploy the Vercel project `i-lead-grants`. Environment variables are set
in Vercel; secrets are pasted there, never committed.

## Database

Schema `grants` in the `ilead-ledger` Supabase project. Migrations live in
`supabase/migrations/` and are applied with the Supabase MCP `apply_migration` (or the SQL
editor). Add `grants` to the project's exposed API schemas once.

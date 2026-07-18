## schema.sql

Reverse-engineered snapshot of the live Supabase Postgres schema, produced for the
Supabase → Google Cloud SQL migration (see the migration plan for full context).

`pg_dump` was not available in the local environment, so this was produced with a
one-off Node script (`pg` package, already a project dependency) that queries
`information_schema`/`pg_catalog` directly — read-only, no data was touched. The
script itself isn't part of the app and wasn't committed.

### Regenerating

If the live schema changes before cutover, re-run the same style of introspection
against Supabase's Postgres connection (`DATABASE_URL` in `backend/.env`) and re-diff
against this file by hand — there's no ongoing migrations framework here, this is a
one-time cutover artifact, not a source of truth to keep in sync automatically.

### Applying to Cloud SQL

```
psql "<cloud sql connection string>" -f backend/db/schema.sql
```

Tables are ordered so foreign keys resolve (`practitioners` → `patients` →
`assessments`/`billing_batches`/`billing_invoices`/`master_reports`). Sequences for
integer PKs are created explicitly before their tables, since this isn't using
`SERIAL`/`GENERATED` columns (deliberately — the cutover restores existing rows with
their original `id` values via `pg_dump --data-only`, which is simpler with a plain
`nextval()` default than with an identity column, since identity columns reject
explicit values without `OVERRIDING SYSTEM VALUE` on every insert). After the data
restore, remember to `setval()` each sequence past its table's current max `id`.

See the header comment in `schema.sql` for what was stripped from the raw Supabase
dump (auto-generated NOT NULL check constraints, RLS/policies, Supabase-only
extensions) and why.

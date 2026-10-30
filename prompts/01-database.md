# P01 · Local PostgreSQL, full schema, migrations

GOAL: A local Postgres (16 or later) holds the complete MVP schema, created by one migration that is idempotent and checksummed.

GIVEN: P00. `CLAUDE.md` rules apply.

DELIVER:
- `scripts/db-setup.sh`: idempotent. Uses local superuser `psql` to create role `btg` (password read from an argument) and the databases `btg` and `btg_test`, both owned by `btg`. Prints the `listen_addresses='localhost'` line and the `pg_hba` line (`host btg btg 127.0.0.1/32 scram-sha-256`) for the operator to confirm. Never edits the system config itself.
- `scripts/migrate.ts`: applies `db/migrations/*.sql` in lexical order. Each file runs in its own transaction. Records `(name pk, sha256, applied_at)` in `schema_migrations`. If an already-applied file's checksum has changed, it aborts with exit code 1. Takes the DB URL as an argument (defaulting to `env.DATABASE_URL`).
- `db/migrations/0001_init.sql`: the schema below, exactly.
- `src/server/db.ts`: `export const sql = new SQL({ url: env.DATABASE_URL, max: 10 })`. Tests swap in `TEST_DATABASE_URL`.
- Append the module-map lines to `CLAUDE.md`.

SCHEMA (all `id uuid` default to `gen_random_uuid()`; all `*_at` are `timestamptz`, and `created_at` defaults to `now()`. `uid` is shorthand for `user_id uuid not null references users on delete cascade`):
```
ext citext
users(id pk, email citext unique not null check(len<=254), pw_hash text not null, settings jsonb not null default '{}',
      trial_ends_at not null, stripe_customer_id text unique, sub_id text unique,
      sub_status text not null default 'none' check in(none,active,trialing,past_due,canceled,incomplete,unpaid),
      sub_period_end, sub_cancel_at_period_end bool not null default false, created_at)
sessions(id_hash bytea pk, uid, expires_at not null)                              idx(user_id) idx(expires_at)
stripe_events(id text pk, received_at)
usage_periods(uid, period date, used_micros bigint not null default 0, reserved_micros bigint not null default 0, pk(user_id,period))
llm_calls(id bigserial pk, uid, kind text not null, model text not null, prompt_tokens int, completion_tokens int, cost_micros bigint not null, created_at)  idx(user_id,created_at desc)
topics(id pk, uid, slug text not null check(len<=64), name text not null check(len<=120), domain text not null,
       mastery real not null default 0, attempts int not null default 0, correct int not null default 0, conf_err_sum real not null default 0,
       last_seen_at, created_at, unique(user_id,slug))                          idx(user_id,last_seen_at desc)
topic_edges(uid, src uuid refs topics cascade, dst uuid refs topics cascade, kind text check in(prereq,related), pk(user_id,src,dst,kind), check(src<>dst))
lessons(id pk, uid, topic_id uuid refs topics cascade, title text not null, plan jsonb not null, paper_ids text[] not null default '{}', model text not null, created_at)  idx(user_id,created_at desc)
lesson_steps(lesson_id uuid refs lessons cascade, idx smallint, content jsonb not null, pk(lesson_id,idx))
conversations(id pk, uid, lesson_id uuid unique refs lessons cascade, created_at)
messages(id bigserial pk, conv_id uuid not null refs conversations cascade, role text check in(user,assistant), content text not null check(len<=20000), citations jsonb not null default '[]', created_at)  idx(conv_id,id)
styles(id pk, uid, mime text check in('application/pdf','image/png'), sha256 bytea not null, size int not null, profile jsonb not null, created_at, unique(user_id,sha256))
questions(id pk, uid, topic_id uuid not null refs topics cascade, lesson_id uuid refs lessons on delete set null, style_id uuid refs styles on delete set null,
          kind text check in(mcq,free), stem text not null, choices jsonb, answer jsonb not null, explanation text not null, citations jsonb not null default '[]', created_at)  idx(user_id,topic_id)
cards(question_id uuid pk refs questions cascade, uid, ef real not null default 2.5, interval_d int not null default 0, reps int not null default 0, lapses int not null default 0, due_at not null default now())  idx(user_id,due_at)
attempts(id bigserial pk, uid, question_id uuid not null refs questions cascade, topic_id uuid not null, score real check 0..1, confidence smallint check 0..100,
         latency_ms int, response text check(len<=5000), is_review bool not null, created_at)  idx(user_id,created_at desc)
daily_activity(uid, day date, attempts int not null default 0, correct int not null default 0, reviews int not null default 0, review_correct int not null default 0, conf_err_sum real not null default 0, pk(user_id,day))
papers(id text pk, doi text, title text not null, year int, venue text, abstract text, fetched_at not null)
retrieval_cache(qhash bytea pk, paper_ids text[] not null, fetched_at not null)
insights(uid, day date, body jsonb not null, pk(user_id,day))
```
`papers` and `retrieval_cache` are the only tables shared across users. They hold public bibliographic data only.

INV:
- Every user-owned table cascades on user delete.
- Every query planned in P03–P10 is satisfiable by an index above. If a later prompt needs a new index, it adds migration `0002+` and never edits `0001`.

TESTS: none. Migrating twice is exercised by every DB test setup.

VERIFY:
- `scripts/db-setup.sh <pw>`, then `bun run migrate`, then `bun run migrate` again. The second run is a no-op with exit 0.
- Edit one byte of `0001_init.sql`, run `bun run migrate`, and confirm exit 1. Then revert the edit.
- `psql btg -c '\dt'` lists 19 tables plus `schema_migrations`.

NO: an ORM, seed data, Docker.

# Lift Log

Mobile-first private strength log at `/lift-log`. Next.js App Router, React,
Tailwind, PostgreSQL. No LLM calls or third-party training-data APIs.

## Features

- Rolling A/B full-body sessions, independent of weekdays. Boxing / HIIT and
  incline / stair cardio have separate check-ins.
- Weight, repetitions and RIR per completed set; unfinished sets never count.
- Current strength estimates, all-time estimated PR, per-lift time-series,
  training volume and editable e1RM goals.
- Actual dated weight × reps assessments (1–10 reps), with optional RIR.
- Load and volume reductions after absence, short recovery, recent hard cardio
  and reported fatigue. Pain blocks starting a loaded session.
- Double progression: every target set must hit the upper rep bound with at
  least two reps remaining. Two poor exposures trigger a reduction.
- Browser-local workout drafts survive refresh. Completed records persist in
  PostgreSQL across devices. Explicit failures, idempotent session retries,
  optimistic concurrency, deletion of mistakes and JSON export.

### Training rules

These are conservative heuristics, not medical prescriptions or a physiological
model. A session is normally 2–3 straight working sets per lift, not top/back-off
sets. A: squat, bench, chest-supported row, Romanian deadlift. B: deadlift, press,
pulldown, lighter bench and squat. Two strength sessions and one boxing session
per rolling seven days are targets, not requirements or locked days.

Epley e1RM uses `weight * (1 + (reps + RIR) / 30)`, except a true maximal single
uses the original weight. Only sets with at most 10 reps and RIR <=3 contribute.
Historical best is never blindly used as a training weight. Current reference
uses the median of up to three latest samples within 42 days of the latest
sample, excluding samples before the latest explicit assessment. Dates remain
visible and stale samples reduce prescriptions; these are not measured 1RMs.

After a >=14-day gap, the three-session return ramp resets. No training history
also starts conservatively. Phase factors are .85/.90/.95 across return
sessions, .80 after >=28 days and .70 after >=90 days. Sample-age factors are
.90/.80/.70 at 14/28/90 days. The stricter factor wins, rather than multiplying
both penalties. Fatigue and inadequate recovery can reduce further. A new
assessment updates load but does not erase time away from training. Goals never
force increases. All weights are rounded down to configurable plate increments.

The planner does not derive one exercise from a different exercise, assume an
empty bar is safe, or encourage testing true failure. Missing data requires
manual calibration. Changing gym machines requires recalibration.

## Development

```sh
cd web
npm ci
npm test
npm run typecheck
npm run build
```

End-to-end tests use an **isolated**, disposable `postgres:16-alpine` instance on
`127.0.0.1:55435`, database/role `lift_test`, password `ephemeral-test-only`.
Apply `db/schema.sql` first; never use production. Reset the test schema before
each test (the suite does this automatically). Install the Playwright headless Chromium dependency, then run
`npm run test:e2e`. Tests exercise a real production build and real PostgreSQL.
`npm run build` prepares the standalone static assets; `npm start` runs the same
standalone server used in the container.

## Production deployment

1. Obtain operator approval before creating or editing private credentials.
   Pass the chosen login key through stdin to `node scripts/provision-env.mjs`.
   It creates independent app/monitor passwords in `~/.config/lift-log.env`,
   writes the app `.env` with a SHA-256 key digest and a random session signing
   secret, and appends read-only monitoring credentials to the status `.env`.
   All private files are mode 600; existing service credentials are never
   overwritten. Then run `bash db/bootstrap.sh`.
2. Keep `PUBLIC_ORIGIN` equal to the external HTTPS origin, with no path or
   trailing slash. Never put the key, key digest, or signing secret in source.
3. `docker compose up -d --build`. App port: loopback `3015`. Container joins
   `traffic-monitor_default`, uses the shared `db`, runs as non-root, and has a
   read-only filesystem. PostgreSQL is the only completed-record storage.
4. Install `nginx/lift-log-rate-limit.conf` into `/etc/nginx/conf.d/`.
   Install the other two `nginx/*.conf` files into `/etc/nginx/snippets/`;
   add `include snippets/lift-log.conf;` to the HTTPS
   server in `/etc/nginx/sites-enabled/personal-site`, preserving other routes.
   Run `sudo nginx -t && sudo nginx -s reload`.
5. Merge the `feat/lift-log` integration branches in `WhatsFish/site-index` and
   `WhatsFish/status`, then rebuild the status `web` container. The provisioning
   script already adds `LIFT_PG_*` for the least-privileged monitoring role.
6. Operator creates an Umami website if tracking is desired, then supplies
   `NEXT_PUBLIC_UMAMI_SRC` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID`. The layout enables
   the script only when both are configured. No personal training fields are
   sent as analytics events.
7. Verify public health is 200, private APIs are 401 without a session and the
   home page redirects to `/lift-log/login`, then
   check authenticated phone workflows and the status group. Back up the
   `lift_log` database using the fleet's PostgreSQL backup procedure.

No cron jobs or AI calls are used, so heartbeats and AI cost events are not
applicable. A long absence is normal usage, not a service health failure. Status
uses a read-only view exposing only initialization and last-write metadata, not
sets, notes, goals or PRs.

### Trust boundary and dependency note

This is a single-owner key-login app, not multi-user SaaS. The key is checked
using a constant-time digest comparison; it is not embedded in client code.
HMAC-signed sessions last seven days in HttpOnly, Secure, SameSite=Strict cookies.
Nginx rate-limits login both per IP and globally. A weak chosen key remains weaker
than a long random key despite throttling. Changing `SESSION_SECRET` invalidates
all sessions; changing only the key digest does not revoke existing sessions.
Never expose port 3015 beyond loopback or publish the container on an untrusted
network. Health returns only availability. Mutations require same-origin JSON;
exported JSON contains private training information.

This new service uses **Next.js 16.3.5 / React 19.3.0**, rather than the fleet's
Next 14 / React 18 baseline. The older Next 14 line still had unresolved
production dependency advisories even after updating to 14.2.35. This scoped
deviation keeps the new app on a patched framework without changing existing
services. Node 22, TypeScript, pg, App Router, Tailwind and the deployment pattern
remain consistent with the fleet. Builds use webpack for predictable VM
resource usage. Read version-matched Next documentation under
`web/node_modules/next/dist/docs/` before future framework changes.

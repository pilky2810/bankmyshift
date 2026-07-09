# Bank My Shift — API

Backend for the Bank My Shift app: authentication, staff profiles, shift publishing/claiming with compliance and overlap checks, approvals, notifications (email + in-app), and an audit trail.

Out of scope for this build, per current requirements: clock-in/out, digital timesheets, payroll export. The database and code are structured so these can be added later without a rewrite (see `schema.sql`).

## 1. Local setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in the values — see section 3
```

You'll need a PostgreSQL database (version 14+). For local development the quickest option is Docker:

```bash
docker run --name bankmyshift-db -e POSTGRES_PASSWORD=devpassword -p 5432:5432 -d postgres:16
```

Then set `DATABASE_URL=postgres://postgres:devpassword@localhost:5432/postgres` and `DATABASE_SSL=false` in `.env`.

Apply the schema and seed the first admin account:

```bash
npm run migrate
npm run seed
```

`seed.js` prints the first admin's login — change that password on first login (or trigger the forgot-password flow, which works end to end once SendGrid is configured).

Run the API:

```bash
npm run dev      # auto-restarts on file changes
# or
npm start
```

Check it's up: `curl http://localhost:4000/health` → `{"status":"ok"}`

## 2. What's implemented

| Area | Endpoint(s) |
|---|---|
| Login | `POST /auth/login` |
| Forgot password | `POST /auth/forgot-password`, `POST /auth/reset-password` |
| Browse/filter shifts | `GET /shifts?location=&serviceType=&minPay=&date=` |
| Publish a shift (manager) | `POST /shifts` |
| Claim a shift (staff) | `POST /shifts/:id/claim` — blocks on overlap, missing training, or unapproved bank status |
| Cancel own claim (staff) | `POST /shifts/:id/cancel-claim` |
| Approve/reject a request (manager) | `POST /shifts/:id/decide` |
| Cancel a shift outright (manager) | `POST /shifts/:id/cancel` |
| Staff directory (manager) | `GET /staff`, `POST /staff`, `PATCH /staff/:id/approval` |
| Own profile | `GET /staff/me` |
| Training records (manager) | `POST /staff/:id/training` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read` |

Every state-changing action writes to `audit_log` (who, what, when) — see `src/middleware/auditLog.js`.

## 3. Environment variables

See `.env.example` for the full list. The two you can't skip:

- `DATABASE_URL` — your Postgres connection string
- `JWT_SECRET` — generate with `openssl rand -base64 48`

For real email delivery (password resets, shift notifications), sign up for [SendGrid](https://sendgrid.com) (or swap in another provider in `src/services/emailService.js`), verify your sending domain, and set `SENDGRID_API_KEY` + `EMAIL_FROM`. Without this, the API still works but only logs to the console instead of sending — useful for local testing, not for the pilot.

## 4. Deploying

Any Node-friendly host with a managed Postgres add-on works. Two straightforward options:

**Render** (simple, good free tier for a pilot)
1. Push this backend to its own Git repo.
2. Create a Render **PostgreSQL** instance in an EU region (London if available) for UK data residency.
3. Create a Render **Web Service** from the repo, build command `npm install`, start command `npm start`.
4. Add all `.env.example` variables in the Render dashboard, using the internal database URL Render gives you.
5. After first deploy, run `npm run migrate` and `npm run seed` using Render's shell, or a one-off job.

**Railway** — same shape: Postgres plugin + a service pointed at this repo, env vars in the dashboard.

Either way:
- Put the API behind HTTPS (both platforms do this automatically).
- Point your frontend's API base URL at the deployed backend URL.
- Set `CORS_ALLOWED_ORIGIN` to your deployed frontend's exact URL.

## 5. Connecting the frontend prototype

The React prototype currently uses in-memory mock data. To connect it to this API:
1. Replace the mock `staff`/`shifts`/`notifs` state with `fetch` calls to these endpoints.
2. Store the JWT from `/auth/login` in memory (not localStorage — see the prototype's storage restrictions) and send it as `Authorization: Bearer <token>` on every request.
3. Replace the client-side claim/approve/cancel logic with calls to the corresponding endpoints above; let the server be the source of truth.

Happy to do this wiring as the next step once the backend is deployed and you've got real values in `.env`.

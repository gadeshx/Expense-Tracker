# Expense Tracker

A server-rendered expense tracking app built with TypeScript, Express, EJS and PostgreSQL. Users sign up, log in, record expenses by category, and see a monthly summary. It started as a project to practice TypeScript, so a lot of the design is about letting the type system, the validation layer and the database agree with each other.

## Features

- Sign up, log in and log out with session-based authentication (passwords hashed with bcrypt)
- Add, edit and delete expenses (amount, category, description, date)
- Every query is scoped to the logged-in user, so one user can never read, change or delete another user's data
- Monthly summary: the total for a chosen month and a total per category
- Server-side validation with Zod, backed by matching database constraints

## Tech stack

| Area | Tools |
|---|---|
| Language | TypeScript (strict mode) |
| Server | Node.js, Express 5 |
| Views | EJS, Bootstrap 5, a small custom stylesheet |
| Database | PostgreSQL via `pg` |
| Auth | `express-session` with `connect-pg-simple` (sessions stored in Postgres), `bcrypt` |
| Validation | Zod |
| Dev tooling | `tsx` (run and watch TypeScript directly) |

## Getting started

### Prerequisites

- Node.js 20 or newer
- PostgreSQL

### Setup

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Create the database and load the schema (it creates the `users`, `expenses` and `session` tables):

   ```bash
   createdb expenses_tracker
   psql -d expenses_tracker -f schema.sql
   ```

3. Create your environment file and fill in the values:

   ```bash
   cp .env.example .env
   ```

   Generate a session secret with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

   Then open http://localhost:3000.

### Environment variables

| Variable | Description |
|---|---|
| `DB_USER` | PostgreSQL user |
| `DB_HOST` | Database host (usually `localhost`) |
| `DB_PASSWORD` | PostgreSQL password. The app refuses to start without it |
| `DB_DATABASE` | Database name |
| `DB_PORT` | Database port (usually `5432`) |
| `SESSION_SECRET` | Long random string used to sign the session cookie. The app refuses to start without it |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run `index.ts` with `tsx` and restart on every change |
| `npm run build` | Type-check and compile to `dist/` |
| `npm start` | Run the compiled app from `dist/` (run it from the project root so Express finds `views/` and `public/`) |

You can also run `npx tsc --noEmit` at any time to type-check without producing files.

## Project structure

```
index.ts          App setup, middleware and routes
db.ts             PostgreSQL connection pool
queries.ts        Typed database functions (the routes never call db.query directly)
auth.ts           Password hashing and comparison (bcrypt)
validation.ts     Zod schemas and the validate functions
types.ts          Shared types, the category list and its type guard
session.d.ts      Adds userId and name to the express-session types
schema.sql        Tables, constraints and the session table
views/            EJS templates (partials/header.ejs is the shared header)
public/style/     Stylesheet (main.css)
```

## Design notes

- **One source of truth for categories.** `CATEGORY_OPTIONS` is a `const` array. The `CategoryOption` type, the form dropdown, the Zod schema and the type guard are all derived from it, and the database has a matching `CHECK` constraint.
- **Types describe what really exists.** A database row, the data used to create a row and the data a form sends are separate types, derived from each other with `Omit`, `Partial` and `Required` instead of being retyped.
- **Money is handled as text, not floats.** `NUMERIC(12, 2)` comes back from `pg` as a string. Amounts are rounded once in the validation layer and totals are summed in SQL, so there is no floating-point arithmetic on money.
- **Ownership is enforced in SQL.** Every read, update and delete includes `user_id` in its `WHERE` clause, and the user id always comes from the session, never from the request body or URL.
- **Validation lives in two places on purpose.** Zod gives users clear messages, and the database constraints (`CHECK` on category and on `amount > 0`, `DATE` column) are the last line of defense.
- **Untrusted values never reach SQL as text.** The sort order and month come from an allowlist or a strict format check, and every user value is a query parameter.

## Security notes

- Passwords are hashed with bcrypt (cost 12), never trimmed and limited to 72 bytes, which is all bcrypt reads
- Unknown email and wrong password produce the same message and status
- The session id is regenerated on login and sign-up
- Session cookies are `HttpOnly` and `SameSite=Lax`. Set `secure: true` when serving over HTTPS
- Logout and delete are POST requests, never links
- Passwords are never sent back to a page, even after a failed submit

## Roadmap

- JSON API version of the same routes, with consistent responses and an error-handling middleware
- Automated tests for the routes (including the "another user's data" cases)
- Deployment

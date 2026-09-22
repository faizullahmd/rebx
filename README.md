# REBX

Real estate broker exchange platform. Agents list properties; the platform is a CRM tracking each
listing from creation through to commission received from developers and customers.

This is the **foundation** build: project setup, auth, role-based dashboards, and property listing
CRUD. Leads, the deal pipeline, and commission tracking are a later pass.

## Stack

- Next.js 16 (App Router), TypeScript, Tailwind CSS
- Postgres via Prisma ORM
- NextAuth.js (Auth.js) v5, Credentials provider, JWT sessions

## Roles

`AGENT` · `DEVELOPER` · `CUSTOMER` · `ADMIN`. Signup only offers Agent or Customer — Developer and
Admin accounts are promoted by an existing admin from `/admin/dashboard/users`.

## Getting started

Local Postgres runs via Docker Compose (or [Colima](https://github.com/abiosoft/colima) if you
don't have Docker Desktop installed).

```bash
docker compose up -d
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Seeded accounts (password `password123` for all):

| Role      | Email                |
| --------- | --------------------- |
| Admin     | admin@rebx.dev        |
| Agent     | agent1@rebx.dev        |
| Agent     | agent2@rebx.dev        |
| Developer | developer@rebx.dev     |
| Customer  | customer1@rebx.dev     |
| Customer  | customer2@rebx.dev     |

## Scripts

- `npm run dev` — start the dev server
- `npm run db:migrate` — run Prisma migrations
- `npm run db:seed` — reseed the database
- `npm run db:studio` — open Prisma Studio

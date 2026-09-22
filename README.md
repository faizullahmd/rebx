# REBX

Real estate broker exchange platform. Agents list properties; the platform is a CRM tracking each
listing from creation through to commission received from developers and customers.

Foundation (auth, role-based dashboards, listing CRUD) and the leads/deal pipeline are built.
Commission tracking is a later pass.

## Stack

- Next.js 16 (App Router), TypeScript, Tailwind CSS
- MySQL via Prisma ORM
- NextAuth.js (Auth.js) v5, Credentials provider, JWT sessions

## Roles

`AGENT` · `DEVELOPER` · `CUSTOMER` · `ADMIN`. Signup only offers Agent or Customer — Developer and
Admin accounts are promoted by an existing admin from `/admin/dashboard/users`.

## Getting started

Local MySQL runs via Docker Compose (or [Colima](https://github.com/abiosoft/colima) if you don't
have Docker Desktop installed).

```bash
docker compose up -d
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production (DigitalOcean)

Set `DATABASE_URL` and `AUTH_SECRET` as environment variables/secrets in the DigitalOcean app
settings — never commit real credentials. DigitalOcean's managed MySQL requires TLS; download the
cluster's CA certificate from the DO control panel and append it to the connection string, e.g.
`mysql://user:pass@host:25060/rebx?sslcert=/path/to/ca-certificate.crt&sslaccept=strict` (check
[DigitalOcean's connection docs](https://docs.digitalocean.com/products/databases/mysql/how-to/connect/)
for the exact host/port/cert for your cluster). Run `npx prisma migrate deploy` against that URL to
apply the schema before the app's first request.

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

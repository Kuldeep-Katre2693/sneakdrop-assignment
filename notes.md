# SneakDrop — Setup Notes

## Requirements

- Node.js 22+
- PostgreSQL 18+
- npm
- Git

## Database Setup

Create a PostgreSQL database named `sneakdrop`.

```sql
CREATE DATABASE sneakdrop;
```

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/sneakdrop?schema=public"
```

Replace `YOUR_PASSWORD` with the local PostgreSQL `postgres` user password.

## Install Dependencies

```bash
npm install
```

## Generate Prisma Client

```bash
npx prisma generate
```

## Run Database Migrations

```bash
npx prisma migrate dev
```

## Start Development Server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Useful Commands

Run lint:

```bash
npm run lint
```

Run concurrency tests:

```bash
npm run test:concurrency
```

Run payment tests:

```bash
npm run test:payments
```

Create a production build:

```bash
npm run build
```

## API Endpoints

### Health

```http
GET /api/health
```

### Create/load user

```http
POST /api/users
```

Body:

```json
{
  "externalId": "user-001"
}
```

### Buy

```http
POST /api/buy
```

Body:

```json
{
  "externalUserId": "user-001"
}
```

### User status

```http
GET /api/status/user-001
```

### Fake payment

```http
POST /api/payments/simulate
```

Example:

```json
{
  "holdId": "HOLD_ID",
  "delayMs": 1000
}
```

### Payment webhook

```http
POST /api/webhooks/payment
```

## Business Rules

- Initial inventory is 20 pairs.
- Each successful Buy creates a 5-minute hold.
- A user may have only one active hold.
- A user can purchase a maximum of two pairs in total.
- When stock reaches zero, users enter a FIFO waiting queue.
- When a hold expires, the first waiting user receives the pair automatically.
- Payment events are recorded and duplicate events are ignored.
- Payments arriving after a hold expires cannot create an order.
- Database transactions and PostgreSQL row locks protect inventory from overselling.

## Concurrency

The Buy operation uses a database transaction and locks the inventory row with PostgreSQL `FOR UPDATE`.

This ensures that concurrent requests cannot reserve the same sneaker pair.

A concurrency test sends 100 simultaneous Buy requests against an inventory of 20 pairs and verifies that exactly 20 users receive holds and the rest enter the queue.

## Notes

The application is intentionally implemented as a single Next.js application with TypeScript, REST Route Handlers, Prisma, and PostgreSQL.

No real payment provider is used. The payment simulator is intentionally capable of delayed and duplicate delivery for testing.
# SneakDrop

A concurrency-safe limited sneaker drop system built with Next.js, TypeScript, Prisma, and PostgreSQL.

## Problem

The store has only 20 sneaker pairs, but thousands of users may click Buy simultaneously.

The system must guarantee that the store never sells more pairs than are available while supporting temporary holds, automatic expiry, a FIFO waiting queue, and unreliable payment events.

## Tech Stack

- Next.js
- TypeScript
- PostgreSQL
- Prisma
- REST APIs
- Tailwind CSS
- Git/GitHub

## Core Features

### Limited Inventory

The system starts with 20 available pairs.

### Five-Minute Holds

A successful Buy request creates a five-minute hold.

### User Purchase Rules

- One active hold per user.
- Maximum two completed purchases per user.

### FIFO Waiting Queue

When inventory reaches zero, new users are placed in a first-in, first-out waiting queue.

When an active hold expires, the first waiting user automatically receives a new five-minute hold.

### Fake Payment System

The application includes a fake payment provider that can deliver:

- delayed payments
- duplicate events
- out-of-order events

Payment processing is idempotent and expired holds cannot be resurrected by late payments.

### Concurrency Protection

The Buy transaction uses PostgreSQL row locking to protect the limited inventory from concurrent requests.

A dedicated concurrency test sends 100 simultaneous Buy requests and verifies that exactly 20 reservations are created.

## Architecture

```text
Next.js UI
    |
    | REST API
    v
Next.js Route Handlers
    |
    v
Service Layer
    |
    v
Prisma
    |
    v
PostgreSQL
```

## Running the Project

See [NOTES.md](./NOTES.md) for complete setup instructions.

Basic startup:

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

Open:

```text
http://localhost:3000
```

## Testing

```bash
npm run lint
npm run test:concurrency
npm run test:payments
npm run build
```

## Assignment

The original assignment specification is preserved in [ASSIGNMENT.md](./ASSIGNMENT.md).
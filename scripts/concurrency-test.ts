import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const BASE_URL = "http://localhost:3000";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

async function resetDatabase() {
  console.log("Resetting test data...");

  await prisma.paymentEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.hold.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.user.deleteMany();

  await prisma.inventory.upsert({
    where: {
      id: 1,
    },
    update: {
      totalStock: 20,
      availableStock: 20,
    },
    create: {
      id: 1,
      totalStock: 20,
      availableStock: 20,
    },
  });
}

async function createUsers(count: number) {
  console.log(`Creating ${count} users...`);

  await prisma.user.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      externalId: `load-test-${index + 1}`,
    })),
  });
}

async function sendBuyRequest(userId: string) {
  const response = await fetch(`${BASE_URL}/api/buy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      externalUserId: userId,
    }),
  });

  const data = await response.json();

  return {
    userId,
    statusCode: response.status,
    data,
  };
}

async function testManyUsers() {
  console.log("\n=== TEST 1: 100 CONCURRENT USERS ===\n");

  await resetDatabase();
  await createUsers(100);

  const userIds = Array.from(
    { length: 100 },
    (_, index) => `load-test-${index + 1}`
  );

  const start = Date.now();

  const results = await Promise.all(
    userIds.map((userId) => sendBuyRequest(userId))
  );

  const duration = Date.now() - start;

  const held = results.filter(
    (result) => result.data?.status === "HELD"
  );

  const waiting = results.filter(
    (result) => result.data?.status === "WAITING"
  );

  const errors = results.filter(
    (result) =>
      result.statusCode >= 500 ||
      result.data?.success === false
  );

  const inventory = await prisma.inventory.findUnique({
    where: {
      id: 1,
    },
  });

  const activeHolds = await prisma.hold.count({
    where: {
      status: "ACTIVE",
    },
  });

  const waitingEntries = await prisma.queueEntry.count({
    where: {
      status: "WAITING",
    },
  });

  console.log(`Completed in: ${duration} ms`);
  console.log(`HTTP successful holds: ${held.length}`);
  console.log(`HTTP waiting users: ${waiting.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Database active holds: ${activeHolds}`);
  console.log(`Database waiting entries: ${waitingEntries}`);
  console.log(
    `Available stock: ${inventory?.availableStock}`
  );

  if (
    held.length !== 20 ||
    waiting.length !== 80 ||
    errors.length !== 0 ||
    activeHolds !== 20 ||
    waitingEntries !== 80 ||
    inventory?.availableStock !== 0
  ) {
    throw new Error(
      "❌ CONCURRENCY TEST FAILED"
    );
  }

  console.log(
    "✅ CONCURRENCY TEST PASSED: exactly 20 pairs reserved."
  );
}

async function testSameUser() {
  console.log(
    "\n=== TEST 2: SAME USER CONCURRENT REQUESTS ===\n"
  );

  await resetDatabase();

  await prisma.user.create({
    data: {
      externalId: "spam-user",
    },
  });

  const requests = Array.from(
    { length: 100 },
    () => sendBuyRequest("spam-user")
  );

  const results = await Promise.all(requests);

  const successfulHolds = results.filter(
    (result) => result.data?.status === "HELD"
  );

  const conflicts = results.filter(
    (result) => result.statusCode === 409
  );

  const activeHolds = await prisma.hold.count({
    where: {
      user: {
        externalId: "spam-user",
      },
      status: "ACTIVE",
    },
  });

  console.log(
    `Successful holds: ${successfulHolds.length}`
  );

  console.log(`409 conflicts: ${conflicts.length}`);

  console.log(
    `Database active holds: ${activeHolds}`
  );

  if (
    successfulHolds.length !== 1 ||
    activeHolds !== 1
  ) {
    throw new Error(
      "❌ SAME-USER CONCURRENCY TEST FAILED"
    );
  }

  console.log(
    "✅ SAME-USER CONCURRENCY TEST PASSED."
  );
}

async function main() {
  try {
    await testManyUsers();
    await testSameUser();

    console.log(
      "\n✅ ALL CONCURRENCY TESTS PASSED"
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
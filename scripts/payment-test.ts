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
  await prisma.paymentEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.hold.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.user.deleteMany();

  await prisma.inventory.upsert({
    where: { id: 1 },
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

async function createUser(externalId: string) {
  await prisma.user.create({
    data: { externalId },
  });
}

async function buy(externalUserId: string) {
  const response = await fetch(`${BASE_URL}/api/buy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ externalUserId }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Buy failed: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function sendPayment(
  externalEventId: string,
  holdId: string
) {
  const response = await fetch(
    `${BASE_URL}/api/webhooks/payment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        externalEventId,
        holdId,
        type: "SUCCEEDED",
        eventCreatedAt: new Date().toISOString(),
      }),
    }
  );

  return {
    statusCode: response.status,
    data: await response.json(),
  };
}

async function main() {
  try {
    console.log("\n=== PAYMENT TESTS ===\n");

    await resetDatabase();

    // --------------------------------------------------
    // TEST 1: Normal successful payment
    // --------------------------------------------------

    await createUser("payment-user-1");

    const firstBuy = await buy("payment-user-1");

    if (firstBuy.status !== "HELD") {
      throw new Error("Expected first buy to create a hold");
    }

    const holdId = firstBuy.holdId;

    const firstPayment = await sendPayment(
      "payment-event-001",
      holdId
    );

    console.log(
      "Normal payment:",
      firstPayment.data
    );

    if (
      firstPayment.data.status !==
      "PAYMENT_SUCCESS"
    ) {
      throw new Error(
        "❌ Normal payment test failed"
      );
    }

    // --------------------------------------------------
    // TEST 2: Duplicate payment event
    // --------------------------------------------------

    const duplicatePayment = await sendPayment(
      "payment-event-001",
      holdId
    );

    console.log(
      "Duplicate payment:",
      duplicatePayment.data
    );

    if (
      duplicatePayment.data.status !==
      "DUPLICATE_EVENT"
    ) {
      throw new Error(
        "❌ Duplicate payment test failed"
      );
    }

    // --------------------------------------------------
    // TEST 3: Same hold, different success event
    // --------------------------------------------------

    const secondSuccess = await sendPayment(
      "payment-event-002",
      holdId
    );

    console.log(
      "Second success event:",
      secondSuccess.data
    );

    if (
      secondSuccess.data.status !==
      "ALREADY_PAID"
    ) {
      throw new Error(
        "❌ Already-paid protection test failed"
      );
    }

    const user1 = await prisma.user.findUnique({
      where: {
        externalId: "payment-user-1",
      },
    });

    const orderCount = await prisma.order.count({
      where: {
        user: {
          externalId: "payment-user-1",
        },
      },
    });

    if (
      user1?.totalPurchased !== 1 ||
      orderCount !== 1
    ) {
      throw new Error(
        "❌ Duplicate payment created an invalid order state"
      );
    }

    console.log(
      "✅ Duplicate/idempotency protection passed"
    );

    // --------------------------------------------------
    // TEST 4: Late payment
    // --------------------------------------------------

    await createUser("payment-user-2");

    const secondBuy = await buy("payment-user-2");

    if (secondBuy.status !== "HELD") {
      throw new Error(
        "Expected second user to receive a hold"
      );
    }

    await prisma.hold.update({
      where: {
        id: secondBuy.holdId,
      },
      data: {
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const latePayment = await sendPayment(
      "payment-event-late",
      secondBuy.holdId
    );

    console.log(
      "Late payment:",
      latePayment.data
    );

    const acceptedLateStatuses = [
      "PAYMENT_TOO_LATE",
      "HOLD_NOT_ACTIVE",
    ];

    if (
      !acceptedLateStatuses.includes(
        latePayment.data.status
      )
    ) {
      throw new Error(
        "❌ Late payment protection failed"
      );
    }

    const user2 = await prisma.user.findUnique({
      where: {
        externalId: "payment-user-2",
      },
    });

    const lateOrderCount =
      await prisma.order.count({
        where: {
          user: {
            externalId: "payment-user-2",
          },
        },
      });

    if (
      user2?.totalPurchased !== 0 ||
      lateOrderCount !== 0
    ) {
      throw new Error(
        "❌ Late payment incorrectly created an order"
      );
    }

    console.log(
      "✅ Late payment protection passed"
    );

    console.log(
      "\n✅ ALL PAYMENT TESTS PASSED\n"
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
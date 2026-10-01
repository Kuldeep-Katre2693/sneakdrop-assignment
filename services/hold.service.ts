import {
  HoldStatus,
  QueueStatus,
} from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

const INVENTORY_ID = 1;

export async function ensureInventory() {
  return prisma.inventory.upsert({
    where: {
      id: INVENTORY_ID,
    },
    update: {},
    create: {
      id: INVENTORY_ID,
      totalStock: 20,
      availableStock: 20,
    },
  });
}

export async function expireExpiredHolds() {
  const now = new Date();

  const expiredHolds = await prisma.hold.findMany({
    where: {
      status: HoldStatus.ACTIVE,
      expiresAt: {
        lte: now,
      },
    },
    select: {
      id: true,
    },
  });

  let processed = 0;

  for (const expired of expiredHolds) {
    const didProcess = await prisma.$transaction(
      async (tx) => {
        /*
         * Lock the hold row.
         *
         * Multiple expiry workers could discover the same hold.
         * Only one transaction should actually process it.
         */
        const lockedHolds = await tx.$queryRaw<
          { id: string; userId: string; expiresAt: Date }[]
        >`
          SELECT
            id,
            "userId",
            "expiresAt"
          FROM "Hold"
          WHERE id = ${expired.id}
            AND status = 'ACTIVE'
          FOR UPDATE
        `;

        const hold = lockedHolds[0];

        if (!hold) {
          return false;
        }

        /*
         * Re-check expiration after acquiring the lock.
         */
        if (hold.expiresAt > new Date()) {
          return false;
        }

        /*
         * Lock inventory.
         */
        const inventoryRows = await tx.$queryRaw<
          { id: number; availableStock: number }[]
        >`
          SELECT
            id,
            "availableStock"
          FROM "Inventory"
          WHERE id = ${INVENTORY_ID}
          FOR UPDATE
        `;

        if (!inventoryRows[0]) {
          throw new Error("INVENTORY_NOT_FOUND");
        }

        /*
         * Pick the first waiting user.
         *
         * createdAt + id gives deterministic FIFO ordering.
         */
        const queueRows = await tx.$queryRaw<
          { id: string; userId: string }[]
        >`
          SELECT
            id,
            "userId"
          FROM "QueueEntry"
          WHERE status = 'WAITING'
          ORDER BY "createdAt" ASC, id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `;

        const nextQueueEntry = queueRows[0];

        if (nextQueueEntry) {
          /*
           * Give the expired pair directly to the first
           * waiting customer. Stock stays unchanged.
           */
          const newExpiresAt = new Date(
            Date.now() + 5 * 60 * 1000
          );

          await tx.hold.update({
            where: {
              id: hold.id,
            },
            data: {
              status: HoldStatus.EXPIRED,
            },
          });

          await tx.queueEntry.update({
            where: {
              id: nextQueueEntry.id,
            },
            data: {
              status: QueueStatus.PROMOTED,
              promotedAt: new Date(),
            },
          });

          await tx.hold.create({
            data: {
              userId: nextQueueEntry.userId,
              status: HoldStatus.ACTIVE,
              expiresAt: newExpiresAt,
            },
          });
        } else {
          /*
           * Nobody waiting.
           * Return the pair to available inventory.
           */
          await tx.hold.update({
            where: {
              id: hold.id,
            },
            data: {
              status: HoldStatus.EXPIRED,
            },
          });

          await tx.inventory.update({
            where: {
              id: INVENTORY_ID,
            },
            data: {
              availableStock: {
                increment: 1,
              },
            },
          });
        }

        return true;
      },
      {
        maxWait: 5000,
        timeout: 10000,
      }
    );

    if (didProcess) {
      processed++;
    }
  }

  return processed;
}
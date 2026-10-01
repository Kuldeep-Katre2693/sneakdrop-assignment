import { prisma } from "@/lib/prisma";
import { HoldStatus, QueueStatus } from "@/generated/prisma/client";
import {
  ensureInventory,
} from "@/services/hold.service";

const INVENTORY_ID = 1;
const HOLD_DURATION_MS = 5 * 60 * 1000;

export type BuyResult =
  | {
      status: "HELD";
      holdId: string;
      expiresAt: Date;
      availableStock: number;
    }
  | {
      status: "WAITING";
      queueEntryId: string;
      queuePosition: number;
    };
export async function buySneaker(
  externalUserId: string
): Promise<BuyResult> {
    await ensureInventory();

  return prisma.$transaction(
    async (tx) => {
      /*
       * Lock the user row.
       *
       * This prevents concurrent requests from the same user
       * from both passing the business-rule checks.
       */
      const user = await tx.user.findUnique({
        where: {
          externalId: externalUserId,
        },
      });

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      await tx.$queryRaw`
        SELECT id
        FROM "User"
        WHERE id = ${user.id}
        FOR UPDATE
      `;

      /*
       * A user can have only one active hold.
       */
      const activeHold = await tx.hold.findFirst({
        where: {
          userId: user.id,
          status: HoldStatus.ACTIVE,
        },
      });

      if (activeHold) {
        throw new Error("ACTIVE_HOLD_EXISTS");
      }

      /*
       * A user can purchase at most 2 pairs in total.
       */
      if (user.totalPurchased >= 2) {
        throw new Error("PURCHASE_LIMIT_REACHED");
      }

      /*
       * Prevent the same user from entering the waiting queue
       * multiple times.
       */
      const existingQueueEntry = await tx.queueEntry.findFirst({
        where: {
          userId: user.id,
          status: QueueStatus.WAITING,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      /*
       * Lock the single inventory row.
       *
       * This is the critical concurrency-control operation.
       * PostgreSQL will make competing BUY transactions wait
       * until the current transaction finishes.
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

      let inventory = inventoryRows[0];

      /*
       * Create the inventory row if it doesn't exist yet.
       */
      if (!inventory) {
        await tx.inventory.upsert({
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

        const rows = await tx.$queryRaw<
          { id: number; availableStock: number }[]
        >`
          SELECT
            id,
            "availableStock"
          FROM "Inventory"
          WHERE id = ${INVENTORY_ID}
          FOR UPDATE
        `;

        inventory = rows[0];

        if (!inventory) {
          throw new Error("INVENTORY_NOT_FOUND");
        }
      }

      /*
       * If the user is already waiting, return their current
       * queue position instead of creating a duplicate entry.
       */
      if (existingQueueEntry) {
        const queueAhead = await tx.queueEntry.count({
          where: {
            status: QueueStatus.WAITING,
            createdAt: {
              lte: existingQueueEntry.createdAt,
            },
          },
        });

        return {
          status: "WAITING",
          queueEntryId: existingQueueEntry.id,
          queuePosition: queueAhead,
        };
      }

      /*
       * Pair available -> create a 5-minute hold.
       */
      if (inventory.availableStock > 0) {
        const expiresAt = new Date(
          Date.now() + HOLD_DURATION_MS
        );

        const hold = await tx.hold.create({
          data: {
            userId: user.id,
            status: HoldStatus.ACTIVE,
            expiresAt,
          },
        });

        const updatedInventory =
          await tx.inventory.update({
            where: {
              id: INVENTORY_ID,
            },
            data: {
              availableStock: {
                decrement: 1,
              },
            },
          });

        return {
          status: "HELD",
          holdId: hold.id,
          expiresAt: hold.expiresAt,
          availableStock: updatedInventory.availableStock,
        };
      }

      /*
       * No stock -> join FIFO queue.
       */
      const queueEntry = await tx.queueEntry.create({
        data: {
          userId: user.id,
          status: QueueStatus.WAITING,
        },
      });

      const queuePosition = await tx.queueEntry.count({
        where: {
          status: QueueStatus.WAITING,
          createdAt: {
            lte: queueEntry.createdAt,
          },
        },
      });

      return {
        status: "WAITING",
        queueEntryId: queueEntry.id,
        queuePosition,
      };
    },
    {
      maxWait: 5000,
      timeout: 10000,
    }
  );
}
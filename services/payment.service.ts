import {
  HoldStatus,
  OrderStatus,
  PaymentEventType,
  QueueStatus,
} from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

const INVENTORY_ID = 1;
const HOLD_DURATION_MS = 5 * 60 * 1000;

type PaymentInput = {
  externalEventId: string;
  holdId: string;
  type: PaymentEventType;
  eventCreatedAt: Date;
  payload?: unknown;
};

export async function processPaymentEvent(input: PaymentInput) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        /*
         * Idempotency:
         * If exactly the same external event arrives again,
         * do not process it twice.
         */
        const existingEvent =
          await tx.paymentEvent.findUnique({
            where: {
              externalEventId: input.externalEventId,
            },
          });

        if (existingEvent) {
          return {
            status: "DUPLICATE_EVENT",
            eventId: existingEvent.id,
          };
        }

        /*
         * Record the payment event before processing its
         * business effect.
         */
        const paymentEvent =
          await tx.paymentEvent.create({
            data: {
              externalEventId: input.externalEventId,
              holdId: input.holdId,
              type: input.type,
              eventCreatedAt: input.eventCreatedAt,
              payload: input.payload as object | undefined,
            },
          });

        /*
         * A failed payment is only recorded.
         *
         * The assignment primarily requires successful
         * payment handling, so a FAILED event never creates
         * an order or changes stock.
         */
        if (input.type === PaymentEventType.FAILED) {
          return {
            status: "PAYMENT_FAILED",
            eventId: paymentEvent.id,
          };
        }

        /*
         * Lock the hold before checking or modifying it.
         *
         * This prevents a payment transaction from racing
         * with the hold-expiration worker.
         */
        const lockedHolds = await tx.$queryRaw<
          {
            id: string;
            userId: string;
            status: string;
            expiresAt: Date;
          }[]
        >`
          SELECT
            id,
            "userId",
            status,
            "expiresAt"
          FROM "Hold"
          WHERE id = ${input.holdId}
          FOR UPDATE
        `;

        const hold = lockedHolds[0];

        if (!hold) {
          return {
            status: "HOLD_NOT_FOUND",
            eventId: paymentEvent.id,
          };
        }

        /*
         * A different payment event may already have paid
         * this hold.
         */
        if (hold.status === HoldStatus.CONVERTED) {
          return {
            status: "ALREADY_PAID",
            eventId: paymentEvent.id,
          };
        }

        /*
         * If the hold was already cancelled/expired,
         * a late payment cannot resurrect it.
         */
        if (hold.status !== HoldStatus.ACTIVE) {
          return {
            status: "HOLD_NOT_ACTIVE",
            eventId: paymentEvent.id,
          };
        }

        /*
         * Lock the user before changing totalPurchased.
         */
        await tx.$queryRaw`
          SELECT id
          FROM "User"
          WHERE id = ${hold.userId}
          FOR UPDATE
        `;

        const user = await tx.user.findUnique({
          where: {
            id: hold.userId,
          },
        });

        if (!user) {
          throw new Error("USER_NOT_FOUND");
        }

        /*
         * If the hold expired but the expiry worker has not
         * processed it yet, handle the expiry right here.
         *
         * This closes the race between payment arrival and
         * background expiration.
         */
        if (hold.expiresAt <= new Date()) {
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

          await tx.hold.update({
            where: {
              id: hold.id,
            },
            data: {
              status: HoldStatus.EXPIRED,
            },
          });

          if (nextQueueEntry) {
            /*
             * Transfer the expired pair directly to the
             * first waiting user.
             */
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
                expiresAt: new Date(
                  Date.now() + HOLD_DURATION_MS
                ),
              },
            });
          } else {
            /*
             * Nobody is waiting, so return the pair to stock.
             */
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

          return {
            status: "PAYMENT_TOO_LATE",
            eventId: paymentEvent.id,
          };
        }

        /*
         * Double-check the purchase limit.
         */
        if (user.totalPurchased >= 2) {
          return {
            status: "PURCHASE_LIMIT_REACHED",
            eventId: paymentEvent.id,
          };
        }

        /*
         * Convert the hold into exactly one order.
         */
        const order = await tx.order.create({
          data: {
            userId: user.id,
            holdId: hold.id,
            status: OrderStatus.PAID,
            paidAt: new Date(),
          },
        });

        await tx.hold.update({
          where: {
            id: hold.id,
          },
          data: {
            status: HoldStatus.CONVERTED,
          },
        });

        await tx.user.update({
          where: {
            id: user.id,
          },
          data: {
            totalPurchased: {
              increment: 1,
            },
          },
        });

        return {
          status: "PAYMENT_SUCCESS",
          eventId: paymentEvent.id,
          orderId: order.id,
        };
      },
      {
        maxWait: 5000,
        timeout: 10000,
      }
    );
  } catch (error) {
    console.error("Payment processing failed:", error);

    throw error;
  }
}
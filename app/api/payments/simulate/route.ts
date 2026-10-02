import { NextRequest, NextResponse } from "next/server";

import { PaymentEventType } from "@/generated/prisma/client";

import { processPaymentEvent } from "@/services/payment.service";

async function deliverEvent(event: {
  externalEventId: string;
  holdId: string;
  type: PaymentEventType;
  eventCreatedAt: Date;
}) {
  try {
    const result = await processPaymentEvent(event);

    console.log(
      `[FakePaymentProvider] Delivered ${event.type}`,
      result
    );
  } catch (error) {
    console.error(
      "[FakePaymentProvider] Delivery failed:",
      error
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const holdId =
      typeof body.holdId === "string"
        ? body.holdId.trim()
        : "";

    if (!holdId) {
      return NextResponse.json(
        {
          success: false,
          message: "holdId is required",
        },
        { status: 400 }
      );
    }

    const delayMs =
      typeof body.delayMs === "number" &&
      body.delayMs >= 0
        ? Math.min(body.delayMs, 5 * 60 * 1000)
        : 1000;

    const duplicate =
      body.duplicate === true;

    const outOfOrder =
      body.outOfOrder === true;

    const baseEventId =
      `fake-payment-${crypto.randomUUID()}`;

    const successEvent = {
      externalEventId: baseEventId,
      holdId,
      type: PaymentEventType.SUCCEEDED,
      eventCreatedAt: new Date(),
    };

    /*
     * Normal payment:
     * wait, then send SUCCEEDED.
     */
    if (!outOfOrder) {
      setTimeout(() => {
        void deliverEvent(successEvent);
      }, delayMs);

      /*
       * Same exact event delivered twice.
       * This tests idempotency.
       */
      if (duplicate) {
        setTimeout(() => {
          void deliverEvent(successEvent);
        }, delayMs + 500);
      }

      return NextResponse.json({
        success: true,
        message: "Fake payment scheduled",
        externalEventId: baseEventId,
        delayMs,
        duplicate,
      });
    }

    /*
     * Out-of-order simulation:
     *
     * SUCCESS arrives first.
     * FAILED arrives later.
     *
     * The later FAILED event must not undo
     * an already completed order.
     */
    setTimeout(() => {
      void deliverEvent(successEvent);
    }, delayMs);

    const failedEvent = {
      externalEventId:
        `${baseEventId}-failed`,
      holdId,
      type: PaymentEventType.FAILED,
      eventCreatedAt: new Date(
        Date.now() + delayMs + 500
      ),
    };

    setTimeout(() => {
      void deliverEvent(failedEvent);
    }, delayMs + 500);

    return NextResponse.json({
      success: true,
      message: "Out-of-order fake payment scheduled",
      successEventId: baseEventId,
      failedEventId: failedEvent.externalEventId,
      delayMs,
    });
  } catch (error) {
    console.error(
      "Fake payment simulation failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message: "Unable to schedule fake payment",
      },
      { status: 500 }
    );
  }
}
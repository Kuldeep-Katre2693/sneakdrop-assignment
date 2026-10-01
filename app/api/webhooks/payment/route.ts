import { NextRequest, NextResponse } from "next/server";

import { PaymentEventType } from "@/generated/prisma/client";
import { processPaymentEvent } from "@/services/payment.service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const externalEventId =
      typeof body.externalEventId === "string"
        ? body.externalEventId.trim()
        : "";

    const holdId =
      typeof body.holdId === "string"
        ? body.holdId.trim()
        : "";

    const type =
      body.type === "FAILED"
        ? PaymentEventType.FAILED
        : body.type === "SUCCEEDED"
          ? PaymentEventType.SUCCEEDED
          : null;

    if (!externalEventId || !holdId || !type) {
      return NextResponse.json(
        {
          success: false,
          message:
            "externalEventId, holdId and valid type are required",
        },
        { status: 400 }
      );
    }

    const eventCreatedAt = body.eventCreatedAt
      ? new Date(body.eventCreatedAt)
      : new Date();

    if (Number.isNaN(eventCreatedAt.getTime())) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid eventCreatedAt",
        },
        { status: 400 }
      );
    }

    const result = await processPaymentEvent({
      externalEventId,
      holdId,
      type,
      eventCreatedAt,
      payload: body.payload,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Payment webhook failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Payment webhook processing failed",
      },
      { status: 500 }
    );
  }
}
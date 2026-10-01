import { NextRequest, NextResponse } from "next/server";
import { buySneaker } from "@/services/buy.service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const externalUserId =
      typeof body.externalUserId === "string"
        ? body.externalUserId.trim()
        : "";

    if (!externalUserId) {
      return NextResponse.json(
        {
          success: false,
          message: "externalUserId is required",
        },
        { status: 400 }
      );
    }

    const result = await buySneaker(externalUserId);

    if (result.status === "HELD") {
      return NextResponse.json(
        {
          success: true,
          status: "HELD",
          holdId: result.holdId,
          expiresAt: result.expiresAt,
          availableStock: result.availableStock,
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        status: "WAITING",
        queueEntryId: result.queueEntryId,
        queuePosition: result.queuePosition,
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof Error) {
      switch (error.message) {
        case "USER_NOT_FOUND":
          return NextResponse.json(
            {
              success: false,
              message: "User not found",
            },
            { status: 404 }
          );

        case "ACTIVE_HOLD_EXISTS":
          return NextResponse.json(
            {
              success: false,
              message: "User already has an active hold",
            },
            { status: 409 }
          );

        case "PURCHASE_LIMIT_REACHED":
          return NextResponse.json(
            {
              success: false,
              message: "Maximum purchase limit of 2 reached",
            },
            { status: 409 }
          );
      }
    }

    console.error("Buy request failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to process buy request",
      },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";

import {
  HoldStatus,
  QueueStatus,
} from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await context.params;

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "userId is required",
        },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        externalId: userId,
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "User not found",
        },
        { status: 404 }
      );
    }

    const inventory = await prisma.inventory.findUnique({
      where: {
        id: 1,
      },
    });

    const activeHold = await prisma.hold.findFirst({
      where: {
        userId: user.id,
        status: HoldStatus.ACTIVE,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const queueEntry = await prisma.queueEntry.findFirst({
      where: {
        userId: user.id,
        status: QueueStatus.WAITING,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    let queuePosition: number | null = null;

    if (queueEntry) {
      queuePosition =
        1 +
        (await prisma.queueEntry.count({
          where: {
            status: QueueStatus.WAITING,
            OR: [
              {
                createdAt: {
                  lt: queueEntry.createdAt,
                },
              },
              {
                createdAt: queueEntry.createdAt,
                id: {
                  lt: queueEntry.id,
                },
              },
            ],
          },
        }));
    }

    const now = Date.now();

    const secondsRemaining = activeHold
      ? Math.max(
          0,
          Math.ceil(
            (activeHold.expiresAt.getTime() - now) / 1000
          )
        )
      : null;

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        externalId: user.externalId,
        totalPurchased: user.totalPurchased,
        purchaseLimit: 2,
      },
      inventory: {
        totalStock: inventory?.totalStock ?? 20,
        availableStock: inventory?.availableStock ?? 20,
      },
      hold: activeHold
        ? {
            id: activeHold.id,
            status: activeHold.status,
            expiresAt: activeHold.expiresAt,
            secondsRemaining,
          }
        : null,
      queue: {
        position: queuePosition,
      },
    });
  } catch (error) {
    console.error("Status request failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to retrieve status",
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const externalId =
      typeof body.externalId === "string"
        ? body.externalId.trim()
        : "";

    if (!externalId) {
      return NextResponse.json(
        {
          success: false,
          message: "externalId is required",
        },
        { status: 400 }
      );
    }

    const user = await prisma.user.upsert({
      where: {
        externalId,
      },
      update: {},
      create: {
        externalId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          externalId: user.externalId,
          totalPurchased: user.totalPurchased,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create user failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to create user",
      },
      { status: 500 }
    );
  }
}
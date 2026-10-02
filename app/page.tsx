"use client";

import { useCallback, useEffect, useState } from "react";

type UserStatus = {
  id: string;
  externalId: string;
  totalPurchased: number;
  purchaseLimit: number;
};

type InventoryStatus = {
  totalStock: number;
  availableStock: number;
};

type HoldStatus = {
  id: string;
  status: "ACTIVE";
  expiresAt: string;
  secondsRemaining: number;
};

type QueueStatus = {
  position: number | null;
};

type StatusResponse = {
  success: boolean;
  user: UserStatus;
  inventory: InventoryStatus;
  hold: HoldStatus | null;
  queue: QueueStatus;
};


function formatCountdown(seconds: number) {
  const safeSeconds = Math.max(0, seconds);

  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

export default function Home() {
  const [externalUserId, setExternalUserId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [buying, setBuying] = useState(false);
  const [paying, setPaying] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadStatus = useCallback(async (userId: string) => {
  if (!userId) return;

  try {
    const response = await fetch(
      `/api/status/${encodeURIComponent(userId)}`,
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Unable to load status"
      );
    }

    setStatus(data);
    setError("");
  } catch (err) {
    console.error("Status request failed:", err);

    setError(
      err instanceof Error
        ? err.message
        : "Unable to load user status"
    );
  }
}, []);


  useEffect(() => {
  if (!currentUserId) return;

  const interval = window.setInterval(() => {
    void loadStatus(currentUserId);
  }, 2000);

  return () => {
    window.clearInterval(interval);
  };
}, [currentUserId, loadStatus]);

  async function createOrLoadUser() {
    const userId = externalUserId.trim();

    if (!userId) {
      setError("Enter a user ID first.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          externalId: userId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Unable to create user"
        );
      }

      setCurrentUserId(userId);

      await loadStatus(userId);

      setMessage(`User ${userId} is ready.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create user"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleBuy() {
    if (!currentUserId) return;

    setBuying(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/buy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          externalUserId: currentUserId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Unable to process buy request"
        );
      }

      if (data.status === "HELD") {
        setMessage(
          `Pair held successfully. Hold ID: ${data.holdId}`
        );
      } else {
        setMessage(
          `Sold out. You are #${data.queuePosition} in the waiting line.`
        );
      }

      await loadStatus(currentUserId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to process buy request"
      );
    } finally {
      setBuying(false);
    }
  }

  async function handlePayment() {
    const holdId = status?.hold?.id;

    if (!holdId) return;

    setPaying(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "/api/payments/simulate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            holdId,
            delayMs: 1000,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Unable to start fake payment"
        );
      }

      setMessage(
        "Fake payment started. Waiting for payment confirmation..."
      );

      window.setTimeout(() => {
        loadStatus(currentUserId);
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to start payment"
      );
    } finally {
      setPaying(false);
    }
  }

  const availableStock =
    status?.inventory.availableStock ?? null;

  const currentHold = status?.hold;

  const queuePosition =
    status?.queue.position ?? null;

  const purchaseCount =
    status?.user.totalPurchased ?? 0;

  const purchaseLimit =
    status?.user.purchaseLimit ?? 2;

  const canBuy =
    Boolean(currentUserId) &&
    !currentHold &&
    queuePosition === null &&
    purchaseCount < purchaseLimit;

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-neutral-900 p-6">
          <div className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-neutral-400">
            Limited Drop
          </div>

          <h1 className="text-3xl font-bold">
            SneakDrop
          </h1>

          <p className="mt-2 text-sm leading-6 text-neutral-400">
            20 pairs. One active hold per user.
            First-come, first-served.
          </p>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white p-5 text-neutral-950">
          <label
            htmlFor="userId"
            className="block text-sm font-semibold"
          >
            Demo User ID
          </label>

          <div className="mt-2 flex gap-2">
            <input
              id="userId"
              value={externalUserId}
              onChange={(event) =>
                setExternalUserId(event.target.value)
              }
              placeholder="user-001"
              className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-4 py-3 text-sm outline-none focus:border-neutral-900"
            />

            <button
              type="button"
              onClick={createOrLoadUser}
              disabled={loading}
              className="rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "..." : "Load"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-neutral-900 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-neutral-800 p-4">
              <p className="text-xs uppercase tracking-wider text-neutral-500">
                Pairs Left
              </p>

              <p className="mt-2 text-3xl font-bold">
                {availableStock ?? "--"}
              </p>
            </div>

            <div className="rounded-2xl bg-neutral-800 p-4">
              <p className="text-xs uppercase tracking-wider text-neutral-500">
                Purchased
              </p>

              <p className="mt-2 text-3xl font-bold">
                {purchaseCount}/{purchaseLimit}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleBuy}
            disabled={!canBuy || buying}
            className="mt-4 w-full rounded-2xl bg-white px-5 py-4 text-base font-bold text-neutral-950 transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {buying
              ? "Processing..."
              : currentHold
                ? "Pair Already Held"
                : queuePosition !== null
                  ? `Waiting #${queuePosition}`
                  : purchaseCount >= purchaseLimit
                    ? "Purchase Limit Reached"
                    : "BUY NOW"}
          </button>
        </section>

        <section className="rounded-3xl border border-white/10 bg-neutral-900 p-5">
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Your status
          </p>

          {!currentUserId && (
            <p className="mt-3 text-sm text-neutral-400">
              Enter a user ID above to participate.
            </p>
          )}

          {currentUserId && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">
                  User
                </span>

                <span className="font-semibold">
                  {currentUserId}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-neutral-400">
                  Active hold
                </span>

                <span className="font-semibold">
                  {currentHold ? "YES" : "NO"}
                </span>
              </div>

              {currentHold && (
                <>
                  <div className="rounded-2xl bg-neutral-800 p-4 text-center">
                    <p className="text-xs uppercase tracking-wider text-neutral-500">
                      Time remaining
                    </p>

                    <p className="mt-2 text-4xl font-black tabular-nums">
                      {formatCountdown(
                        currentHold.secondsRemaining
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handlePayment}
                    disabled={paying}
                    className="w-full rounded-2xl bg-white px-5 py-4 font-bold text-neutral-950 disabled:opacity-50"
                  >
                    {paying
                      ? "Starting payment..."
                      : "SIMULATE PAYMENT"}
                  </button>
                </>
              )}

              {queuePosition !== null && (
                <div className="rounded-2xl border border-white/10 bg-neutral-800 p-4">
                  <p className="text-xs uppercase tracking-wider text-neutral-500">
                    Waiting line
                  </p>

                  <p className="mt-1 text-2xl font-bold">
                    #{queuePosition}
                  </p>

                  <p className="mt-1 text-sm text-neutral-400">
                    You will automatically receive
                    a 5-minute hold when a pair becomes
                    available.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {message && (
          <div className="rounded-2xl border border-white/10 bg-neutral-900 p-4 text-sm text-neutral-300">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        <footer className="pb-4 text-center text-xs leading-5 text-neutral-600">
          SneakDrop assignment demo · PostgreSQL · Prisma ·
          Next.js · TypeScript
        </footer>
      </div>
    </main>
  );
}
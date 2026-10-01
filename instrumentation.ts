export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { expireExpiredHolds } = await import(
    "./services/hold.service"
  );

  const globalState = globalThis as typeof globalThis & {
    __sneakDropExpiryStarted?: boolean;
  };

  if (globalState.__sneakDropExpiryStarted) {
    return;
  }

  globalState.__sneakDropExpiryStarted = true;

  setInterval(async () => {
    try {
      const processed = await expireExpiredHolds();

      if (processed > 0) {
        console.log(
          `[SneakDrop] Processed ${processed} expired hold(s)`
        );
      }
    } catch (error) {
      console.error(
        "[SneakDrop] Hold expiry worker failed:",
        error
      );
    }
  }, 5000);

  console.log(
    "[SneakDrop] Hold expiry worker started"
  );
}
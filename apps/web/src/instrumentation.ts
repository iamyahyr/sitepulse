/** Runs once when the server starts: on a fresh instance, print the setup link right away. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const [{ hasAnyUser }, { announceSetupLink }] = await Promise.all([
      import("@/server/auth"),
      import("@/server/setup-token"),
    ]);
    if (!(await hasAnyUser())) announceSetupLink();
  } catch {
    // Database not migrated yet or env incomplete: /setup announces it on the first visit instead.
  }
}

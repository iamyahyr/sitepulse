/**
 * The account public demo visitors browse as. It has no password and no
 * sessions: in DEMO_MODE the web app resolves every request to it.
 */
export const DEMO_USER = {
  id: "demo-visitor",
  email: "demo@sitepulse.invalid",
  name: "Demo visitor",
} as const;

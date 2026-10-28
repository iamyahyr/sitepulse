import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://sitepulse:sitepulse@localhost:5432/sitepulse",
  SITEPULSE_SECRET_KEY: "x".repeat(32),
};

describe("loadEnv", () => {
  it("parses ALLOW_PRIVATE_CIDRS into a list", () => {
    expect(loadEnv({ ...base, ALLOW_PRIVATE_CIDRS: "192.168.1.0/24, 10.0.0.0/8" }).ALLOW_PRIVATE_CIDRS).toEqual([
      "192.168.1.0/24",
      "10.0.0.0/8",
    ]);
  });

  it("treats an empty ALLOW_PRIVATE_CIDRS as none", () => {
    expect(loadEnv({ ...base, ALLOW_PRIVATE_CIDRS: "" }).ALLOW_PRIVATE_CIDRS).toEqual([]);
  });

  it("rejects a malformed CIDR at startup", () => {
    expect(() => loadEnv({ ...base, ALLOW_PRIVATE_CIDRS: "192.168.1.0" })).toThrow(/ALLOW_PRIVATE_CIDRS/);
  });
});

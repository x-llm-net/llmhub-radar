import { describe, expect, test } from "bun:test";

import {
  STANDARD_PROVIDER_LIMIT,
  VERIFIED_PROVIDER_LIMIT,
  getRadarProviderLimit,
  parseRadarAdminEmails,
} from "./access";

describe("radar marketplace access policy", () => {
  test("normalizes the administrator email allowlist", () => {
    expect(
      Array.from(
        parseRadarAdminEmails(" Admin@Example.com, owner@example.com, "),
      ),
    ).toEqual(["admin@example.com", "owner@example.com"]);
  });

  test("uses one slot for standard accounts and three for verified accounts", () => {
    expect(getRadarProviderLimit("unverified")).toBe(
      STANDARD_PROVIDER_LIMIT,
    );
    expect(getRadarProviderLimit("pending")).toBe(STANDARD_PROVIDER_LIMIT);
    expect(getRadarProviderLimit("rejected")).toBe(STANDARD_PROVIDER_LIMIT);
    expect(getRadarProviderLimit("verified")).toBe(
      VERIFIED_PROVIDER_LIMIT,
    );
  });
});

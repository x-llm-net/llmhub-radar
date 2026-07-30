import { describe, expect, test } from "bun:test";

import { aggregateRadarPoolStatus } from "./list";

describe("aggregateRadarPoolStatus", () => {
  test("keeps partially unhealthy pools degraded instead of down", () => {
    expect(aggregateRadarPoolStatus(["operational", "down"])).toBe("degraded");
    expect(
      aggregateRadarPoolStatus(["operational", "configuration_error"]),
    ).toBe("degraded");
  });

  test("keeps fully unhealthy pools actionable", () => {
    expect(aggregateRadarPoolStatus(["down", "down"])).toBe("down");
    expect(
      aggregateRadarPoolStatus(["configuration_error", "configuration_error"]),
    ).toBe("configuration_error");
    expect(aggregateRadarPoolStatus(["down", "configuration_error"])).toBe(
      "down",
    );
  });

  test("handles paused and unknown pools without fabricating an outage", () => {
    expect(aggregateRadarPoolStatus(["paused", "paused"])).toBe("paused");
    expect(aggregateRadarPoolStatus(["unknown", null])).toBe("unknown");
    expect(aggregateRadarPoolStatus([])).toBe("unknown");
  });
});

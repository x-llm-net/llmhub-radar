import { describe, expect, test } from "bun:test";

import { decideRadarNotificationEvent } from "./notification-policy";

describe("decideRadarNotificationEvent", () => {
  test("does not notify on the first degraded probe", () => {
    expect(
      decideRadarNotificationEvent({
        previousStatus: "operational",
        currentStatus: "degraded",
      }),
    ).toBeNull();
  });

  test("notifies when degraded persists", () => {
    expect(
      decideRadarNotificationEvent({
        previousStatus: "degraded",
        currentStatus: "degraded",
      }),
    ).toBe("degraded");
  });

  test("does not repeat degraded notifications in the same incident", () => {
    expect(
      decideRadarNotificationEvent({
        previousStatus: "degraded",
        currentStatus: "degraded",
        latestEventType: "degraded",
      }),
    ).toBeNull();
  });

  test("notifies when a target goes down", () => {
    expect(
      decideRadarNotificationEvent({
        previousStatus: "degraded",
        currentStatus: "down",
      }),
    ).toBe("down");
  });

  test("does not notify on recovery until it is confirmed", () => {
    expect(
      decideRadarNotificationEvent({
        previousStatus: "down",
        currentStatus: "operational",
        latestEventType: "down",
        recoveryConfirmed: false,
      }),
    ).toBeNull();
  });

  test("notifies on confirmed recovery from a problem state", () => {
    expect(
      decideRadarNotificationEvent({
        previousStatus: "down",
        currentStatus: "operational",
        latestEventType: "down",
        recoveryConfirmed: true,
      }),
    ).toBe("recovered");
  });
});

import { describe, expect, it } from "vitest";
import { moveSensor, recommendSensorPlan, sensorPreset, simulateKilnFrame } from "./kilnSimulation";

describe("deterministic explanatory kiln simulation", () => {
  it("changes observed temperatures and uncertainty with sensor count", () => {
    const one = simulateKilnFrame({ minute: 320, sensors: sensorPreset("single") });
    const three = simulateKilnFrame({ minute: 320, sensors: sensorPreset("three") });
    expect(one.physical.sensorReadings).toHaveLength(1);
    expect(three.physical.sensorReadings).toHaveLength(3);
    expect(three.physical.sensorReadings[1].uncertaintyC).toBeLessThan(one.physical.sensorReadings[0].uncertaintyC);
    expect(new Set(three.physical.sensorReadings.map((item) => item.temperatureC)).size).toBeGreaterThan(1);
  });

  it("reproducibly changes a reading when a sensor moves", () => {
    const original = sensorPreset("single");
    const moved = moveSensor(original, "sensor-1", 0.32);
    const first = simulateKilnFrame({ minute: 320, sensors: moved });
    const again = simulateKilnFrame({ minute: 320, sensors: moved });
    expect(first).toEqual(again);
    expect(first.physical.sensorReadings[0].temperatureC).not.toBe(simulateKilnFrame({ minute: 320, sensors: original }).physical.sensorReadings[0].temperatureC);
  });

  it("keeps physical readings separate from non-quantitative visual effects", () => {
    const frame = simulateKilnFrame({ minute: 200, sensors: sensorPreset("three") });
    expect(frame.physical.sourceType).toBe("synthetic");
    expect(frame.visual).toMatchObject({ sourceType: "synthetic", quantitative: false, label: "설명용 근사" });
  });

  it("locates sensor failures and recommends coverage by load", () => {
    const frame = simulateKilnFrame({ minute: 260, sensors: sensorPreset("three"), scenario: "sensor_failure" });
    expect(frame.physical.sensorReadings[0].temperatureC).toBeNull();
    expect(frame.physical.warnings[0]).toMatchObject({ sensorId: "sensor-1", layer: "top" });
    expect(recommendSensorPlan(10, "large").plan).toBe("multi");
  });
});

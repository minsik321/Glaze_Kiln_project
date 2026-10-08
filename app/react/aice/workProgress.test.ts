import { afterEach, describe, expect, it } from "vitest";
import { sampleAiceRun } from "./contract";
import { clearWorkProgress, loadWorkProgress, saveWorkProgress } from "./workProgress";

afterEach(() => clearWorkProgress());

describe("saved work progress", () => {
  it("stores and restores the run with its current step", () => {
    const run = sampleAiceRun();
    saveWorkProgress(run, 2);

    expect(loadWorkProgress()).toMatchObject({ run: { run_id: run.run_id }, step: 2 });
  });

  it("removes invalid saved data", () => {
    localStorage.setItem("aice-kiln:work-progress:v1", "not-json");
    expect(loadWorkProgress()).toBeNull();
    expect(localStorage.getItem("aice-kiln:work-progress:v1")).toBeNull();
  });
});

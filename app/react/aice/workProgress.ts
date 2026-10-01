import { validateAiceRun, type AiceRun } from "./contract";

const STORAGE_KEY = "aice-kiln:work-progress:v1";

export type SavedWorkProgress = {
  run: AiceRun;
  step: number;
  savedAt: string;
};

export function saveWorkProgress(run: AiceRun, step: number) {
  if (typeof window === "undefined") return;
  const progress: SavedWorkProgress = {
    run,
    step: Math.max(1, Math.min(4, Math.trunc(step))),
    savedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function loadWorkProgress(): SavedWorkProgress | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const progress = JSON.parse(raw) as Partial<SavedWorkProgress>;
    if (!progress.run || validateAiceRun(progress.run).length > 0 || !Number.isInteger(progress.step) || Number(progress.step) < 1 || Number(progress.step) > 4 || typeof progress.savedAt !== "string") {
      clearWorkProgress();
      return null;
    }
    return progress as SavedWorkProgress;
  } catch {
    clearWorkProgress();
    return null;
  }
}

export function clearWorkProgress() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

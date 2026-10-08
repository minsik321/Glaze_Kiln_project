import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "./contract";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  requireSupabase: () => ({ auth: { getUser: mocks.getUser }, storage: { from: mocks.from } }),
}));

import { persistRunPhotos, signedPhotoUrl } from "./photoStorage";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.example/signed" }, error: null });
  mocks.from.mockReturnValue({ upload: mocks.upload, createSignedUrl: mocks.createSignedUrl });
});

describe("AICE photo storage", () => {
  it("uploads generated and observed images to separate private buckets and keeps only paths in the run", async () => {
    const run = sampleAiceRun();
    const generated = "data:image/png;base64,Zm9v";
    const observed = "data:image/jpeg;base64,YmFy";
    run.recipe.photo = { ...run.recipe.photo, data_url: generated, placeholder: false };
    run.result.photo = { ...run.recipe.photo, id: "result", kind: "result", data_url: observed, source_type: "observed" };
    run.intake = { prompt_text: "test", prompt_photos: [], candidates: { selected_id: "one", candidates: [
      { id: "one", name: "one", materials: {}, colorants: {}, colorant_note: "", predicted_firing_range: run.recipe.firing_range, predicted_firing_note: "", photo: { ...run.recipe.photo }, source_type: "synthetic", source_ids: [] },
    ] } };

    const saved = await persistRunPhotos(run);
    expect(mocks.from.mock.calls.map(([bucket]) => bucket)).toEqual(["aice-recipe-photos", "aice-result-photos"]);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(saved.recipe.photo.storage_path).toMatch(/^11111111-1111-4111-8111-111111111111\//);
    expect(saved.intake?.candidates.candidates[0].photo.storage_path).toBe(saved.recipe.photo.storage_path);
    expect(saved.result.photo?.storage_path).toMatch(/^11111111-1111-4111-8111-111111111111\//);
    expect(saved.recipe.photo.data_url).toBeNull();
    expect(saved.result.photo?.data_url).toBeNull();
    expect(await signedPhotoUrl(saved.result.photo!)).toBe("https://storage.example/signed");
  });

  it("reports upload failures instead of storing inline image data in the run", async () => {
    const run = sampleAiceRun();
    run.recipe.photo = { ...run.recipe.photo, data_url: "data:image/png;base64,c29tZQ==" };
    mocks.upload.mockResolvedValueOnce({ error: { message: "permission denied" } });
    await expect(persistRunPhotos(run)).rejects.toThrow("permission denied");
  });

  it("uploads a private observation without a rights confirmation", async () => {
    const run = sampleAiceRun();
    run.result.photo = { ...run.recipe.photo, id: "result", kind: "result", source_type: "observed", rights_confirmed: false, data_url: "data:image/png;base64,cGhvdG8=" };
    const saved = await persistRunPhotos(run);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(saved.result.photo?.rights_confirmed).toBe(false);
    expect(saved.result.photo?.storage_path).toMatch(/^11111111-1111-4111-8111-111111111111\//);
    expect(saved.result.photo?.data_url).toBeNull();
  });
});

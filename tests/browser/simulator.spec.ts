import { test, expect } from "@playwright/test";

test("nine-screen AICE sample finishes without numeric input", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByText("데모 · 시뮬레이션 전용")).toBeVisible();
  await expect(page.getByTestId("aice-step-1")).toBeVisible();
  await expect(page.locator('input[type="number"]')).toHaveCount(0);

  await page.getByRole("button", { name: /샘플 실험 시작/ }).click();
  await page.getByRole("button", { name: /사틴 청색/ }).click();
  await page.getByRole("button", { name: /^다음/ }).click();
  await page.getByRole("button", { name: /해안 사틴 01/ }).click();
  await expect(page.getByText("왜 이 후보인지")).toBeVisible();
  await expect(page.getByText("무엇이 가정인지")).toBeVisible();
  await expect(page.getByText("다음 행동", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^다음/ }).click();

  await page.getByRole("button", { name: /사발/ }).click();
  await page.getByRole("button", { name: /^다음/ }).click();
  await expect(page.getByRole("img", { name: /가상 유약 단면/ })).toBeVisible();
  await page.getByRole("button", { name: /가상 분포를 확인/ }).click();
  await page.getByRole("button", { name: /^다음/ }).click();

  await expect(page.getByRole("img", { name: /가상 전기가마 종단면/ })).toBeVisible();
  await page.getByRole("button", { name: /상·중·하 3개/ }).click();
  await page.getByRole("button", { name: /^다음/ }).click();
  await expect(page.getByRole("img", { name: /수정 계획 비교/ })).toBeVisible();
  await page.getByRole("button", { name: /가상 소성 준비/ }).click();
  await page.getByRole("button", { name: /^다음/ }).click();

  await page.getByRole("button", { name: /가상 소성 재생/ }).click();
  await expect(page.getByText("가상 소성 완료")).toBeVisible();
  await page.getByRole("button", { name: /^다음/ }).click();
  await page.getByRole("button", { name: /목표에 가까워요/ }).click();
  await expect(page.getByTestId("aice-step-9")).toBeVisible();
  await expect(page.getByText("실제 소성 품질이나 재현성을 검증한 결과가 아닙니다.")).toBeVisible();
  await expect(page.locator('input[type="number"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

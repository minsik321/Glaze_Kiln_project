import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThicknessSection } from "./ThicknessSection";

afterEach(cleanup);

describe("ThicknessSection", () => {
  it("shows g/m² ahead of the mm estimate once it is available", () => {
    const { container } = render(<ThicknessSection ware="bowl" coating="target" arealDensityGm2={667} />);
    expect(container.querySelector(".status-badge")?.textContent).toBe("평균 추정 667 g/m²");
  });

  it("falls back to the mm-based (usually unavailable) label when no g/m² is given", () => {
    const { container } = render(<ThicknessSection ware="bowl" coating="target" />);
    expect(container.querySelector(".status-badge")?.textContent).toBe("판정 불가");
  });
});

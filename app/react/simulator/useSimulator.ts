import { useCallback, useEffect, useRef, useState } from "react";
import { initialFields } from "./defaults";
import {
  initializeSimulator,
  kilnBridge,
  type Data,
  type Progress,
} from "./engine";
import * as view from "./presentation.js";

export type Row = Record<string, string | number>;
export const initialSegments: Row[] = [
  { from_c: 1100, to_c: 900, rate_c_per_h: 50, purpose: "결정 성장 구간 서냉" },
  { from_c: 620, to_c: 573, rate_c_per_h: 40, purpose: "석영 전이 진입" },
];
export const initialTiles: Row[] = [
  { dip_seconds: 2, area_m2: 0.006, glaze_weight_g: 7.2, caliper_mm: 0.9 },
  { dip_seconds: 4, area_m2: 0.006, glaze_weight_g: 11, caliper_mm: "" },
  { dip_seconds: 6, area_m2: 0.006, glaze_weight_g: 15.1, caliper_mm: "" },
];
const baseSession: Data = {
  recipeId: "lime_matte",
  recipeName: "석회 매트",
  wareId: null,
  wareName: null,
  recordId: null,
  runId: null,
  E: null,
  lastSim: null,
  prescription: null,
  densityStatus: null,
  dipSeconds: null,
  recipes: {},
  candidates: [],
  registry: [],
  colorants: [],
  failures: [],
};

export function useSimulator() {
  const [fields, setFields] = useState(initialFields);
  const [session, setSession] = useState<Data>(baseSession);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [segments, setSegments] = useState(initialSegments);
  const [tiles, setTiles] = useState(initialTiles);
  const [tab, setTab] = useState("target");
  const [registryOpen, setRegistryOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState("");
  const [progress, setProgress] = useState<Progress>({
    message: "시작하는 중…",
    percent: 0,
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const patch = (value: Data) =>
    setSession((previous) => ({ ...previous, ...value }));
  const output = (id: string, html: string, append = false) =>
    setOutputs((previous) => ({
      ...previous,
      [id]: (append ? previous[id] || "" : "") + html,
    }));
  const field = (id: string) => String(fields[id] ?? "");
  const number = (id: string) => Number.parseFloat(field(id));
  const setField = useCallback(
    (id: string, value: string | boolean) =>
      setFields((previous) => ({ ...previous, [id]: value })),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const unsubscribe = kilnBridge.subscribe((next) => {
      if (active) setProgress(next);
    });
    initializeSimulator()
      .then((data) => {
        if (!active) return;
        setSession((previous) => ({
          ...previous,
          ...data,
          targetLabel: `${data.target.gloss} · ${data.target.transparency}`,
        }));
        setFields((previous) => ({
          ...previous,
          "t-gloss": "2",
          "t-transp": "0",
          "r-gloss": "1",
          "r-transp": "0",
          "w-shape":
            Object.keys(data.presets.shapes)[1] ||
            Object.keys(data.presets.shapes)[0],
          "g-method": data.presets.methods[0].value,
          "k-kiln": "ref30l",
          "rx-kiln": "large",
          "r-grade": data.presets.grades[0],
          "t-color-a": data.colorants[0].symbol,
          "t-color-b": "",
        }));
        output("target-out", view.renderTarget(data.target));
        setProgress({ message: "준비 완료!", percent: 100 });
        setReady(true);
      })
      .catch((error) => {
        if (active) setBootError(String(error.message || error));
      });
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  // Versioned effect prevents a slower prior color request from replacing the latest input.
  useEffect(() => {
    if (!ready) return;
    let active = true;
    kilnBridge
      .call(
        "mix_color",
        [
          field("t-color-a"),
          field("t-color-b") || null,
          number("t-color-blend") / 100,
        ],
        {
          amount_pct: number("t-color-amount"),
          saturation_delta: number("t-color-sat") / 100,
          brightness_delta: number("t-color-bri") / 100,
          batch_dry_g: number("t-color-batch"),
        },
      )
      .then((r) => {
        if (!active) return;
        if (!r.ok) {
          output("t-color-out", view.errBox(r.reason || r));
          return;
        }
        patch({ colorHex: r.hex });
        output("t-color-out", view.renderColor(r));
      })
      .catch((error) => {
        if (active) output("t-color-out", view.errBox(error));
      });
    return () => {
      active = false;
    };
  }, [
    ready,
    fields["t-color-a"],
    fields["t-color-b"],
    fields["t-color-blend"],
    fields["t-color-sat"],
    fields["t-color-bri"],
    fields["t-color-amount"],
    fields["t-color-batch"],
  ]);

  const colorant = session.colorants.find(
    (c: Data) => c.symbol === field("t-color-a"),
  );
  const changeField = (id: string, value: string | boolean) => {
    if (id === "t-color-a") {
      const colorant = session.colorants.find((c: Data) => c.symbol === value);
      if (colorant && number("t-color-amount") > colorant.typical_pct[1])
        setField("t-color-amount", String(colorant.typical_pct[0]));
    }
    setField(id, value);
  };
  const dipping = !!session.presets?.methods.find(
    (m: Data) => m.value === field("g-method"),
  )?.has_distribution;
  const call = kilnBridge.call;
  const warn = (message: string) =>
    `<div class="msg warn">${view.esc(message)}</div>`;
  const checked = async (
    name: string,
    args: unknown[] = [],
    kwargs: Data = {},
  ) => {
    const result = await call(name, args, kwargs);
    if (result.ok === false)
      throw new Error(result.reason || result.error || "계산할 수 없어요.");
    return result;
  };
  const refreshRecipes = async () => {
    const state = await call("export_state");
    patch({ recipes: state.recipes });
  };
  async function execute(
    host: string,
    action: () => Promise<void>,
    append = false,
  ) {
    if (busyRef.current || !ready) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (mounted.current) output(host, view.errBox(error), append);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const actions: Record<string, () => void> = {
    "btn-registry": () => setRegistryOpen(true),
    "btn-registry-close": () => setRegistryOpen(false),
    "btn-set-target": () =>
      void execute("target-out", async () => {
        const r = await checked("set_target", [
          number("t-gloss"),
          number("t-transp"),
        ]);
        patch({ targetLabel: `${r.gloss} · ${r.transparency}` });
        output("target-out", view.renderTarget(r));
      }),
    "btn-propose": () =>
      void execute("search-out", async () => {
        const r = await checked("propose", [number("s-n")], {
          grid_step: number("s-step"),
        });
        patch({ candidates: r.candidates, search: r });
        output("search-out", "");
      }),
    "btn-density": () =>
      void execute("density-out", async () => {
        const r = await checked(
          "check_density",
          [number("d-rho"), number("d-min")],
          { target_lo: number("d-lo"), target_hi: number("d-hi") },
        );
        patch({ densityStatus: r.status });
        output("density-out", view.renderDensity(r));
      }),
    "btn-dip": () =>
      void execute("dip-out", async () => {
        const r = await checked(
          "suggest_dip_time",
          [number("dt-target"), number("dt-rho"), session.recipeId],
          { t_flow_mm: number("dt-flow") },
        );
        output("dip-out", view.renderDip(r));
        if (r.feasible) {
          const value = view.fmt(r.seconds, 2);
          setField("g-dip", value);
          patch({ dipSeconds: value });
        }
      }),
    "btn-ware": () =>
      void execute("ware-out", async () => {
        const r = await checked("register_ware", [
          field("w-shape"),
          field("w-clay"),
          number("w-bisque"),
        ]);
        patch({ wareId: r.ware_id, wareName: r.name });
        output(
          "ware-out",
          `등록됨 — ${view.esc(r.name)} (${view.esc(r.ware_id)})`,
        );
      }),
    "btn-glaze": () =>
      void execute("glaze-out", async () => {
        if (!session.wareId) {
          output("glaze-out", warn("기물을 먼저 등록해주세요."));
          return;
        }
        const r = await checked(
          "glaze",
          [
            session.wareId,
            session.recipeId,
            field("g-method"),
            number("g-before"),
            number("g-after"),
          ],
          {
            dip_seconds: dipping ? number("g-dip") : null,
            rho: number("g-rho"),
            waxed_area_m2: number("g-wax"),
            is_reglaze: !!fields["g-reglaze"],
            drying_complete: !!fields["g-dry"],
          },
        );
        patch({ recordId: r.record_id });
        output("glaze-out", view.renderGlaze(r));
      }),
    "btn-risk": () =>
      void execute("risk-out", async () => {
        if (!session.recordId) {
          output("risk-out", warn("③ 시유 탭에서 먼저 기록해주세요."));
          return;
        }
        const r = await checked("risk", [session.recordId, session.recipeId]);
        output("risk-out", view.renderRisk(r, session));
      }),
    "btn-loading": () =>
      void execute("loading-out", async () => {
        const r = await checked("loading", [
          field("k-kiln"),
          session.wareId ? [session.wareId] : [],
          number("l-shelf"),
          number("l-kg"),
          number("l-obs"),
        ]);
        output("loading-out", view.renderLoading(r));
      }),
    "btn-seg-add": () =>
      setSegments((previous) => [
        ...previous,
        { from_c: 900, to_c: 700, rate_c_per_h: 80, purpose: "" },
      ]),
    "btn-cooling": () =>
      void execute("cooling-out", async () => {
        const r = await checked("cooling", [field("k-kiln"), segments]);
        output("cooling-out", view.renderCooling(r, { segs: segments }));
      }),
    "btn-simulate": () =>
      void execute("sim-out", async () => {
        if (session.E === null) {
          output("sim-out", warn("먼저 가정값(E)을 입력해주세요."));
          return;
        }
        const r = await checked(
          "simulate",
          [
            field("k-kiln"),
            number("f-peak"),
            number("f-ramp"),
            number("f-hold"),
            session.E,
          ],
          {
            seed: number("f-seed"),
            voltage_pct: number("f-volt"),
            aging_pct: number("f-age"),
            noise_c: number("f-noise"),
          },
        );
        patch({
          lastSim: r,
          simulatedKiln: field("k-kiln"),
          simulatedSegments: segments.map((row) => ({ ...row })),
        });
        output("sim-out", view.renderSimulation(r));
      }),
    "btn-record-run": () =>
      void execute(
        "sim-out",
        async () => {
          if (!session.lastSim) {
            output("sim-out", warn("시뮬레이션을 먼저 실행해주세요."), true);
            return;
          }
          const r = await checked(
            "record_run",
            [
              session.simulatedKiln,
              session.recordId ? [session.recordId] : [],
              session.lastSim.schedule,
              session.lastSim.steps.map((step: Data) => ({
                t: step.t,
                temp_c: step.sensor_c,
              })),
              session.simulatedSegments,
            ],
            { declared_kg: number("l-kg"), shelf_area_m2: number("l-shelf") },
          );
          patch({ runId: r.run_id });
          output(
            "sim-out",
            `<div class="msg">회차 ${view.esc(r.run_id)} 저장됐어요. 소성 기록도 함께 남았어요.</div>`,
            true,
          );
        },
        true,
      ),
    "btn-result": () =>
      void execute("result-out", async () => {
        if (!session.runId || !session.recordId) {
          output(
            "result-out",
            warn(
              "⑤ 소성 탭에서 먼저 기록해주세요 (시유 기록과 시뮬레이션이 필요해요).",
            ),
          );
          return;
        }
        const r = await checked(
          "record_result",
          [
            session.runId,
            session.recordId,
            session.recipeId,
            number("r-gloss"),
            number("r-transp"),
            field("r-grade"),
          ],
          {
            failures: session.failures,
            observations: field("r-color") ? { 색: field("r-color") } : {},
            fracture_thickness_mm:
              field("r-frac-t") === "" ? null : number("r-frac-t"),
            fracture_z_mm: field("r-frac-z") === "" ? null : number("r-frac-z"),
          },
        );
        output("result-out", view.renderResult(r));
      }),
    "btn-tile-add": () =>
      setTiles((previous) => [
        ...previous,
        { dip_seconds: 8, area_m2: 0.006, glaze_weight_g: 18, caliper_mm: "" },
      ]),
    "btn-tiles": () =>
      void execute("tiles-out", async () => {
        const r = await checked("calibrate_tiles", [tiles, number("cal-rho")]);
        patch({ tileResult: r });
        output("tiles-out", view.renderTiles(r));
      }),
    "btn-apply-cal": () =>
      void execute(
        "tiles-out",
        async () => {
          if (!session.tileResult) return;
          const r = await checked("apply_calibration", [session.recipeId], {
            k1: session.tileResult.k1,
            rho_dry: session.tileResult.rho_dry,
          });
          output("tiles-out", view.renderCoefficients(r), true);
        },
        true,
      ),
    "btn-coef": () =>
      void execute("coef-out", async () =>
        output(
          "coef-out",
          view.renderCoefficients(
            await checked("coefficients", [session.recipeId]),
          ),
        ),
      ),
    "btn-issue": () =>
      void execute("rx-out", async () => {
        if (!session.runId) {
          output("rx-out", warn("⑤ 소성 탭에서 먼저 기록해주세요."));
          return;
        }
        if (session.E === null) {
          output("rx-out", warn("먼저 가정값(E)을 입력해주세요."));
          return;
        }
        const r = await checked("issue_prescription", [
          session.runId,
          session.E,
          number("rx-peak"),
        ]);
        patch({ prescription: r });
        output("rx-out", view.renderIssue(r));
      }),
    "btn-transform": () =>
      void execute(
        "rx-out",
        async () => {
          if (!session.prescription) {
            output("rx-out", warn("처방을 먼저 만들어주세요."));
            return;
          }
          const r = await checked("transform_prescription", [
            session.prescription,
            field("rx-kiln"),
          ]);
          output("rx-out", view.renderTransform(r), true);
        },
        true,
      ),
    "btn-export": () =>
      void execute("export-out", async () =>
        output("export-out", view.renderExport(await call("export_state"))),
      ),
  };
  const inspect = (index: number) =>
    void execute(`inspect-${index}`, async () => {
      const r = await checked("inspect_composition", [
        session.candidates[index].materials,
        field("s-cone"),
      ]);
      output(`inspect-${index}`, view.renderInspect(r));
    });
  const adopt = (index: number) =>
    void execute(`inspect-${index}`, async () => {
      const r = await checked("adopt_candidate", [
        `후보 ${index + 1}`,
        session.candidates[index].materials,
      ]);
      patch({ recipeId: r.recipe_id, recipeName: r.name });
      await refreshRecipes();
      output(
        `inspect-${index}`,
        `<div class="msg">선택됨 — ${view.esc(r.name)} (${view.esc(r.recipe_id)}). 이 레시피만의 계산값이 새로 만들어졌어요.</div>`,
      );
    });
  const pickRecipe = (id: string) =>
    patch({ recipeId: id, recipeName: session.recipes[id].name });
  const setE = (value: string | number) => {
    const parsed = Number.parseFloat(String(value));
    patch({ E: Number.isFinite(parsed) && parsed > 0 ? parsed : null });
  };
  const exportSnapshot = useCallback(
    () => kilnBridge.call<Data>("export_state"),
    [],
  );
  return {
    fields,
    field,
    changeField,
    session,
    outputs,
    segments,
    setSegments,
    tiles,
    setTiles,
    tab,
    setTab,
    registryOpen,
    ready,
    bootError,
    progress,
    busy,
    actions,
    inspect,
    adopt,
    pickRecipe,
    setE,
    patch,
    dipping,
    colorant,
    exportSnapshot,
  };
}
export type SimulatorModel = ReturnType<typeof useSimulator>;

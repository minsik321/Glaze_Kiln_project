/* 유약 실험·소성 관리 시스템 — 화면.
 *
 * 이 파일은 **계산하지 않는다.** 상태는 Pyodide 안의 KilnApp 파이썬 객체가 들고
 * 있고, 여기서는 kiln.webapp.bridge 의 반환 dict를 그리기만 한다. 계산을 JS로
 * 다시 구현하면 두 구현이 갈라지고 "기획서가 코드보다 위에 있다"는 전제가 깨진다.
 *
 * 화면이 지켜야 하는 것 (기획서 00절):
 *   1. 출처를 떨어뜨리지 않는다 — provenance_notes / annotation / notes / reason 을
 *      기본으로 보이게 하고, 접더라도 개수를 표시한다.
 *   2. 「판정 불가」를 「없음」처럼 그리지 않는다 (8-2절). available:false 는 회색이다.
 *   3. 어떤 선택지에도 확정 기호를 붙이지 않고 cost를 반드시 함께 그린다 (8-4절).
 *   4. 미정 계수에 기본값을 채워 넣지 않는다 — E는 사용자가 고르고 E_note가 따라붙는다.
 *   5. 경고가 진행을 막지 않는다 (6-4절).
 *   6. AI를 판단 주체로 쓰지 않는다 (부록 D). 이 파일에 모델 호출이 없다.
 */

"use strict";

const PYODIDE_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

/* ── 작은 도구 ───────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const num = (id) => parseFloat($(id).value);
const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(d);
const sci = (v) => {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e5) ? Number(v).toExponential(3) : Number(v).toFixed(4);
};

/* 출처 블록. **기본으로 펼쳐 둔다** — 접더라도 개수가 요약에 남는다 (00절). */
function provBlock(title, notes) {
  const list = (notes || []).filter((n) => n !== null && n !== undefined && n !== "");
  if (!list.length) return "";
  return `<details class="prov" open><summary>${esc(title)} · ${list.length}개</summary>
    <ul>${list.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>`;
}
function annoLine(text) {
  return text ? `<p class="note">${esc(text)}</p>` : "";
}
function errBox(e) {
  return `<div class="msg danger"><b>문제가 발생했어요.</b><br>${esc(e.message || e)}</div>`;
}

/* ── 파이썬 경계 ─────────────────────────────────────────────────────── */

let py = null;
let pyCall = null;

async function call(name, args = [], kwargs = {}) {
  const raw = pyCall(name, JSON.stringify({ args, kwargs }));
  const res = JSON.parse(raw);
  if (!res.ok) {
    console.error("[kiln]", name, res.error, res.trace);
    throw new Error(res.error);
  }
  return res.value;
}

const PY_INIT = `
import json, sys, traceback
sys.path.insert(0, "/kilnsrc")
from kiln.webapp import KilnApp

_app = KilnApp()

def _call(name, payload):
    """UI가 부르는 유일한 경계. 계산은 kiln 패키지가 한다."""
    try:
        spec = json.loads(payload)
        fn = getattr(_app, name)
        value = fn(*spec.get("args", []), **spec.get("kwargs", {}))
        return json.dumps({"ok": True, "value": value}, ensure_ascii=False, default=str)
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"{type(exc).__name__}: {exc}",
             "trace": traceback.format_exc()},
            ensure_ascii=False,
        )
`;

/* ── 부팅 ────────────────────────────────────────────────────────────── */

function bootStep(text, pct) {
  $("boot-step").textContent = text;
  if (pct !== undefined) $("boot-fill").style.width = pct + "%";
  bootLog(text);
}
function bootLog(text) {
  const el = $("boot-log");
  el.textContent += (el.textContent ? "\n" : "") + text;
  el.scrollTop = el.scrollHeight;
}
function bootFail(reason, hint) {
  $("boot").classList.add("failed");
  const box = $("boot-fail");
  box.hidden = false;
  box.innerHTML = `<b>시작하지 못했어요.</b><br>${esc(reason)}${hint ? "<br><br>" + hint : ""}`;
  $("boot-step").textContent = "중단됨";
}

async function boot() {
  const t0 = performance.now();
  try {
    bootStep("필요한 프로그램을 받는 중…", 4);
    py = await loadPyodide({ indexURL: PYODIDE_INDEX });
    bootStep("준비하는 중…", 34);

    bootStep("설정을 불러오는 중…", 38);
    const mres = await fetch("kiln-manifest.json", { cache: "no-cache" });
    if (!mres.ok) throw new Error(`kiln-manifest.json HTTP ${mres.status}`);
    const manifest = await mres.json();
    const files = manifest.files;
    bootStep(`파일을 받는 중… (0/${files.length})`, 42);

    let done = 0;
    const payloads = await Promise.all(
      files.map(async (rel) => {
        const url = `${manifest.root}/${rel}`;
        const r = await fetch(url, { cache: "no-cache" });
        if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        done += 1;
        bootStep(`파일을 받는 중… (${done}/${files.length})`, 42 + (done / files.length) * 36);
        return [rel, bytes];
      })
    );

    bootStep("설치하는 중…", 80);
    for (const [rel, bytes] of payloads) {
      const path = "/kilnsrc/" + rel;
      const dir = path.slice(0, path.lastIndexOf("/"));
      py.FS.mkdirTree(dir);
      py.FS.writeFile(path, bytes);
    }

    bootStep("프로그램을 준비하는 중…", 88);
    py.runPython(PY_INIT);
    pyCall = py.globals.get("_call");

    bootStep("데이터를 불러오는 중…", 94);
    await initApp();

    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    bootStep("준비 완료!", 100);
    bootLog(`준비 시간 ${secs}초 · 파일 ${files.length}개`);
    setTimeout(() => {
      $("boot").hidden = true;
      $("top").hidden = false;
      $("main").hidden = false;
    }, 260);
  } catch (e) {
    console.error(e);
    const isFile = location.protocol === "file:";
    bootFail(
      e.message || String(e),
      isFile
        ? "<code>file://</code> 로 열면 fetch가 CORS로 막힌다. 저장소 루트에서 " +
          "<code>python -m http.server 8000</code> 을 띄우고 " +
          "<code>http://localhost:8000/app/</code> 로 열어라."
        : "네트워크(CDN 차단·오프라인)나 매니페스트 경로를 확인하라. " +
          "브라우저 콘솔에 원문이 남아 있다."
    );
  }
}

/* ── 상태 (화면 쪽 포인터만. 계산 상태는 파이썬이 들고 있다) ───────── */

const S = {
  presets: null,
  registry: null,
  colorants: null,
  recipeId: "lime_matte",
  recipeName: "석회 매트",
  wareId: null,
  wareName: null,
  recordId: null,
  runId: null,
  densityStatus: null,   // ③ 단계 칩용
  dipSeconds: null,      // ③ 단계 칩용
  kilnKey: "ref30l",
  E: null, // 부록 C 미정. **기본값을 채우지 않는다.**
  lastSim: null,
  prescription: null,
  segs: [
    { from_c: 1100, to_c: 900, rate_c_per_h: 50, purpose: "결정 성장 구간 서냉" },
    { from_c: 620, to_c: 573, rate_c_per_h: 40, purpose: "석영 전이 진입" },
  ],
  tiles: [
    { dip_seconds: 2, area_m2: 0.006, glaze_weight_g: 7.2, caliper_mm: 0.9 },
    { dip_seconds: 4, area_m2: 0.006, glaze_weight_g: 11.0, caliper_mm: "" },
    { dip_seconds: 6, area_m2: 0.006, glaze_weight_g: 15.1, caliper_mm: "" },
  ],
};

/* 사이클 레일. 평평한 키-값 나열은 "지금 사이클 어디쯤인가"를 못 보여준다 (03절). */
function cell(k, v, opts = {}) {
  const cls = ["cell", opts.na ? "na" : "", v ? "" : "empty"].filter(Boolean).join(" ");
  return `<div class="${cls}"><div class="k">${esc(k)}</div>
    <div class="v">${esc(v || opts.blank || "없음")}</div></div>`;
}
function renderStatebar() {
  $("statebar").innerHTML =
    cell("목표", S.targetLabel, { blank: "미지정" }) +
    cell("유약", S.recipeName) +
    cell("기물", S.wareId ? S.wareName : "", { blank: "미등록" }) +
    cell("시유 기록", S.recordId) +
    cell("회차", S.runId) +
    // E는 부록 C 미정 계수다 — 비어 있다는 사실 자체를 회색으로 드러낸다.
    cell("온도 가정값", S.E === null ? "" : S.E + " kJ/mol", { na: true, blank: "미입력" });
  renderGlazingSteps();
}

/* ③ 탭 단계 칩 — 비중 → 담금시간 → 시유 순서를 눈에 보이게 한다. */
function renderGlazingSteps() {
  const host = $("glazing-steps");
  if (!host) return;
  const chip = (n, label, value, on) =>
    `<span class="chip${on ? " on" : ""}">${n} · ${esc(label)}${
      value ? ` <b>${esc(value)}</b>` : ""
    }</span>`;
  host.innerHTML =
    chip(1, "비중 점검", S.densityStatus || "", !S.densityStatus) +
    chip(2, "담금시간", S.dipSeconds ? S.dipSeconds + "초" : "", !!S.densityStatus && !S.dipSeconds) +
    chip(3, "시유 · 두께 산출", S.recordId || "", !!S.dipSeconds && !S.recordId);
}

/* ── 부록 C 대장 ─────────────────────────────────────────────────────── */

function renderRegistry() {
  const rows = S.registry
    .map((c) => {
      const undet = !c.determined;
      const value = undet
        ? `<td class="value-missing">미정 — 값 없음</td>`
        : `<td class="num mono">${esc(c.value)}${
            c.lower !== null && c.upper !== null ? ` <span class="subtle">(${c.lower}–${c.upper})</span>` : ""
          }</td>`;
      return `<tr class="${undet ? "undetermined" : ""}">
        <td class="mono"><b>${esc(c.symbol)}</b><br><span class="subtle">${esc(c.dimension)}</span></td>
        <td>${esc(c.definition)}${c.note ? `<br><span class="subtle">${esc(c.note)}</span>` : ""}</td>
        ${value}
        <td>${esc(c.identification)}</td>
        <td>${esc(c.annotation)}</td>
      </tr>`;
    })
    .join("");
  $("registry-body").innerHTML = `
    <div class="scroll-x"><table>
      <thead><tr><th>기호</th><th>정의</th><th>값</th><th>확인 방법</th><th>설명</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

/* ── E 가정값 (미정 계수. 기본값을 채워 넣지 않는다) ─────────────────── */

function renderEControl(hostId) {
  const host = $(hostId);
  const has = S.E !== null;
  host.innerHTML = `
    <div class="msg na">
      <b>온도 계산에 쓸 가정값(E)이 아직 없어요.</b>
      아래에서 값을 직접 골라주세요 — 실제로 확인된 값이 아니라 <b>가정</b>이라는
      점이 결과에 함께 표시됩니다.
    </div>
    <div class="grid">
      <label class="f">가정값 (kJ/mol)
        <input type="number" data-e="input" step="10" min="50" max="900"
               placeholder="미입력" value="${has ? S.E : ""}">
      </label>
      <label class="f">슬라이더
        <input type="range" data-e="range" min="100" max="800" step="10"
               value="${has ? S.E : 400}" ${has ? "" : "disabled"}>
      </label>
    </div>
    <div class="row">
      <span class="subtle">자주 쓰는 값:</span>
      ${[200, 300, 400, 500, 600].map((v) => `<button class="act ghost small" data-e-pick="${v}">${v}</button>`).join("")}
      <span class="badge ${has ? "accent" : "na"}">${
        has ? `가정값 사용 중 — ${S.E} kJ/mol` : "값을 입력해야 다음 단계로 진행할 수 있어요"
      }</span>
    </div>`;

  const set = (v) => {
    S.E = Number.isFinite(v) && v > 0 ? v : null;
    renderEControl("e-control-sim");
    renderEControl("e-control-rx");
    renderStatebar();
    syncEGates();
  };
  host.querySelector('[data-e="input"]').addEventListener("change", (ev) => set(parseFloat(ev.target.value)));
  const range = host.querySelector('[data-e="range"]');
  range.addEventListener("input", (ev) => set(parseFloat(ev.target.value)));
  host.querySelectorAll("[data-e-pick]").forEach((b) =>
    b.addEventListener("click", () => set(parseFloat(b.dataset.ePick)))
  );
}

function syncEGates() {
  const locked = S.E === null;
  for (const id of ["btn-simulate", "btn-issue"]) {
    const b = $(id);
    if (!b) continue;
    b.disabled = locked;
    b.title = locked ? "먼저 가정값을 입력해주세요" : "";
  }
}

/* ── SVG (차트 라이브러리 없음. 인라인으로 직접 그린다) ──────────────── */

function polyline(pts, cls) {
  return `<polyline class="${cls}" points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/>`;
}

/* 7-6절 · 기물 실루엣 + 유약층. 유약층은 과장해서 그리고 숫자는 정확히 병기한다. */
function silhouetteSVG(profile, safe) {
  const pts = profile.points;
  if (!pts.length) return "";
  const W = 460, pad = 26, labelRoom = 124, maxBody = 210;
  const zmax = Math.max(...pts.map((p) => p.z), 1);
  const rmax = Math.max(...pts.map((p) => p.radius), 1);
  const scale = Math.min((W / 2 - labelRoom) / rmax, maxBody / zmax);
  const H = Math.round(2 * pad + 16 + zmax * scale); // 도형 높이에 맞춰 여백을 없앤다
  const cx = W / 2;
  const X = (r) => cx + r * scale;
  const Y = (z) => H - pad - 16 - z * scale;
  const exag = (t) => 5 + t * 11; // 실제는 소지의 수 % — 눈으로는 두껍게

  const right = pts.map((p) => [X(p.radius), Y(p.z)]);
  const left = pts.map((p) => [X(-p.radius), Y(p.z)]).reverse();
  const body = `<polygon class="body-fill" points="${[...right, ...left]
    .map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1))
    .join(" ")}"/>`;

  let bands = "", labels = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const t = (a.total + b.total) / 2;
    const cls = t < safe[0] ? "glz-thin" : t > safe[1] ? "glz-thick" : "glz-ok";
    const quad = (sign) =>
      `<polygon class="${cls}" points="${[
        [X(sign * a.radius), Y(a.z)],
        [X(sign * a.radius) + sign * exag(a.total), Y(a.z)],
        [X(sign * b.radius) + sign * exag(b.total), Y(b.z)],
        [X(sign * b.radius), Y(b.z)],
      ].map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/>`;
    bands += quad(1) + quad(-1);
  }
  pts.forEach((p) => {
    const cls = p.total < safe[0] ? "얇음" : p.total > safe[1] ? "두꺼움" : "안전";
    labels += `<text x="${(X(p.radius) + exag(p.total) + 5).toFixed(1)}" y="${(Y(p.z) + 3).toFixed(1)}">${p.total.toFixed(2)}mm · ${cls}</text>`;
    labels += `<text x="${(X(-p.radius) - exag(p.total) - 5).toFixed(1)}" y="${(Y(p.z) + 3).toFixed(1)}" text-anchor="end">z=${p.z.toFixed(0)}</text>`;
  });

  return `<figure class="chart"><div class="scroll-x">
    <svg class="chart silhouette" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="기물 실루엣과 부위별 유약 두께">
      ${body}${bands}${labels}
      <line class="axis" x1="${pad / 2}" y1="${H - pad}" x2="${W - pad / 2}" y2="${H - pad}"/>
      <text x="${pad / 2}" y="${H - pad + 13}">굽 (z=0)</text>
    </svg></div>
    <figcaption>유약층은 보기 쉽게 <b>두껍게 그렸어요</b> (실제로는 훨씬 얇습니다). 안전 범위
      ${safe[0]}–${safe[1]}mm 기준으로
      <span class="badge na">얇음</span> <span class="badge">안전</span>
      <span class="badge danger">두꺼움</span> 을 표시했어요.</figcaption></figure>`;
}

/* 부위별 두께 분포 (총량 제약 안에서의 분포 — 7-2절) */
function thicknessSVG(profile, safe) {
  const pts = profile.points;
  const W = 680, H = 240, L = 46, R = 16, T = 14, B = 34;
  const zmax = Math.max(...pts.map((p) => p.z), 1);
  const tmax = Math.max(...pts.map((p) => p.total), safe[1]) * 1.25;
  const X = (z) => L + (z / zmax) * (W - L - R);
  const Y = (t) => H - B - (t / tmax) * (H - B - T);

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const t = (tmax / 4) * i;
    grid += `<line class="gridline" x1="${L}" y1="${Y(t)}" x2="${W - R}" y2="${Y(t)}"/>
             <text x="4" y="${(Y(t) + 3).toFixed(1)}">${t.toFixed(2)}</text>`;
  }
  const band = `<rect class="band-safe" x="${L}" y="${Y(safe[1])}" width="${W - L - R}"
      height="${(Y(safe[0]) - Y(safe[1])).toFixed(1)}"/>
      <text x="${L + 6}" y="${(Y(safe[1]) - 4).toFixed(1)}">안전 범위 ${safe[0]}–${safe[1]}mm</text>`;

  const total = polyline(pts.map((p) => [X(p.z), Y(p.total)]), "line-1");
  const abs = polyline(pts.map((p) => [X(p.z), Y(p.t_abs)]), "line-2");
  const mean = `<line class="line-3" x1="${L}" y1="${Y(profile.mean_mm)}" x2="${W - R}" y2="${Y(profile.mean_mm)}"/>
    <text x="${W - R - 4}" y="${(Y(profile.mean_mm) - 5).toFixed(1)}" text-anchor="end">평균 ${profile.mean_mm.toFixed(3)}mm</text>`;
  const dots = pts
    .map((p) => `<circle cx="${X(p.z).toFixed(1)}" cy="${Y(p.total).toFixed(1)}" r="3" fill="var(--ink-1)"/>
      <text x="${X(p.z).toFixed(1)}" y="${(Y(p.total) - 8).toFixed(1)}" text-anchor="middle">${p.total.toFixed(2)}</text>`)
    .join("");

  return `<figure class="chart"><div class="scroll-x">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="부위별 두께 분포">
      ${band}${grid}${abs}${total}${mean}${dots}
      <line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>
      <line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>
      <text x="${L}" y="${H - 8}">굽 z=0</text>
      <text x="${W - R}" y="${H - 8}" text-anchor="end">z=${zmax.toFixed(0)}mm</text>
    </svg></div>
    <figcaption class="legend">
      <span><i style="background:var(--ink-1)"></i>총 두께</span>
      <span><i style="background:var(--ink-2)"></i>흡수층 두께</span>
      <span><i style="background:var(--ink-3)"></i>평균 두께</span>
    </figcaption></figure>`;
}

/* 9-6절 · 자연냉각률 곡선을 배경으로 깔고 그 아래만 고를 수 있게 보인다 */
function coolingSVG(curve, segs) {
  const W = 680, H = 270, L = 52, R = 16, T = 16, B = 40;
  const temps = curve.map((p) => p.temp_c);
  const tHi = Math.max(...temps), tLo = Math.min(...temps);
  const rates = curve.map((p) => p.natural_rate);
  const rMax = Math.max(...rates, ...segs.map((s) => Number(s.rate_c_per_h) || 0)) * 1.15;
  const X = (t) => L + ((tHi - t) / (tHi - tLo)) * (W - L - R); // 왼쪽이 고온
  const Y = (r) => H - B - (r / rMax) * (H - B - T);

  const pts = curve.map((p) => [X(p.temp_c), Y(p.natural_rate)]);
  const forbidden = `<polygon class="forbidden" points="${pts
    .map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1))
    .join(" ")} ${X(tLo).toFixed(1)},${T} ${X(tHi).toFixed(1)},${T}"/>`;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const r = (rMax / 4) * i;
    grid += `<line class="gridline" x1="${L}" y1="${Y(r)}" x2="${W - R}" y2="${Y(r)}"/>
             <text x="4" y="${(Y(r) + 3).toFixed(1)}">${r.toFixed(0)}</text>`;
  }
  for (const t of [1200, 1000, 800, 600, 400, 200]) {
    if (t > tHi || t < tLo) continue;
    grid += `<line class="gridline" x1="${X(t)}" y1="${T}" x2="${X(t)}" y2="${H - B}"/>
             <text x="${X(t).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${t}℃</text>`;
  }
  // 573℃ 석영 전이 — 목적이 다른 구간이라 따로 표시한다 (9-6절)
  const quartz =
    573 <= tHi && 573 >= tLo
      ? `<line x1="${X(573)}" y1="${T}" x2="${X(573)}" y2="${H - B}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="4 3"/>
         <text x="${(X(573) + 4).toFixed(1)}" y="${T + 12}" fill="var(--danger)">573℃ 석영 전이</text>`
      : "";

  const bars = segs
    .map((s, i) => {
      const rate = Number(s.rate_c_per_h);
      const nat = natRateAt(curve, Number(s.from_c));
      const bad = rate > nat;
      return `<line class="${bad ? "seg-bad" : "seg"}" x1="${X(Number(s.from_c)).toFixed(1)}" y1="${Y(rate).toFixed(1)}"
                x2="${X(Number(s.to_c)).toFixed(1)}" y2="${Y(rate).toFixed(1)}"/>
              <text x="${((X(Number(s.from_c)) + X(Number(s.to_c))) / 2).toFixed(1)}" y="${(Y(rate) - 6).toFixed(1)}"
                text-anchor="middle">구간 ${i + 1} · ${rate}℃/h${bad ? " · 자연 냉각보다 빠름" : ""}</text>`;
    })
    .join("");

  return `<figure class="chart"><div class="scroll-x">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="자연냉각률 곡선과 선택한 서냉 구간">
      ${forbidden}${grid}${quartz}
      ${polyline(pts, "line-1")}
      ${bars}
      <line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>
      <line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>
      <text x="2" y="${T - 5}">냉각률 ℃/h</text>
      <text x="${W - R}" y="${H - 6}" text-anchor="end">← 고온 · 저온 →</text>
    </svg></div>
    <figcaption class="legend">
      <span><i style="background:var(--ink-1)"></i>자연 냉각 속도 (최대 속도)</span>
      <span><i style="background:var(--na);opacity:.5"></i>회색 영역은 <b>선택할 수 없어요</b> — 자연 냉각보다 빠르게 식힐 수 없어요</span>
    </figcaption></figure>`;
}
function natRateAt(curve, temp) {
  let best = curve[0];
  for (const p of curve) if (Math.abs(p.temp_c - temp) < Math.abs(best.temp_c - temp)) best = p;
  return best.natural_rate;
}

/* 소성 곡선 */
function firingSVG(sim) {
  const steps = sim.steps;
  const W = 680, H = 260, L = 46, R = 42, T = 14, B = 34;
  const tmaxS = Math.max(...steps.map((s) => s.t), 1);
  const cmax = Math.max(...steps.map((s) => Math.max(s.sensor_c, s.ware_c)), ...sim.schedule.map((p) => p.temp_c)) * 1.08;
  const pmax = Math.max(...steps.map((s) => s.power_w), 1);
  const X = (t) => L + (t / tmaxS) * (W - L - R);
  const Y = (c) => H - B - (c / cmax) * (H - B - T);
  const YP = (w) => H - B - (w / pmax) * (H - B - T);

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const c = (cmax / 4) * i;
    grid += `<line class="gridline" x1="${L}" y1="${Y(c)}" x2="${W - R}" y2="${Y(c)}"/>
             <text x="4" y="${(Y(c) + 3).toFixed(1)}">${c.toFixed(0)}℃</text>`;
  }
  const hours = tmaxS / 3600;
  for (let h = 0; h <= hours; h += Math.max(1, Math.round(hours / 6))) {
    grid += `<line class="gridline" x1="${X(h * 3600)}" y1="${T}" x2="${X(h * 3600)}" y2="${H - B}"/>
             <text x="${X(h * 3600).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${h}h</text>`;
  }
  const power = `<polyline points="${steps.map((s) => X(s.t).toFixed(1) + "," + YP(s.power_w).toFixed(1)).join(" ")}"
      fill="none" stroke="var(--border-2)" stroke-width="1"/>
      <text x="${W - R + 4}" y="${T + 10}">전력</text>
      <text x="${W - R + 4}" y="${T + 22}">${pmax.toFixed(0)}W</text>`;

  return `<figure class="chart"><div class="scroll-x">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="소성 곡선">
      ${grid}${power}
      ${polyline(sim.schedule.map((p) => [X(p.t), Y(p.temp_c)]), "line-2")}
      ${polyline(steps.map((s) => [X(s.t), Y(s.ware_c)]), "line-3")}
      ${polyline(steps.map((s) => [X(s.t), Y(s.sensor_c)]), "line-1")}
      <line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>
      <line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>
    </svg></div>
    <figcaption class="legend">
      <span><i style="background:var(--ink-1)"></i>센서 온도 (제어기가 보는 값)</span>
      <span><i style="background:var(--ink-2)"></i>설정한 목표 온도</span>
      <span><i style="background:var(--ink-3)"></i>기물 온도 (시뮬레이터 내부 값 — 실제로는 측정되지 않아요)</span>
      <span><i style="background:var(--border-2)"></i>전력 (오른쪽 눈금)</span>
    </figcaption></figure>`;
}

/* ── ① 목표 ──────────────────────────────────────────────────────────── */

function fillAxisSelect(id, items, level) {
  $(id).innerHTML = items
    .map((i) => `<option value="${i.level}" ${i.level === level ? "selected" : ""}>${esc(i.label)}</option>`)
    .join("");
}

async function doSetTarget() {
  try {
    const out = await call("set_target", [parseInt($("t-gloss").value, 10), parseInt($("t-transp").value, 10)]);
    S.targetLabel = `${out.gloss} · ${out.transparency}`;
    renderStatebar();
    $("target-out").innerHTML = `
      <div class="msg"><b>목표 좌표</b> — 광택도 <b>${esc(out.gloss)}</b> · 투명도 <b>${esc(out.transparency)}</b></div>
      ${annoLine(out.note)}`;
  } catch (e) {
    $("target-out").innerHTML = errBox(e);
  }
}

/* ── 참고 색상 (4-4-a절 · 예측이 아니라 열람) ─────────────────────────── */

function fillColorSelects() {
  const opts = S.colorants.map((c) => `<option value="${esc(c.symbol)}">${esc(c.name)}</option>`).join("");
  $("t-color-a").innerHTML = opts;
  $("t-color-b").innerHTML = `<option value="">없음</option>${opts}`;
  $("t-color-a").value = S.colorants[0].symbol;
  syncColorAmountRange();
}

/* 산화물마다 문헌 통상 첨가량(wt%)이 다르므로 슬라이더 상한을 그때그때 맞춘다.
   0%(중성 바탕색)부터는 항상 갈 수 있어야 "드래그하면 옅음→짙음이 보인다"가
   성립한다 — 하한을 통상범위 시작점으로 막지 않는다. */
function syncColorAmountRange() {
  const c = S.colorants.find((x) => x.symbol === $("t-color-a").value);
  if (!c) return;
  const [lo, hi] = c.typical_pct;
  const amount = $("t-color-amount");
  amount.min = 0;
  amount.max = hi;
  if (parseFloat(amount.value) > hi) amount.value = lo;
  $("t-color-amount-val").textContent = `(통상 ${fmt(lo, 1)}–${fmt(hi, 1)}%)`;
}

async function renderColorMix() {
  const a = $("t-color-a").value;
  const b = $("t-color-b").value || null;
  const blend = num("t-color-blend") / 100;
  const sat = num("t-color-sat") / 100;
  const bri = num("t-color-bri") / 100;
  const amountPct = num("t-color-amount");
  const batchG = num("t-color-batch");
  try {
    const r = await call("mix_color", [a, b, blend], {
      amount_pct: amountPct, saturation_delta: sat, brightness_delta: bri,
      batch_dry_g: batchG,
    });
    if (!r.ok) {
      $("t-color-out").innerHTML = errBox(r);
      return;
    }
    $("t-color-swatch").style.background = r.hex;
    const lowMatch = r.match_quality < 0.7;
    $("t-color-out").innerHTML = `
      <div class="msg"><b>참고 색상</b> — <span class="mono">${esc(r.hex)}</span>
        <span class="badge ${lowMatch ? "warn" : ""}">일치도 ${fmt(r.match_quality * 100, 0)}%</span></div>
      <div class="readouts">
        <div class="readout ${lowMatch ? "warn" : ""}">
          <div class="k">환산 첨가량</div>
          <div class="v">${fmt(r.implied_amount_pct, 2)}<span class="u"> wt%</span></div>
          <div class="sub">지금 색을 되짚은 값 — 건조 재료 100g당 ${fmt(r.grams_per_100g_dry, 2)}g</div>
        </div>
        <div class="readout ${lowMatch ? "warn" : ""}">
          <div class="k">이번 배치</div>
          <div class="v">${fmt(r.grams_for_batch, 2)}<span class="u"> g</span></div>
          <div class="sub">건조 재료 ${fmt(r.batch_dry_g, 0)}g 기준</div>
        </div>
      </div>
      ${provBlock("문헌 근거 (예측 아님)", r.provenance_notes)}`;
  } catch (e) {
    $("t-color-out").innerHTML = errBox(e);
  }
}

/* ── ② 탐색 ──────────────────────────────────────────────────────────── */

function materialsTable(mats) {
  const rows = Object.entries(mats)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num mono">${fmt(v, 1)}</td></tr>`)
    .join("");
  return `<div class="scroll-x"><table><thead><tr><th>원료</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function doPropose() {
  const box = $("search-out");
  box.innerHTML = `<p class="subtle">후보를 만드는 중…</p>`;
  try {
    const out = await call("propose", [parseInt($("s-n").value, 10)], { grid_step: num("s-step") });
    S.candidates = out.candidates;
    const cards = out.candidates
      .map(
        (c, i) => `<div class="card">
        <div class="row" style="margin-top:0">
          <b>후보 ${i + 1}</b>
          <span class="badge">${
            c.expected_distance === null
              ? "예상 거리 없음 (데이터 부족)"
              : "예상 거리 " + fmt(c.expected_distance, 3)
          }</span>
        </div>
        ${materialsTable(c.materials)}
        ${provBlock("참고 자료", String(c.umf_note).split(" | "))}
        <div class="row">
          <button class="act ghost small" data-inspect="${i}">자세히 보기</button>
          <button class="act small" data-adopt="${i}">이 후보 선택하기</button>
        </div>
        <div data-inspect-out="${i}"></div>
      </div>`
      )
      .join("");
    box.innerHTML = `
      <div class="msg">탐색 간격 <b>${fmt(out.grid_step, 1)}%</b> ·
        쌓인 실험 <b>${out.observation_count}건</b> ·
        내 데이터 반영 비율 <b>${fmt(out.personal_weight, 3)}</b>
        <br><span class="subtle">실험이 쌓일수록 추천이 더 정교해져요.</span></div>
      ${cards}`;
    box.querySelectorAll("[data-inspect]").forEach((b) =>
      b.addEventListener("click", () => doInspect(parseInt(b.dataset.inspect, 10)))
    );
    box.querySelectorAll("[data-adopt]").forEach((b) =>
      b.addEventListener("click", () => doAdopt(parseInt(b.dataset.adopt, 10)))
    );
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

async function doInspect(i) {
  const c = S.candidates[i];
  const host = document.querySelector(`[data-inspect-out="${i}"]`);
  try {
    const u = await call("inspect_composition", [c.materials, $("s-cone").value]);
    if (!u.ok) {
      host.innerHTML = `<div class="msg warn">${esc(u.reason)}</div>`;
      return;
    }
    host.innerHTML = `
      <div class="msg"><b>참고 구역</b> — ${esc(u.zone)} <span class="subtle">(${esc(u.cone)})</span>
        <br>SiO₂ ${fmt(u.sio2, 2)} · Al₂O₃ ${fmt(u.al2o3, 2)} · 비율 ${fmt(u.ratio, 2)}</div>
      ${provBlock("참고 자료 (판정 아님)", [u.provenance_note])}
      <div class="scroll-x"><table>
        <thead><tr><th>융제 (RO)</th><th class="num">몰비</th><th>안정제</th><th class="num">몰비</th></tr></thead>
        <tbody>${Object.entries(u.fluxes)
          .map(([k, v], n) => {
            const st = Object.entries(u.stabilizers)[n];
            return `<tr><td>${esc(k)}</td><td class="num mono">${fmt(v, 3)}</td>
              <td>${st ? esc(st[0]) : ""}</td><td class="num mono">${st ? fmt(st[1], 3) : ""}</td></tr>`;
          })
          .join("")}</tbody></table></div>`;
  } catch (e) {
    host.innerHTML = errBox(e);
  }
}

async function doAdopt(i) {
  const c = S.candidates[i];
  try {
    const r = await call("adopt_candidate", [`후보 ${i + 1}`, c.materials]);
    S.recipeId = r.recipe_id;
    S.recipeName = r.name;
    renderStatebar();
    await refreshRecipes();
    document.querySelector(`[data-inspect-out="${i}"]`).innerHTML =
      `<div class="msg"><b>선택됨</b> — ${esc(r.name)} <span class="mono">${esc(r.recipe_id)}</span>.
       이 레시피만의 계산값이 새로 만들어졌어요.</div>`;
  } catch (e) {
    document.querySelector(`[data-inspect-out="${i}"]`).innerHTML = errBox(e);
  }
}

async function refreshRecipes() {
  const st = await call("export_state");
  const rows = Object.entries(st.recipes)
    .map(
      ([rid, r]) => `<tr>
      <td><b>${esc(r.name)}</b><br><span class="mono subtle">${esc(rid)}</span></td>
      <td>${Object.entries(r.materials).map(([k, v]) => `${esc(k)} ${fmt(v, 1)}`).join(" · ")}</td>
      <td><button class="act ghost small" data-pick="${esc(rid)}" ${rid === S.recipeId ? "disabled" : ""}>${
        rid === S.recipeId ? "현재 유약" : "선택"
      }</button></td></tr>`
    )
    .join("");
  $("recipe-list").innerHTML = `<div class="scroll-x"><table>
    <thead><tr><th>레시피</th><th>조성</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $("recipe-list").querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", async () => {
      S.recipeId = b.dataset.pick;
      S.recipeName = st.recipes[S.recipeId].name;
      renderStatebar();
      await refreshRecipes();
    })
  );
}

/* ── ③ 배치·시유 ────────────────────────────────────────────────────── */

async function doDensity() {
  const box = $("density-out");
  try {
    const d = await call("check_density", [num("d-rho"), num("d-min")], {
      target_lo: num("d-lo"), target_hi: num("d-hi"),
    });
    if (!d.ok) {
      box.innerHTML = `<div class="msg warn">${esc(d.reason)}</div>`;
      return;
    }
    const warn = d.status !== "정상";
    S.densityStatus = d.status;
    renderStatebar();
    box.innerHTML = `
      <div class="readouts">
        <div class="readout ${warn ? "warn" : ""}">
          <div class="k">판정</div><div class="v" style="font-size:1.25rem">${esc(d.status)}</div>
          <div class="sub">g(ρ) = ${fmt(d.g_rho, 4)}</div>
        </div>
        <div class="readout">
          <div class="k">재측정</div><div class="v" style="font-size:1.25rem">${d.remeasure_recommended ? "권장" : "불필요"}</div>
          <div class="sub">시간이 지나면 달라질 수 있어요</div>
        </div>
      </div>
      <div class="msg ${warn ? "warn" : ""}">${esc(d.message)}</div>
      ${annoLine(d.annotation)}
      <p class="subtle">경고가 떠도 계속 진행할 수 있어요. 최종 판단은 사용자 몫이에요.</p>`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

async function doDip() {
  const box = $("dip-out");
  try {
    const r = await call("suggest_dip_time", [num("dt-target"), num("dt-rho"), S.recipeId], {
      t_flow_mm: num("dt-flow"),
    });
    box.innerHTML = `
      <div class="msg ${r.feasible ? "" : "warn"}">
        담금시간 <b>${fmt(r.seconds, 2)}초</b> → 예상 평균 두께 <b>${fmt(r.predicted_mean_mm, 3)}mm</b>
        ${r.feasible ? "" : "<br>" + esc(r.reason)}</div>
      ${annoLine(r.annotation)}`;
    if (r.feasible) {
      $("g-dip").value = fmt(r.seconds, 2);
      S.dipSeconds = fmt(r.seconds, 2);
      renderStatebar();
    }
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

async function doWare() {
  try {
    const w = await call("register_ware", [$("w-shape").value, $("w-clay").value, num("w-bisque")]);
    S.wareId = w.ware_id;
    S.wareName = w.name;
    $("ware-out").textContent = `등록됨 — ${w.name} (${w.ware_id})`;
    renderStatebar();
  } catch (e) {
    $("ware-out").innerHTML = errBox(e);
  }
}

async function doGlaze() {
  const box = $("glaze-out");
  if (!S.wareId) {
    box.innerHTML = `<div class="msg warn">기물을 먼저 등록해주세요.</div>`;
    return;
  }
  try {
    const method = $("g-method").value;
    const dipping = (S.presets.methods.find((m) => m.value === method) || {}).has_distribution;
    const p = await call("glaze", [S.wareId, S.recipeId, method, num("g-before"), num("g-after")], {
      // 담금이 아니면 담금시간을 보내지 않는다 — 분무한 기물에 담금시간이
      // 기록되면 그 회차가 나중에 무엇이었는지 읽을 수 없게 된다.
      dip_seconds: dipping ? num("g-dip") : null,
      rho: num("g-rho"),
      waxed_area_m2: num("g-wax"),
      is_reglaze: $("g-reglaze").checked,
      drying_complete: $("g-dry").checked,
    });
    if (!p.ok) {
      box.innerHTML = `<div class="msg warn"><b>기록할 수 없어요</b><br>${esc(p.reason)}</div>`;
      return;
    }
    S.recordId = p.record_id;
    renderStatebar();
    // 안전창은 같은 응답에 실려 온다 — 계수 표를 한 번 더 물으면 두 값이
    // 어긋난 채 그려질 수 있다.
    const safe = p.safe_thickness_mm;
    const over = p.local_max_mm > safe[1];
    box.innerHTML = `
      <div class="readouts">
        <div class="readout">
          <div class="k">평균 두께</div>
          <div class="v">${fmt(p.mean_mm, 3)}<span class="u"> mm</span></div>
          <div class="sub">저울 값으로 계산</div>
        </div>
        <div class="readout ${over ? "danger" : ""}">
          <div class="k">국소 최대</div>
          <div class="v">${fmt(p.local_max_mm, 3)}<span class="u"> mm</span></div>
          <div class="sub"><b>가장 불확실한 값</b></div>
        </div>
        <div class="readout">
          <div class="k">편차</div>
          <div class="v">${fmt(p.spread_mm, 3)}<span class="u"> mm</span></div>
          <div class="sub">안전 범위 폭 ${fmt(safe[1] - safe[0], 2)}mm</div>
        </div>
      </div>
      <p class="subtle">유약 ${fmt(p.glaze_weight_g, 1)}g · 면적 ${fmt(p.area_m2, 4)}m² ·
        시유기록 <span class="mono">${esc(p.record_id)}</span></p>
      ${
        p.has_distribution
          ? ""
          : `<div class="msg na"><b>부위별 두께는 계산되지 않아요.</b>
             담금 방식일 때만 계산할 수 있어요. 평균 두께만 나오고,
             ④ 점검 탭에서는 "판정 불가"로 표시됩니다.</div>`
      }
      ${
        p.within_model_scope
          ? ""
          : `<div class="msg warn">이 조건에서는 계산이 정확하지 않을 수 있어요 (재시유·건조 미완 등).</div>`
      }
      ${p.has_distribution ? silhouetteSVG(p, safe) : ""}
      ${p.has_distribution ? thicknessSVG(p, safe) : ""}
      ${provBlock("이 계산에 사용된 값", p.provenance_notes)}`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

/* 시유 방법이 분포 모델을 주지 않으면 담금시간 칸을 숨긴다 (7-5절).
   칸을 남겨 두면 분무한 기물에 담금시간이 적히고, 그 회차가 나중에
   무엇이었는지 읽을 수 없게 된다. */
function syncMethodFields() {
  const field = $("g-dip-field");
  if (!field || !S.presets) return;
  const m = S.presets.methods.find((x) => x.value === $("g-method").value);
  field.hidden = !(m && m.has_distribution);
}

/* ── ④ 위험 (8-4절 화면) ────────────────────────────────────────────── */

function levelClass(f) {
  if (!f.available) return "lv-na";
  return ["lv-none", "lv-low", "lv-med", "lv-high"][f.level_value] || "lv-none";
}

async function doRisk() {
  const box = $("risk-out");
  if (!S.recordId) {
    box.innerHTML = `<div class="msg warn">③ 시유 탭에서 먼저 기록해주세요.</div>`;
    return;
  }
  try {
    const r = await call("risk", [S.recordId, S.recipeId]);
    const findings = r.findings
      .map(
        (f) => `<div class="finding ${levelClass(f)}">
        <div class="hd">
          <div>${esc(f.risk)}</div>
          <span class="badge ${f.available ? (f.level_value >= 3 ? "danger" : f.level_value >= 1 ? "warn" : "") : "na"}">${esc(f.level)}</span>
        </div>
        <div>
          <div class="detail">${esc(f.detail)}</div>
          <div class="anno">${esc(f.annotation)}</div>
          ${
            f.available
              ? ""
              : `<div class="anno"><b>위험이 없다는 뜻이 아니에요</b> — 판단할 근거가 부족해요</div>`
          }
        </div>
      </div>`
      )
      .join("");

    const options = r.options.length
      ? `<div class="options">
          <div class="option-head"><div>대처 방법</div><div>비용</div><div>효과</div></div>
          ${r.options
            .map(
              (o) => `<div class="option">
            <span class="nm">${esc(o.name)}</span>
            <span class="cost ${o.cost === "없음" ? "free" : ""}">${esc(o.cost)}</span>
            <span class="eff">${esc(o.effect)}</span>
            ${o.confidence_downgrade ? `<span class="dg">선택하면 이후 예측 정확도가 <b>낮아져요</b></span>` : ""}
          </div>`
            )
            .join("")}
        </div>`
      : `<div class="msg">지금은 특별히 조치할 게 없어요.</div>`;

    // 판정에 쓰인 안전창이 응답에 실려 온다 — 계수 표를 다시 묻지 않는다.
    const kind = r.worst_level >= 3 ? "danger" : r.worst_level >= 2 ? "warn" : r.worst_level < 0 ? "na" : "";
    box.innerHTML = `
      <div class="readouts">
        <div class="readout ${kind}">
          <div class="k">최고 위험 등급</div>
          <div class="v" style="font-size:1.5rem">${esc(r.worst)}</div>
          <div class="sub">시유기록 <span class="mono">${esc(S.recordId)}</span></div>
        </div>
        <div class="readout">
          <div class="k">안전 범위</div>
          <div class="v" style="font-size:1.5rem">${fmt(r.safe_thickness_mm[0], 2)}–${fmt(r.safe_thickness_mm[1], 2)}<span class="u"> mm</span></div>
          <div class="sub">실패 사례가 쌓일수록 더 정확해져요</div>
        </div>
      </div>
      <h3>위험 종류</h3>
      ${findings}
      <h3>대처 방법</h3>
      ${options}
      ${r.profile.has_distribution ? silhouetteSVG(r.profile, r.safe_thickness_mm) : ""}
      ${provBlock("이 판정에 사용된 값", r.profile.provenance_notes)}`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

/* ── ⑤ 소성 ─────────────────────────────────────────────────────────── */

async function doLoading() {
  const box = $("loading-out");
  try {
    S.kilnKey = $("k-kiln").value;
    const l = await call("loading", [S.kilnKey, S.wareId ? [S.wareId] : [], num("l-shelf"), num("l-kg"), num("l-obs")]);
    box.innerHTML = `
      <div class="msg ${l.gross_error ? "warn" : ""}">
        선반 점유율 <b>${fmt(l.packing_ratio * 100, 1)}%</b> ·
        기준 <b>${fmt(l.threshold * 100, 0)}%</b> ·
        ${l.gross_error ? "<b>이상하게 많아요</b>" : "정상 범위예요"}</div>
      ${provBlock("판정 근거", [l.message])}`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

function renderSegRows() {
  $("seg-rows").innerHTML = S.segs
    .map(
      (s, i) => `<div class="seg-row">
      <label class="f">시작 ℃<input type="number" data-seg="${i}" data-k="from_c" value="${s.from_c}" step="10"></label>
      <label class="f">종료 ℃<input type="number" data-seg="${i}" data-k="to_c" value="${s.to_c}" step="10"></label>
      <label class="f">냉각률 ℃/h<input type="number" data-seg="${i}" data-k="rate_c_per_h" value="${s.rate_c_per_h}" step="5"></label>
      <label class="f">목적<input type="text" data-seg="${i}" data-k="purpose" value="${esc(s.purpose)}"></label>
      <button class="act ghost small" data-seg-del="${i}">삭제</button>
    </div>`
    )
    .join("");
  $("seg-rows").querySelectorAll("[data-seg]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = S.segs[parseInt(inp.dataset.seg, 10)];
      const k = inp.dataset.k;
      s[k] = k === "purpose" ? inp.value : parseFloat(inp.value);
    })
  );
  $("seg-rows").querySelectorAll("[data-seg-del]").forEach((b) =>
    b.addEventListener("click", () => {
      S.segs.splice(parseInt(b.dataset.segDel, 10), 1);
      renderSegRows();
    })
  );
}

async function doCooling() {
  const box = $("cooling-out");
  try {
    S.kilnKey = $("k-kiln").value;
    const c = await call("cooling", [S.kilnKey, S.segs]);
    S.lastCooling = c;
    box.innerHTML = `
      ${coolingSVG(c.natural_curve, S.segs)}
      <div class="msg ${c.feasible ? "" : "warn"}">
        ${esc(c.kiln_name)} · ${c.feasible ? "가능한 냉각 계획이에요" : "<b>불가능한 구간이 있어요</b>"}
        <br>총 <b>${fmt(c.total_hours, 2)}시간</b> ·
        자연 냉각보다 <b>${fmt(c.extra_hours, 2)}시간 · ${fmt(c.extra_kwh, 2)} kWh</b> 더 걸려요</div>
      ${
        c.rejections.length
          ? `<div class="msg danger"><b>불가능한 이유</b><ul>${c.rejections.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>`
          : ""
      }
      ${provBlock("근거", c.provenance_notes)}`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

async function doSimulate() {
  const box = $("sim-out");
  if (S.E === null) {
    box.innerHTML = `<div class="msg na">먼저 가정값(E)을 입력해주세요.</div>`;
    return;
  }
  box.innerHTML = `<p class="subtle">시뮬레이션 중…</p>`;
  try {
    S.kilnKey = $("k-kiln").value;
    const sim = await call("simulate", [S.kilnKey, num("f-peak"), num("f-ramp"), num("f-hold"), S.E], {
      seed: parseInt($("f-seed").value, 10),
      voltage_pct: num("f-volt"),
      aging_pct: num("f-age"),
      noise_c: num("f-noise"),
    });
    S.lastSim = sim;
    box.innerHTML = `
      ${firingSVG(sim)}
      <div class="msg">최고 센서 온도 <b>${fmt(sim.peak_sensor_c, 1)}℃</b> ·
        누적 열일량 <b>${sci(sim.heat_work)}</b>
        <br><span class="subtle">절대적인 값이 아니라 회차끼리 비교할 때 쓰는 값이에요.</span></div>
      <div class="msg na"><b>가정값을 사용한 계산이에요.</b> ${esc(sim.E_note)}</div>
      ${provBlock("제어 판단 근거", [sim.final_decision])}
      ${provBlock("시뮬레이터 근거", sim.provenance_notes)}`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

async function doRecordRun() {
  const box = $("sim-out");
  if (!S.lastSim) {
    box.insertAdjacentHTML("beforeend", `<div class="msg warn">시뮬레이션을 먼저 실행해주세요.</div>`);
    return;
  }
  try {
    const run = await call(
      "record_run",
      [
        S.kilnKey,
        S.recordId ? [S.recordId] : [],
        S.lastSim.schedule,
        S.lastSim.steps.map((s) => ({ t: s.t, temp_c: s.sensor_c })),
        S.segs,
      ],
      { declared_kg: num("l-kg"), shelf_area_m2: num("l-shelf") }
    );
    S.runId = run.run_id;
    renderStatebar();
    box.insertAdjacentHTML(
      "beforeend",
      `<div class="msg">회차 <span class="mono">${esc(run.run_id)}</span> 저장됐어요.
       소성 기록도 함께 남았어요.</div>`
    );
  } catch (e) {
    box.insertAdjacentHTML("beforeend", errBox(e));
  }
}

/* ── ⑥ 기록·되먹임 ──────────────────────────────────────────────────── */

async function doResult() {
  const box = $("result-out");
  if (!S.runId || !S.recordId) {
    box.innerHTML = `<div class="msg warn">⑤ 소성 탭에서 먼저 기록해주세요 (시유 기록과 시뮬레이션이 필요해요).</div>`;
    return;
  }
  try {
    const failures = [...document.querySelectorAll("#r-failures input:checked")].map((i) => i.value);
    const obs = {};
    if ($("r-color").value) obs["색"] = $("r-color").value;
    const ft = $("r-frac-t").value === "" ? null : num("r-frac-t");
    const fz = $("r-frac-z").value === "" ? null : num("r-frac-z");
    const r = await call(
      "record_result",
      [S.runId, S.recordId, S.recipeId, parseInt($("r-gloss").value, 10), parseInt($("r-transp").value, 10), $("r-grade").value],
      { failures, observations: obs, fracture_thickness_mm: ft, fracture_z_mm: fz }
    );
    if (!r.ok) {
      box.innerHTML = `<div class="msg warn">${esc(r.reason)}</div>`;
      return;
    }
    const c = r.calibration;
    box.innerHTML = `
      <div class="msg">목표까지 거리 <b>${fmt(r.distance_to_target, 2)}</b> ·
        내 데이터 반영 비율 <b>${fmt(r.personal_weight, 3)}</b> ·
        다음 추천에 ${r.passes_filter ? "반영됨" : "반영 안 됨"}</div>
      ${annoLine(r.filter_note)}
      <h4>계산값 보정</h4>
      <div class="msg ${c.applied ? "" : "na"}">
        ${c.applied ? "이번 결과로 값이 갱신됐어요" : "이번엔 갱신하지 않았어요"} ·
        k₁ <b>${c.k1 === null ? "없음" : fmt(c.k1, 5)}</b>
        (이번 추정 ${c.k1_estimate === null ? "—" : fmt(c.k1_estimate, 5)}) ·
        ρ_dry <b>${c.rho_dry === null ? "없음 (캘리퍼 측정 필요)" : fmt(c.rho_dry, 4)}</b> ·
        누적 ${c.calibration_runs}회차
        <br>바로 갱신되는 값: ${c.solid.map((s) => `<span class="badge accent">${esc(s)}</span>`).join(" ") || "—"}
        <br>천천히 갱신되는 값: ${c.dashed.map((s) => `<span class="badge na">${esc(s)}</span>`).join(" ")}</div>
      ${provBlock("보정 근거", c.notes)}`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

function renderTileRows() {
  $("tile-rows").innerHTML = S.tiles
    .map(
      (t, i) => `<div class="tile-row">
      <label class="f">담금 시간(초)<input type="number" data-tile="${i}" data-k="dip_seconds" value="${t.dip_seconds}" step="0.5"></label>
      <label class="f">면적 m²<input type="number" data-tile="${i}" data-k="area_m2" value="${t.area_m2}" step="0.001"></label>
      <label class="f">유약 g<input type="number" data-tile="${i}" data-k="glaze_weight_g" value="${t.glaze_weight_g}" step="0.1"></label>
      <label class="f">캘리퍼 mm (없으면 빈칸)<input type="number" data-tile="${i}" data-k="caliper_mm" value="${t.caliper_mm}" step="0.05" placeholder="없음"></label>
      <button class="act ghost small" data-tile-del="${i}">삭제</button>
    </div>`
    )
    .join("");
  $("tile-rows").querySelectorAll("[data-tile]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const t = S.tiles[parseInt(inp.dataset.tile, 10)];
      t[inp.dataset.k] = inp.value === "" ? "" : parseFloat(inp.value);
    })
  );
  $("tile-rows").querySelectorAll("[data-tile-del]").forEach((b) =>
    b.addEventListener("click", () => {
      S.tiles.splice(parseInt(b.dataset.tileDel, 10), 1);
      renderTileRows();
    })
  );
}

async function doTiles() {
  const box = $("tiles-out");
  try {
    const r = await call("calibrate_tiles", [S.tiles, num("cal-rho")]);
    S.tileResult = r;
    box.innerHTML = `
      <div class="msg">타일 ${r.n_samples}장 · k₁ <b>${fmt(r.k1, 5)}</b> ·
        ρ_dry <b>${r.rho_dry === null ? "없음 (캘리퍼 실측 필요)" : fmt(r.rho_dry, 4)}</b>
        <br>면적당 기울기 ${fmt(r.areal_slope, 2)} · 잔차 RMS ${fmt(r.residual_rms, 4)}</div>
      <div class="row">
        <button class="act" id="btn-apply-cal">이 레시피에 반영하기</button>
      </div>
      ${provBlock("근거", r.notes)}`;
    $("btn-apply-cal").addEventListener("click", doApplyCal);
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

async function doApplyCal() {
  try {
    const r = S.tileResult;
    const out = await call("apply_calibration", [S.recipeId], { k1: r.k1, rho_dry: r.rho_dry });
    renderCoef(out, "tiles-out");
  } catch (e) {
    $("tiles-out").insertAdjacentHTML("beforeend", errBox(e));
  }
}

function renderCoef(c, hostId) {
  const html = `
    <h4>계산값 — ${esc(c.recipe_id)}</h4>
    <div class="scroll-x"><table>
      <thead><tr><th>이름</th><th class="num">값</th><th>뜻</th></tr></thead>
      <tbody>
        <tr><td>k₁</td><td class="num mono">${c.k1 === null ? "미확인" : fmt(c.k1, 5)}</td><td>흡수 두께 계산값 (매번 자동 갱신)</td></tr>
        <tr><td>k₂</td><td class="num mono">${c.k2 === null ? "미확인" : fmt(c.k2, 5)}</td><td>흘러내림 두께 계산값 (파단면 측정 필요)</td></tr>
        <tr><td>ρ_dry</td><td class="num mono">${c.rho_dry === null ? "미확인" : fmt(c.rho_dry, 4)}</td><td>건조 유약층 밀도 (캘리퍼로 확인)</td></tr>
        <tr><td>s</td><td class="num mono">${c.s === null ? "미확인" : fmt(c.s, 4)}</td><td>압축 정도 계산값</td></tr>
        <tr><td>안전 두께</td><td class="num mono">${c.safe_thickness_mm.map((v) => fmt(v, 2)).join(" – ")}</td><td>실패 사례가 적어 넓게 잡은 범위</td></tr>
        <tr><td>누적 회차</td><td class="num mono">${c.calibration_runs}</td><td>초벌 ${c.calibrated_bisque_c === null ? "미기록" : fmt(c.calibrated_bisque_c, 0) + "℃"} 기준</td></tr>
      </tbody></table></div>
    ${provBlock("이 값이 어떻게 만들어졌는지", c.provenance_notes)}`;
  const host = $(hostId);
  if (hostId === "coef-out") host.innerHTML = html;
  else host.insertAdjacentHTML("beforeend", html);
}

async function doCoef() {
  try {
    renderCoef(await call("coefficients", [S.recipeId]), "coef-out");
  } catch (e) {
    $("coef-out").innerHTML = errBox(e);
  }
}

async function doIssue() {
  const box = $("rx-out");
  if (!S.runId) {
    box.innerHTML = `<div class="msg warn">⑤ 소성 탭에서 먼저 기록해주세요.</div>`;
    return;
  }
  if (S.E === null) {
    box.innerHTML = `<div class="msg na">먼저 가정값(E)을 입력해주세요.</div>`;
    return;
  }
  try {
    const p = await call("issue_prescription", [S.runId, S.E, num("rx-peak")]);
    S.prescription = p;
    box.innerHTML = `
      <div class="msg">목표 열일량 <b>${sci(p.heat_work_target)}</b> · 최고온도 <b>${fmt(p.peak_c, 0)}℃</b>
        <br>냉각 ${p.cooling.map((s) => `${fmt(s.from_c, 0)}→${fmt(s.to_c, 0)}℃ @ ${fmt(s.rate_c_per_h, 0)}℃/h${s.purpose ? " (" + esc(s.purpose) + ")" : ""}`).join(" · ") || "없음"}</div>
      <div class="msg na"><b>가정값 E = ${fmt(p.E_assumed / 1000, 0)} kJ/mol을 기준으로 만든 처방이에요.</b>
        다른 가마에서는 결과가 달라질 수 있어요.</div>
      ${provBlock("처방 근거", p.provenance_notes)}`;
  } catch (e) {
    box.innerHTML = errBox(e);
  }
}

async function doTransform() {
  const box = $("rx-out");
  if (!S.prescription) {
    box.innerHTML = `<div class="msg warn">처방을 먼저 만들어주세요.</div>`;
    return;
  }
  try {
    const r = await call("transform_prescription", [S.prescription, $("rx-kiln").value]);
    const sched = r.schedule
      ? `<div class="scroll-x"><table><thead><tr><th>t (h)</th><th class="num">온도 ℃</th></tr></thead>
         <tbody>${r.schedule.map((p) => `<tr><td class="mono">${fmt(p.t / 3600, 2)}</td><td class="num mono">${fmt(p.temp_c, 0)}</td></tr>`).join("")}</tbody></table></div>`
      : "";
    box.insertAdjacentHTML(
      "beforeend",
      `<h4>변환 — ${esc(r.kiln_name)}</h4>
       <div class="msg ${r.feasible ? "" : "warn"}">${
         r.feasible ? "이 가마에서 그대로 쓸 수 있는 일정이 나왔어요" : "<b>변환할 수 없어요</b>"
       }</div>
       ${sched}
       ${provBlock("변환 근거와 한계", r.reasons)}`
    );
  } catch (e) {
    box.insertAdjacentHTML("beforeend", errBox(e));
  }
}

async function doExport() {
  try {
    const st = await call("export_state");
    $("export-out").innerHTML = `<div class="scroll-x"><pre class="mono" style="font-size:.76rem">${esc(
      JSON.stringify(st, null, 1)
    )}</pre></div>
    <p class="subtle">계산 근거도 함께 저장돼요.</p>`;
  } catch (e) {
    $("export-out").innerHTML = errBox(e);
  }
}

/* ── 탭 ─────────────────────────────────────────────────────────────── */

function showTab(name) {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  }
  for (const p of document.querySelectorAll("main .panel")) {
    p.hidden = p.id !== "panel-" + name;
  }
}

/* ── 초기화 ─────────────────────────────────────────────────────────── */

async function initApp() {
  S.presets = await call("presets");
  S.registry = await call("registry");
  S.colorants = await call("color_reference");
  const P = S.presets;

  fillAxisSelect("t-gloss", P.gloss, 2);
  fillAxisSelect("t-transp", P.transparency, 0);
  fillAxisSelect("r-gloss", P.gloss, 1);
  fillAxisSelect("r-transp", P.transparency, 0);

  $("w-shape").innerHTML = Object.entries(P.shapes)
    .map(([k, v], i) => `<option value="${k}" ${i === 1 ? "selected" : ""}>${esc(v.name)}</option>`)
    .join("");
  $("g-method").innerHTML = P.methods
    .map(
      (m) =>
        `<option value="${esc(m.value)}">${esc(m.value)}${m.has_distribution ? " (부위별 두께 계산 가능)" : " (평균만 계산)"}</option>`
    )
    .join("");
  const kilnOpts = Object.entries(P.kilns).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("");
  $("k-kiln").innerHTML = kilnOpts;
  $("rx-kiln").innerHTML = kilnOpts;
  $("rx-kiln").value = "large";
  $("r-grade").innerHTML = P.grades.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
  $("r-failures").innerHTML =
    `<span class="subtle">실패 이유 (등급이 "실패"일 때 선택):</span>` +
    P.failures
      .map((f) => `<label class="badge"><input type="checkbox" value="${esc(f)}"> ${esc(f)}</label>`)
      .join(" ");
  syncMethodFields();

  renderRegistry();
  renderEControl("e-control-sim");
  renderEControl("e-control-rx");
  renderSegRows();
  renderTileRows();
  fillColorSelects();
  await refreshRecipes();
  await doSetTarget();
  await renderColorMix();
  renderStatebar();
  syncEGates();

  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("btn-registry").addEventListener("click", () => ($("registry-panel").hidden = false));
  $("btn-registry-close").addEventListener("click", () => ($("registry-panel").hidden = true));
  $("btn-set-target").addEventListener("click", doSetTarget);
  $("t-color-a").addEventListener("input", () => {
    syncColorAmountRange();
    renderColorMix();
  });
  [
    "t-color-b", "t-color-blend", "t-color-sat", "t-color-bri",
    "t-color-amount", "t-color-batch",
  ].forEach((id) => $(id).addEventListener("input", renderColorMix));
  $("btn-propose").addEventListener("click", doPropose);
  $("btn-density").addEventListener("click", doDensity);
  $("btn-dip").addEventListener("click", doDip);
  $("btn-ware").addEventListener("click", doWare);
  $("btn-glaze").addEventListener("click", doGlaze);
  // 담금이 아니면 담금시간 칸 자체를 숨긴다. 남겨 두면 분무한 기물에 담금시간을
  // 적어 넣게 되고, 그 회차가 나중에 무엇이었는지 읽을 수 없게 된다 (7-5절).
  $("g-method").addEventListener("change", syncMethodFields);
  $("btn-risk").addEventListener("click", doRisk);
  $("btn-loading").addEventListener("click", doLoading);
  $("btn-seg-add").addEventListener("click", () => {
    S.segs.push({ from_c: 900, to_c: 700, rate_c_per_h: 80, purpose: "" });
    renderSegRows();
  });
  $("btn-cooling").addEventListener("click", doCooling);
  $("btn-simulate").addEventListener("click", doSimulate);
  $("btn-record-run").addEventListener("click", doRecordRun);
  $("btn-result").addEventListener("click", doResult);
  $("btn-tile-add").addEventListener("click", () => {
    S.tiles.push({ dip_seconds: 8, area_m2: 0.006, glaze_weight_g: 18, caliper_mm: "" });
    renderTileRows();
  });
  $("btn-tiles").addEventListener("click", doTiles);
  $("btn-coef").addEventListener("click", doCoef);
  $("btn-issue").addEventListener("click", doIssue);
  $("btn-transform").addEventListener("click", doTransform);
  $("btn-export").addEventListener("click", doExport);
}

boot();

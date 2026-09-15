/** Pure, escaped presentation templates retained from the original UI. React owns all state and events. */
const esc = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const fmt = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(d);
const sci = (v) => {
  if (v === null || v === undefined) return "—";
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e5)
    ? Number(v).toExponential(3)
    : Number(v).toFixed(4);
};

function provBlock(title, notes) {
  const list = (notes || []).filter(
    (n) => n !== null && n !== undefined && n !== "",
  );
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
function polyline(pts, cls) {
  return `<polyline class="${cls}" points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/>`;
}
function silhouetteSVG(profile, safe) {
  const pts = profile.points;
  if (!pts.length) return "";
  const W = 460,
    pad = 26,
    labelRoom = 124,
    maxBody = 210;
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

  let bands = "",
    labels = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const t = (a.total + b.total) / 2;
    const cls = t < safe[0] ? "glz-thin" : t > safe[1] ? "glz-thick" : "glz-ok";
    const quad = (sign) =>
      `<polygon class="${cls}" points="${[
        [X(sign * a.radius), Y(a.z)],
        [X(sign * a.radius) + sign * exag(a.total), Y(a.z)],
        [X(sign * b.radius) + sign * exag(b.total), Y(b.z)],
        [X(sign * b.radius), Y(b.z)],
      ]
        .map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1))
        .join(" ")}"/>`;
    bands += quad(1) + quad(-1);
  }
  pts.forEach((p) => {
    const cls =
      p.total < safe[0] ? "얇음" : p.total > safe[1] ? "두꺼움" : "안전";
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
function thicknessSVG(profile, safe) {
  const pts = profile.points;
  const W = 680,
    H = 240,
    L = 46,
    R = 16,
    T = 14,
    B = 34;
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

  const total = polyline(
    pts.map((p) => [X(p.z), Y(p.total)]),
    "line-1",
  );
  const abs = polyline(
    pts.map((p) => [X(p.z), Y(p.t_abs)]),
    "line-2",
  );
  const mean = `<line class="line-3" x1="${L}" y1="${Y(profile.mean_mm)}" x2="${W - R}" y2="${Y(profile.mean_mm)}"/>
    <text x="${W - R - 4}" y="${(Y(profile.mean_mm) - 5).toFixed(1)}" text-anchor="end">평균 ${profile.mean_mm.toFixed(3)}mm</text>`;
  const dots = pts
    .map(
      (
        p,
      ) => `<circle cx="${X(p.z).toFixed(1)}" cy="${Y(p.total).toFixed(1)}" r="3" fill="var(--ink-1)"/>
      <text x="${X(p.z).toFixed(1)}" y="${(Y(p.total) - 8).toFixed(1)}" text-anchor="middle">${p.total.toFixed(2)}</text>`,
    )
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
function coolingSVG(curve, segs) {
  const W = 680,
    H = 270,
    L = 52,
    R = 16,
    T = 16,
    B = 40;
  const temps = curve.map((p) => p.temp_c);
  const tHi = Math.max(...temps),
    tLo = Math.min(...temps);
  const rates = curve.map((p) => p.natural_rate);
  const rMax =
    Math.max(...rates, ...segs.map((s) => Number(s.rate_c_per_h) || 0)) * 1.15;
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
  for (const p of curve)
    if (Math.abs(p.temp_c - temp) < Math.abs(best.temp_c - temp)) best = p;
  return best.natural_rate;
}
function firingSVG(sim) {
  const steps = sim.steps;
  const W = 680,
    H = 260,
    L = 46,
    R = 42,
    T = 14,
    B = 34;
  const tmaxS = Math.max(...steps.map((s) => s.t), 1);
  const cmax =
    Math.max(
      ...steps.map((s) => Math.max(s.sensor_c, s.ware_c)),
      ...sim.schedule.map((p) => p.temp_c),
    ) * 1.08;
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
      ${polyline(
        sim.schedule.map((p) => [X(p.t), Y(p.temp_c)]),
        "line-2",
      )}
      ${polyline(
        steps.map((s) => [X(s.t), Y(s.ware_c)]),
        "line-3",
      )}
      ${polyline(
        steps.map((s) => [X(s.t), Y(s.sensor_c)]),
        "line-1",
      )}
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
function materialsTable(mats) {
  const rows = Object.entries(mats)
    .map(
      ([k, v]) =>
        `<tr><td>${esc(k)}</td><td class="num mono">${fmt(v, 1)}</td></tr>`,
    )
    .join("");
  return `<div class="scroll-x"><table><thead><tr><th>원료</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function levelClass(f) {
  if (!f.available) return "lv-na";
  return ["lv-none", "lv-low", "lv-med", "lv-high"][f.level_value] || "lv-none";
}

export function renderTarget(out) {
  return `
      <div class="msg"><b>목표 좌표</b> — 광택도 <b>${esc(out.gloss)}</b> · 투명도 <b>${esc(out.transparency)}</b></div>
      ${annoLine(out.note)}`;
}

export function renderColor(r) {
  const lowMatch = r.match_quality < 0.7;
  return `
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
}

export function renderInspect(u) {
  return `
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
}

export function renderDensity(d) {
  const warn = d.status !== "정상";
  return `
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
}

export function renderDip(r) {
  return `
      <div class="msg ${r.feasible ? "" : "warn"}">
        담금시간 <b>${fmt(r.seconds, 2)}초</b> → 예상 평균 두께 <b>${fmt(r.predicted_mean_mm, 3)}mm</b>
        ${r.feasible ? "" : "<br>" + esc(r.reason)}</div>
      ${annoLine(r.annotation)}`;
}

export function renderGlaze(p) {
  const safe = p.safe_thickness_mm,
    over = p.local_max_mm > safe[1];
  return `
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
}

export function renderLoading(l) {
  return `
      <div class="msg ${l.gross_error ? "warn" : ""}">
        선반 점유율 <b>${fmt(l.packing_ratio * 100, 1)}%</b> ·
        기준 <b>${fmt(l.threshold * 100, 0)}%</b> ·
        ${l.gross_error ? "<b>이상하게 많아요</b>" : "정상 범위예요"}</div>
      ${provBlock("판정 근거", [l.message])}`;
}

export function renderCooling(c, S) {
  return `
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
}

export function renderSimulation(sim) {
  return `
      ${firingSVG(sim)}
      <div class="msg">최고 센서 온도 <b>${fmt(sim.peak_sensor_c, 1)}℃</b> ·
        누적 열일량 <b>${sci(sim.heat_work)}</b>
        <br><span class="subtle">절대적인 값이 아니라 회차끼리 비교할 때 쓰는 값이에요.</span></div>
      <div class="msg na"><b>가정값을 사용한 계산이에요.</b> ${esc(sim.E_note)}</div>
      ${provBlock("제어 판단 근거", [sim.final_decision])}
      ${provBlock("시뮬레이터 근거", sim.provenance_notes)}`;
}

export function renderResult(r) {
  const c = r.calibration;
  return `
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
}

export function renderTiles(r) {
  return `
      <div class="msg">타일 ${r.n_samples}장 · k₁ <b>${fmt(r.k1, 5)}</b> ·
        ρ_dry <b>${r.rho_dry === null ? "없음 (캘리퍼 실측 필요)" : fmt(r.rho_dry, 4)}</b>
        <br>면적당 기울기 ${fmt(r.areal_slope, 2)} · 잔차 RMS ${fmt(r.residual_rms, 4)}</div>

      ${provBlock("근거", r.notes)}`;
}

export function renderIssue(p) {
  return `
      <div class="msg">목표 열일량 <b>${sci(p.heat_work_target)}</b> · 최고온도 <b>${fmt(p.peak_c, 0)}℃</b>
        <br>냉각 ${p.cooling.map((s) => `${fmt(s.from_c, 0)}→${fmt(s.to_c, 0)}℃ @ ${fmt(s.rate_c_per_h, 0)}℃/h${s.purpose ? " (" + esc(s.purpose) + ")" : ""}`).join(" · ") || "없음"}</div>
      <div class="msg na"><b>가정값 E = ${fmt(p.E_assumed / 1000, 0)} kJ/mol을 기준으로 만든 처방이에요.</b>
        다른 가마에서는 결과가 달라질 수 있어요.</div>
      ${provBlock("처방 근거", p.provenance_notes)}`;
}

export function renderExport(st) {
  return `<div class="scroll-x"><pre class="mono" style="font-size:.76rem">${esc(
    JSON.stringify(st, null, 1),
  )}</pre></div>
    <p class="subtle">계산 근거도 함께 저장돼요.</p>`;
}

export function renderCoefficients(c) {
  return `
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
}

export function renderRegistry(S) {
  const rows = S.registry
    .map((c) => {
      const undet = !c.determined;
      const value = undet
        ? `<td class="value-missing">미정 — 값 없음</td>`
        : `<td class="num mono">${esc(c.value)}${
            c.lower !== null && c.upper !== null
              ? ` <span class="subtle">(${c.lower}–${c.upper})</span>`
              : ""
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
  return `
    <div class="scroll-x"><table>
      <thead><tr><th>기호</th><th>정의</th><th>값</th><th>확인 방법</th><th>설명</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

export function renderRisk(r, S) {
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
      </div>`,
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
          </div>`,
            )
            .join("")}
        </div>`
    : `<div class="msg">지금은 특별히 조치할 게 없어요.</div>`;
  const kind =
    r.worst_level >= 3
      ? "danger"
      : r.worst_level >= 2
        ? "warn"
        : r.worst_level < 0
          ? "na"
          : "";
  return `
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
}

export function renderTransform(r) {
  const sched = r.schedule
    ? `<div class="scroll-x"><table><thead><tr><th>t (h)</th><th class="num">온도 ℃</th></tr></thead>
         <tbody>${r.schedule.map((p) => `<tr><td class="mono">${fmt(p.t / 3600, 2)}</td><td class="num mono">${fmt(p.temp_c, 0)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  return `<h4>변환 — ${esc(r.kiln_name)}</h4>
       <div class="msg ${r.feasible ? "" : "warn"}">${
         r.feasible
           ? "이 가마에서 그대로 쓸 수 있는 일정이 나왔어요"
           : "<b>변환할 수 없어요</b>"
       }</div>
       ${sched}
       ${provBlock("변환 근거와 한계", r.reasons)}`;
}

export { esc, fmt, sci, provBlock, errBox, materialsTable };

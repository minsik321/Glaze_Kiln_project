import type { ChangeEvent, ReactNode } from "react";
import type { SimulatorModel } from "./useSimulator";

export function Html({
  id,
  html,
  append,
}: {
  id: string;
  html?: string;
  append?: ReactNode;
}) {
  return (
    <div id={id}>
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : null}
      {append}
    </div>
  );
}

export function StateCell({
  label,
  value,
  blank = "없음",
  na = false,
}: {
  label: string;
  value?: unknown;
  blank?: string;
  na?: boolean;
}) {
  const shown = value ? String(value) : blank;
  return (
    <div
      className={["cell", na ? "na" : "", value ? "" : "empty"]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="k">{label}</div>
      <div className="v">{shown}</div>
    </div>
  );
}

export function Panel({
  model,
  name,
  children,
}: {
  model: SimulatorModel;
  name: string;
  children: ReactNode;
}) {
  return (
    <section
      className="panel"
      id={`panel-${name}`}
      role="tabpanel"
      aria-labelledby={`tab-${name}`}
      hidden={model.tab !== name}
    >
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

export function Action({
  model,
  id,
  children,
  ghost = false,
  small = false,
  disabled = false,
  title,
}: {
  model: SimulatorModel;
  id: string;
  children: ReactNode;
  ghost?: boolean;
  small?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={["act", ghost ? "ghost" : "", small ? "small" : ""]
        .filter(Boolean)
        .join(" ")}
      id={id}
      type="button"
      disabled={disabled || model.busy}
      title={title}
      onClick={model.actions[id]}
    >
      {children}
    </button>
  );
}

export function Field({
  model,
  id,
  label,
  type = "number",
  step,
  min,
  max,
  placeholder,
  disabled = false,
}: {
  model: SimulatorModel;
  id: string;
  label: ReactNode;
  type?: "number" | "text" | "range";
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="f">
      {label}
      <input
        id={id}
        type={type}
        value={model.field(id)}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => model.changeField(id, e.target.value)}
      />
    </label>
  );
}

export function SelectField({
  model,
  id,
  label,
  children,
  disabled = false,
}: {
  model: SimulatorModel;
  id: string;
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="f">
      {label}
      <select
        id={id}
        value={model.field(id)}
        disabled={disabled}
        onChange={(e) => model.changeField(id, e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function CheckField({
  model,
  id,
  children,
}: {
  model: SimulatorModel;
  id: string;
  children: ReactNode;
}) {
  return (
    <label
      className="f"
      style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
    >
      <input
        id={id}
        type="checkbox"
        checked={Boolean(model.fields[id])}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          model.changeField(id, e.target.checked)
        }
      />
      {children}
    </label>
  );
}

export function Output({
  model,
  id,
  append,
}: {
  model: SimulatorModel;
  id: string;
  append?: ReactNode;
}) {
  return <Html id={id} html={model.outputs[id]} append={append} />;
}

export function EControl({ model, id }: { model: SimulatorModel; id: string }) {
  const has = model.session.E !== null;
  return (
    <div id={id}>
      <div className="msg na">
        <b>온도 계산에 쓸 가정값(E)이 아직 없어요.</b> 실제로 확인된 값이 아니라
        가정이라는 점이 결과에 함께 표시됩니다.
      </div>
      <div className="grid">
        <label className="f">
          가정값 (kJ/mol)
          <input
            type="number"
            data-e="input"
            step="10"
            min="50"
            max="900"
            placeholder="미입력"
            value={has ? model.session.E : ""}
            onChange={(e) => model.setE(e.target.value)}
          />
        </label>
        <label className="f">
          슬라이더
          <input
            type="range"
            data-e="range"
            min="100"
            max="800"
            step="10"
            value={has ? model.session.E : 400}
            disabled={!has}
            onChange={(e) => model.setE(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <span className="subtle">자주 쓰는 값:</span>
        {[200, 300, 400, 500, 600].map((value) => (
          <button
            key={value}
            type="button"
            className="act ghost small"
            data-e-pick={value}
            onClick={() => model.setE(value)}
          >
            {value}
          </button>
        ))}
        <span className={`badge ${has ? "accent" : "na"}`}>
          {has
            ? `가정값 사용 중 — ${model.session.E} kJ/mol`
            : "값을 입력해야 다음 단계로 진행할 수 있어요"}
        </span>
      </div>
    </div>
  );
}

import { PY_INIT } from "./python-init";

/** JSON boundary only. All kiln/domain calculations remain in Python. */
export type Data = Record<string, any>;
export type Progress = { message: string; percent: number };
type PythonCall = (name: string, payload: string) => string;
const PYODIDE_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";

async function loadRuntime(
  report: (progress: Progress) => void,
): Promise<PythonCall> {
  report({ message: "필요한 프로그램을 받는 중…", percent: 4 });
  const { loadPyodide } = await import(
    /* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`
  );
  const py = await loadPyodide({ indexURL: PYODIDE_INDEX });
  report({ message: "설정을 불러오는 중…", percent: 38 });
  const manifestURL = new URL(
    `${import.meta.env.BASE_URL}kiln-manifest.json`,
    location.href,
  );
  const response = await fetch(manifestURL, { cache: "no-cache" });
  if (!response.ok)
    throw new Error(`kiln-manifest.json HTTP ${response.status}`);
  const manifest: { root: string; files: string[] } = await response.json();
  let done = 0;
  const files = await Promise.all(
    manifest.files.map(async (relative) => {
      const response = await fetch(
        new URL(`${manifest.root}/${relative}`, manifestURL),
        { cache: "no-cache" },
      );
      if (!response.ok) throw new Error(`${relative} HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      report({
        message: `파일을 받는 중… (${++done}/${manifest.files.length})`,
        percent: 42 + (done / manifest.files.length) * 36,
      });
      return { relative, bytes };
    }),
  );
  for (const { relative, bytes } of files) {
    const path = `/kilnsrc/${relative}`;
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    py.FS.writeFile(path, bytes);
  }
  report({ message: "계산 엔진을 준비하는 중…", percent: 88 });
  py.runPython(PY_INIT);
  return py.globals.get("_call") as PythonCall;
}

/** One runtime and one ordered call queue, including during StrictMode remounts. */
export function createKilnBridge(loader = loadRuntime) {
  let startup: Promise<PythonCall> | undefined;
  let progress: Progress = { message: "시작하는 중…", percent: 0 };
  const listeners = new Set<(progress: Progress) => void>();
  let queue: Promise<unknown> = Promise.resolve();
  const load = () =>
    (startup ??= loader((next) => {
      progress = next;
      listeners.forEach((listener) => listener(next));
    }));
  return {
    subscribe(listener: (progress: Progress) => void) {
      listeners.add(listener);
      listener(progress);
      return () => {
        listeners.delete(listener);
      };
    },
    call<T = Data>(
      name: string,
      args: unknown[] = [],
      kwargs: Data = {},
    ): Promise<T> {
      // Capture arguments now: later form edits cannot alter queued computations.
      const payload = JSON.stringify({ args, kwargs });
      const result = queue.then(async () => {
        const invoke = await load();
        const response = JSON.parse(invoke(name, payload));
        if (!response.ok) throw new Error(response.error || "계산 엔진 오류");
        return response.value as T;
      });
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
export const kilnBridge = createKilnBridge();

let initialization: Promise<Data> | undefined;
export function initializeSimulator() {
  return (initialization ??= (async () => {
    const presets = await kilnBridge.call("presets");
    const registry = await kilnBridge.call<Data[]>("registry");
    const colorants = await kilnBridge.call<Data[]>("color_reference");
    const state = await kilnBridge.call("export_state");
    const target = await kilnBridge.call("set_target", [2, 0]);
    return { presets, registry, colorants, recipes: state.recipes, target };
  })());
}

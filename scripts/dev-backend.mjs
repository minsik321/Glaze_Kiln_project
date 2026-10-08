import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

function pythonCandidates() {
  const candidates = [
    join(root, ".venv", "Scripts", "python.exe"),
    join(root, ".venv", "bin", "python"),
  ];
  const localPrograms = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Python");
  if (localPrograms && existsSync(localPrograms)) {
    for (const directory of readdirSync(localPrograms).sort().reverse()) {
      candidates.push(join(localPrograms, directory, "python.exe"));
    }
  }
  return candidates;
}

const python = pythonCandidates().find(existsSync) ?? (process.platform === "win32" ? "python" : "python3");
const environment = {
  ...process.env,
  PYTHONPATH: [join(root, "src"), process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
};
const child = spawn(python, ["-m", "uvicorn", "backend.app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000"], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`백엔드를 시작하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

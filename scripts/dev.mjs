import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// The recipe workflow cannot create candidates without FastAPI. Keep both
// `npm run dev` and the familiar `npm run dev:frontend` as full-app entrypoints;
// this private UI-only command prevents the launcher from recursing.
const children = ["dev:ui", "dev:backend"].map((script) =>
  spawn(npm, ["run", script], { stdio: "inherit", shell: process.platform === "win32" }),
);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping && code && code !== 0) stop(code);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

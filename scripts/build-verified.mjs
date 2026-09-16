import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("vinext")));
const child = spawn(process.execPath, [cli, "build"], {
  stdio: "inherit",
  env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
});
const timeout = setTimeout(() => {
  console.error("Production build exceeded the three-minute limit.");
  child.kill("SIGKILL");
}, 180_000);
child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  clearTimeout(timeout);
  process.exitCode = code ?? 1;
});

import { resolve } from "node:path";
import { defineConfig } from "vite";
import { createVrLogHandler } from "./prototype-three-presentation/scripts/vr-log-server.mjs";

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const logFilePath = resolve("prototype-three-presentation", ".local", "vr-test-logs", `three-presentation-${timestamp}.jsonl`);

export default defineConfig({
  server: {
    allowedHosts: [".ngrok-free.app"],
  },
  plugins: [{
    name: "vr-test-log-collector",
    configureServer(server) {
      server.middlewares.use(createVrLogHandler(logFilePath));
      console.info(`\n  VR test logs: ${logFilePath}\n`);
    },
  }],
});

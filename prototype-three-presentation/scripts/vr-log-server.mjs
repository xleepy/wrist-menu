import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const VR_LOG_ENDPOINT = "/__vr-test-log";
const MAX_BODY_BYTES = 64 * 1024;

export function createVrLogHandler(logFilePath) {
  let writes = Promise.resolve();

  return async function vrLogHandler(request, response, next) {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== VR_LOG_ENDPOINT) return next();

    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end("Method not allowed");
      return;
    }

    try {
      const chunks = [];
      let bodyBytes = 0;
      for await (const chunk of request) {
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_BODY_BYTES) throw new Error("VR log request is too large");
        chunks.push(chunk);
      }

      const record = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!record || typeof record.type !== "string" || typeof record.sessionId !== "string") {
        throw new Error("Invalid VR log record");
      }

      const line = `${JSON.stringify({ ...record, receivedAt: new Date().toISOString() })}\n`;
      writes = writes.catch(() => undefined).then(async () => {
        await mkdir(dirname(logFilePath), { recursive: true });
        await appendFile(logFilePath, line, "utf8");
      });
      await writes;
      response.statusCode = 202;
      response.end("accepted");
    } catch (error) {
      response.statusCode = error?.message === "VR log request is too large" ? 413 : 400;
      response.end(error instanceof Error ? error.message : "Invalid VR log request");
    }
  };
}

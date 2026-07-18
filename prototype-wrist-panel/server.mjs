// THROWAWAY PROTOTYPE SERVER — intentionally dependency-free and local-only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.WRIST_PROTOTYPE_PORT || 4173);

const files = new Map([
  ["/prototype/wrist-panel", "index.html"],
  ["/prototype/wrist-panel/", "index.html"],
  ["/prototype/wrist-panel/app.js", "app.js"],
  ["/prototype/wrist-panel/styles.css", "styles.css"],
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const filename = files.get(pathname);

  if (!filename) {
    response.writeHead(302, { Location: "/prototype/wrist-panel?variant=A" });
    response.end();
    return;
  }

  const body = await readFile(join(root, filename));
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filename)],
    "Cache-Control": "no-store",
  });
  response.end(body);
}).listen(port, "127.0.0.1", () => {
  console.log(`Wrist-panel prototype: http://localhost:${port}/prototype/wrist-panel?variant=A`);
});

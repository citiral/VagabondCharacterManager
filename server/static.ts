// Files from public/. A request can't climb out of that directory.

import { json } from "./http.ts";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

export async function serveStatic(publicDir: string, pathname: string) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (clean.includes("..") || clean.includes("\\")) return json({ error: "Bad path" }, 400);
  const relative = clean || "index.html";
  const filePath = `${publicDir}/${relative}`;
  try {
    const [root, file] = await Promise.all([Deno.realPath(publicDir), Deno.realPath(filePath)]);
    if (!file.startsWith(root)) return json({ error: "Bad path" }, 400);
    const ext = file.slice(file.lastIndexOf("."));
    const body = await Deno.readFile(file);
    return new Response(body, {
      headers: {
        "content-type": types[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      },
    });
  } catch {
    return json({ error: "Not found" }, 404);
  }
}

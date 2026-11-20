// 웹장기 로컬 확인용 정적 서버. Fairy-Stockfish(여러 스레드 WASM)가 쓰는 SharedArrayBuffer를 열려면
// 페이지가 교차 출처 격리(cross-origin isolated) 상태여야 하므로 COOP/COEP 헤더를 붙여 보낸다.
// 사용: node tools/dev-server.mjs [포트=5188]
// COEP는 credentialless를 쓴다: require-corp는 구글 글꼴 CSS·gtag처럼 CORP 헤더가 없는 외부 자원을 막는다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 5188;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json",
  ".md": "text/markdown", ".txt": "text/plain"
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found: " + rel);
      return;
    }
    res.writeHead(200, {
      "Content-Type": (TYPES[path.extname(file)] || "application/octet-stream") + "; charset=utf-8",
      "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`웹장기 (교차 출처 격리): http://localhost:${PORT}  (${ROOT})`));

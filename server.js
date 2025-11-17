// server.js
import http from "http";
import fs from "fs";
import path from "path";
import { program } from "commander";
// ------------------ CLI аргументи ------------------
program
  .requiredOption("-h, --host <host>", "Server host (обов’язковий параметр)")
  .requiredOption("-p, --port <port>", "Server port (обов’язковий параметр)")
  .requiredOption("-c, --cache <dir>", "Cache directory path (обов’язковий параметр)");

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = Number(options.port);
const CACHE_DIR = options.cache;

// ------------------ Створюємо кеш-директорію ------------------
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`✅ Створено директорію кешу: ${CACHE_DIR}`);
} else {
  console.log(`ℹ️  Використовується існуюча директорія кешу: ${CACHE_DIR}`);
}
import path from "path";

const DATA_DIR = path.join(CACHE_DIR, "data");
const PHOTOS_DIR = path.join(CACHE_DIR, "photos");
const DB_FILE = path.join(DATA_DIR, "inventory.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ lastId: 0, items: [] }, null, 2));
}

// ------------------ HTTP-сервер ------------------
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(`Сервер працює на http://${HOST}:${PORT}\nШлях кешу: ${CACHE_DIR}`);
});

// ------------------ Запуск ------------------
server.listen(PORT, HOST, () => {
  console.log(`🚀 Сервер запущено на http://${HOST}:${PORT}`);
});

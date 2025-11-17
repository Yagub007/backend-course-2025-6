import http from "http";
import fs from "fs/promises";
import path from "path";
import { program } from "commander";
import formidable from "formidable";

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

// ------------------ Асинхронна ініціалізація кешу ------------------
async function ensureCache() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    console.log(`✅ Кеш-директорія готова: ${CACHE_DIR}`);
  } catch (err) {
    console.error("❌ Помилка створення кеш-директорії:", err);
    process.exit(1);
  }

  const DATA_DIR = path.join(CACHE_DIR, "data");
  const PHOTOS_DIR = path.join(CACHE_DIR, "photos");
  const DB_FILE = path.join(DATA_DIR, "inventory.json");

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(PHOTOS_DIR, { recursive: true });

    try {
      await fs.access(DB_FILE); // перевіряємо, чи існує файл
      console.log("ℹ️  Файл бази даних існує.");
    } catch {
      await fs.writeFile(DB_FILE, JSON.stringify({ lastId: 0, items: [] }, null, 2));
      console.log(`📄 Створено нову базу даних: ${DB_FILE}`);
    }

    return { DATA_DIR, PHOTOS_DIR, DB_FILE };
  } catch (err) {
    console.error("❌ Помилка створення структури кешу:", err);
    process.exit(1);
  }
}

// ------------------ Основна функція запуску ------------------
async function startServer() {
  const { DATA_DIR, PHOTOS_DIR, DB_FILE } = await ensureCache();

  const server = http.createServer(async (req, res) => {
    // --- POST /register ---
    if (req.method === "POST" && req.url === "/register") {
      const form = formidable({
        uploadDir: PHOTOS_DIR,
        keepExtensions: true
      });

      form.parse(req, async (err, fields, files) => {
        try {
          if (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Upload error", details: String(err) }));
          }

          // 1️⃣ отримуємо дані з форми
          const name = (fields.inventory_name || "").toString().trim();
          const desc = (fields.description || "").toString().trim();

          // 2️⃣ перевіряємо обов’язкове поле
          if (!name) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "inventory_name is required" }));
          }

          // 3️⃣ читаємо існуючу базу
          const raw = await fs.readFile(DB_FILE, "utf8");
          const db = JSON.parse(raw);

          // 4️⃣ створюємо новий запис
          const id = db.lastId + 1;
          db.lastId = id;

          const fileObj = files.photo && (Array.isArray(files.photo) ? files.photo[0] : files.photo);
          const photoFile = fileObj ? path.basename(fileObj.filepath) : null;

          db.items.push({
            id,
            name,
            description: desc,
            photoFile
          });

          // 5️⃣ зберігаємо оновлену базу
          await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

          // 6️⃣ відправляємо відповідь
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            id,
            name,
            description: desc,
            photo_url: photoFile ? `/inventory/${id}/photo` : null
          }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Server error", details: String(e) }));
        }
      });
      return;
    }
    // ---------- GET /inventory (асинхронно) ----------
    if (req.method === "GET" && req.url === "/inventory") {
    try {
        // 1️⃣ читаємо JSON-файл з базою
        const raw = await fs.readFile(DB_FILE, "utf8");
        const db = JSON.parse(raw);

        // 2️⃣ формуємо список для відповіді
        const list = db.items.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        photo_url: item.photoFile ? `/inventory/${item.id}/photo` : null
        }));

        // 3️⃣ повертаємо JSON
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(list, null, 2));
    } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server error", details: String(err) }));
    }
    return;
    }
    if (req.method === "GET" && req.url.startsWith("/inventory/") && !req.url.endsWith("/photo")) {
        try {
            // 1️⃣ Отримуємо ID з URL
            const parts = req.url.split("/");
            const id = Number(parts[2]); // /inventory/5 → parts[2] = 5

            if (!id) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Invalid ID" }));
            }

            // 2️⃣ Читаємо базу
            const raw = await fs.readFile(DB_FILE, "utf8");
            const db = JSON.parse(raw);

            // 3️⃣ Знаходимо річ
            const item = db.items.find(x => x.id === id);

            if (!item) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Not Found" }));
            }

            // 4️⃣ Формуємо JSON-відповідь
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
            id: item.id,
            name: item.name,
            description: item.description,
            photo_url: item.photoFile ? `/inventory/${item.id}/photo` : null
            }, null, 2));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Server error", details: String(err) }));
        }
        return;
    }

    // --- якщо не /register ---
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      `Сервер працює на http://${HOST}:${PORT}\n` +
      `Кеш: ${CACHE_DIR}\n` +
      `Data: ${DATA_DIR}\n` +
      `Photos: ${PHOTOS_DIR}\n` +
      `DB файл: ${DB_FILE}`
    );
  });

  server.listen(PORT, HOST, () => {
    console.log(`🚀 Сервер запущено на http://${HOST}:${PORT}`);
  });
}

// ------------------ Запуск ------------------
startServer();

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
const PUBLIC_DIR = path.join(process.cwd(), "public");

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
    // ---------- PUT /inventory/:id (асинхронно) ----------
    if (req.method === "PUT" && req.url.startsWith("/inventory/") && !req.url.endsWith("/photo")) {
    try {
        // 1️⃣ Отримуємо ID з URL
        const id = Number(req.url.split("/")[2]);
        if (!id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Invalid ID" }));
        }

        // 2️⃣ Зчитуємо тіло запиту
        let body = "";
        req.on("data", chunk => (body += chunk));
        req.on("end", async () => {
        try {
            // 3️⃣ Парсимо JSON
            const data = JSON.parse(body);
            if (!data.name && !data.description) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Nothing to update" }));
            }

            // 4️⃣ Читаємо базу
            const raw = await fs.readFile(DB_FILE, "utf8");
            const db = JSON.parse(raw);

            // 5️⃣ Знаходимо річ
            const item = db.items.find(x => x.id === id);
            if (!item) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Not Found" }));
            }

            // 6️⃣ Оновлюємо дані
            if (data.name) item.name = data.name;
            if (data.description) item.description = data.description;

            // 7️⃣ Записуємо назад у файл
            await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

            // 8️⃣ Відповідь 200 OK
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(item, null, 2));
        } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON", details: String(err) }));
        }
        });
    } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server error", details: String(err) }));
    }
    return;
    }
    // ---------- GET /inventory/:id/photo (асинхронно) ----------
if (req.method === "GET" && req.url.startsWith("/inventory/") && req.url.endsWith("/photo")) {
  try {
    // 1️⃣ Отримуємо ID з URL
    const id = Number(req.url.split("/")[2]);
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid ID" }));
    }

    // 2️⃣ Читаємо базу
    const raw = await fs.readFile(DB_FILE, "utf8");
    const db = JSON.parse(raw);

    // 3️⃣ Знаходимо потрібну річ
    const item = db.items.find(x => x.id === id);
    if (!item || !item.photoFile) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Photo not found" }));
    }

    // 4️⃣ Формуємо шлях до фото
    const filePath = path.join(PHOTOS_DIR, item.photoFile);

    // 5️⃣ Перевіряємо чи файл існує
    try {
      await fs.access(filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "File missing on disk" }));
    }

    // 6️⃣ Визначаємо тип контенту (розширення файлу)
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
        ? "image/webp"
        : "image/jpeg"; // за замовчуванням

    // 7️⃣ Повертаємо фото як потік
    res.writeHead(200, { "Content-Type": mime });
    const stream = (await fs.open(filePath)).createReadStream();
    stream.pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server error", details: String(err) }));
  }
  return;
}
// ---------- PUT /inventory/:id/photo (асинхронно) ----------
if (req.method === "PUT" && req.url.startsWith("/inventory/") && req.url.endsWith("/photo")) {
  try {
    // 1️⃣ Отримуємо ID
    const id = Number(req.url.split("/")[2]);
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
      return res.end(JSON.stringify({ error: "Item not found" }));
    }

    // 4️⃣ Готуємо форму для нового фото
    await fs.mkdir(PHOTOS_DIR, { recursive: true });
    const form = formidable({
      uploadDir: PHOTOS_DIR,
      keepExtensions: true,
      multiples: false
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Upload error", details: String(err) }));
      }

      // 5️⃣ Отримуємо новий файл
      const fileObj = files.photo && (Array.isArray(files.photo) ? files.photo[0] : files.photo);
      if (!fileObj || !fileObj.filepath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "No photo provided" }));
      }

      // 6️⃣ Якщо старе фото існує — видаляємо його
      if (item.photoFile) {
        const oldPath = path.join(PHOTOS_DIR, item.photoFile);
        try {
          await fs.unlink(oldPath);
          console.log(`🧹 Старе фото видалено: ${oldPath}`);
        } catch {
          console.warn("⚠️  Старе фото не знайдено на диску, пропускаємо");
        }
      }

      // 7️⃣ Зберігаємо новий файл у БД
      const newFile = path.basename(fileObj.filepath);
      item.photoFile = newFile;
      await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

      // 8️⃣ Відповідь 200 OK
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: item.id,
        name: item.name,
        description: item.description,
        photo_url: `/inventory/${item.id}/photo`
      }, null, 2));
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server error", details: String(err) }));
  }
  return;
}
// ---------- DELETE /inventory/:id (асинхронно) ----------
if (req.method === "DELETE" && req.url.startsWith("/inventory/")) {
  try {
    // 1️⃣ Отримуємо ID
    const id = Number(req.url.split("/")[2]);
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid ID" }));
    }

    // 2️⃣ Читаємо базу
    const raw = await fs.readFile(DB_FILE, "utf8");
    const db = JSON.parse(raw);

    // 3️⃣ Знаходимо індекс елемента
    const idx = db.items.findIndex(x => x.id === id);
    if (idx === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Item not found" }));
    }

    // 4️⃣ Отримуємо елемент і видаляємо з масиву
    const [item] = db.items.splice(idx, 1);

    // 5️⃣ Якщо фото існує — видаляємо файл
    if (item.photoFile) {
      const filePath = path.join(PHOTOS_DIR, item.photoFile);
      try {
        await fs.unlink(filePath);
        console.log(`🧹 Фото видалено: ${filePath}`);
      } catch {
        console.warn("⚠️  Фото не знайдено на диску, пропускаємо");
      }
    }

    // 6️⃣ Записуємо оновлену базу
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

    // 7️⃣ Повертаємо результат
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted_id: id }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server error", details: String(err) }));
  }
  return;
}

if (req.method === "GET" && req.url === "/RegisterForm.html") {
  try {
    const html = await fs.readFile(path.join(PUBLIC_DIR, "RegisterForm.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Файл не знайдено");
  }
  return;
}

// ---------- GET /SearchForm.html ----------
if (req.method === "GET" && req.url === "/SearchForm.html") {
  try {
    const html = await fs.readFile(path.join(PUBLIC_DIR, "SearchForm.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Файл не знайдено");
  }
  return;
}
if (req.method === "POST" && req.url === "/search") {
  let body = "";

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", async () => {
    const params = new URLSearchParams(body);

    const id = Number(params.get("id"));
    const hasPhoto = params.get("has_photo") !== null;

    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid ID" }));
    }

    try {
      const dbRaw = await fs.readFile(DB_FILE, "utf8");
      const db = JSON.parse(dbRaw);

      const item = db.items.find(x => x.id === id);

      if (!item) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Not Found" }));
      }

      // Додаємо посилання на фото (тільки якщо прапорець активний)
      if (hasPhoto && item.photoFile && !item.description.includes("/photo")) {
        item.description += ` [Фото: /inventory/${item.id}/photo]`;
        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(item));

    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Server error", details: e.toString() }));
    }
  });

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

import http from "http";
import fs from "fs/promises";
import path from "path";
import { program } from "commander";
import formidable from "formidable";

// ------------------ CLI аргументи ------------------
program
  .requiredOption("-h, --host <host>", "Server host (обов'язковий параметр)")
  .requiredOption("-p, --port <port>", "Server port (обов'язковий параметр)")
  .requiredOption("-c, --cache <dir>", "Cache directory path (обов'язковий параметр)");

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
      await fs.access(DB_FILE);
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

    // ============================================================
    //                    POST /register
    // ============================================================
    /**
     * @swagger
     * /register:
     *   post:
     *     summary: Реєстрація нової речі
     *     description: Приймає multipart/form-data з назвою речі, описом та фото.
     *     consumes:
     *       - multipart/form-data
     *     parameters:
     *       - in: formData
     *         name: inventory_name
     *         type: string
     *         required: true
     *         description: Назва інвентарної речі
     *       - in: formData
     *         name: description
     *         type: string
     *         description: Опис речі
     *       - in: formData
     *         name: photo
     *         type: file
     *         description: Фото речі
     *     responses:
     *       201:
     *         description: Річ успішно створено
     *         schema:
     *           type: object
     *           properties:
     *             id:
     *               type: integer
     *             name:
     *               type: string
     *             description:
     *               type: string
     *             photo_url:
     *               type: string
     *       400:
     *         description: Некоректні дані (відсутня назва)
     *       500:
     *         description: Помилка сервера
     */
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

          const name = (fields.inventory_name || "").toString().trim();
          const desc = (fields.description || "").toString().trim();

          if (!name) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "inventory_name is required" }));
          }

          const raw = await fs.readFile(DB_FILE, "utf8");
          const db = JSON.parse(raw);

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

          await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

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

    // ============================================================
    //                    GET /inventory
    // ============================================================
    /**
     * @swagger
     * /inventory:
     *   get:
     *     summary: Отримати список усієї інвентаризації
     *     description: Повертає масив усіх зареєстрованих речей
     *     responses:
     *       200:
     *         description: Успішна відповідь зі списком речей
     *         schema:
     *           type: array
     *           items:
     *             type: object
     *             properties:
     *               id:
     *                 type: integer
     *               name:
     *                 type: string
     *               description:
     *                 type: string
     *               photo_url:
     *                 type: string
     *       500:
     *         description: Помилка сервера
     */
    if (req.method === "GET" && req.url === "/inventory") {
      try {
        const raw = await fs.readFile(DB_FILE, "utf8");
        const db = JSON.parse(raw);

        const list = db.items.map(item => ({
          id: item.id,
          name: item.name,
          description: item.description,
          photo_url: item.photoFile ? `/inventory/${item.id}/photo` : null
        }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(list, null, 2));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server error", details: String(err) }));
      }
      return;
    }

    // ============================================================
    //          GET /inventory/:id   (без /photo)
    // ============================================================
    /**
     * @swagger
     * /inventory/{id}:
     *   get:
     *     summary: Отримати річ за ID
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         type: integer
     *         description: ID інвентарної речі
     *     responses:
     *       200:
     *         description: Річ знайдено
     *         schema:
     *           type: object
     *           properties:
     *             id:
     *               type: integer
     *             name:
     *               type: string
     *             description:
     *               type: string
     *             photo_url:
     *               type: string
     *       400:
     *         description: Некоректний ID
     *       404:
     *         description: Річ не існує
     *       500:
     *         description: Помилка сервера
     */
    if (req.method === "GET" && req.url.startsWith("/inventory/") && !req.url.endsWith("/photo")) {
      try {
        const id = Number(req.url.split("/")[2]);

        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid ID" }));
        }

        const raw = await fs.readFile(DB_FILE, "utf8");
        const db = JSON.parse(raw);

        const item = db.items.find(x => x.id === id);

        if (!item) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Not Found" }));
        }

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

    // ============================================================
    //                   PUT /inventory/:id
    // ============================================================
    /**
     * @swagger
     * /inventory/{id}:
     *   put:
     *     summary: Оновити імʼя або опис речі
     *     parameters:
     *       - in: path
     *         name: id
     *         type: integer
     *         required: true
     *         description: ID інвентарної речі
     *       - in: body
     *         name: data
     *         required: true
     *         schema:
     *           type: object
     *           properties:
     *             name:
     *               type: string
     *               description: Нова назва речі
     *             description:
     *               type: string
     *               description: Новий опис речі
     *     responses:
     *       200:
     *         description: Річ успішно оновлено
     *       400:
     *         description: Некоректний JSON або немає даних для оновлення
     *       404:
     *         description: Річ не знайдено
     *       500:
     *         description: Помилка сервера
     */
    if (req.method === "PUT" && req.url.startsWith("/inventory/") && !req.url.endsWith("/photo")) {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", async () => {
        try {
          const id = Number(req.url.split("/")[2]);
          if (!id) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Invalid ID" }));
          }

          const data = JSON.parse(body);
          if (!data.name && !data.description) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Nothing to update" }));
          }

          const raw = await fs.readFile(DB_FILE, "utf8");
          const db = JSON.parse(raw);

          const item = db.items.find(x => x.id === id);
          if (!item) {
            res.writeHead(404, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Not Found" }));
          }

          if (data.name) item.name = data.name;
          if (data.description) item.description = data.description;

          await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(item, null, 2));

        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON", details: String(err) }));
        }
      });
      return;
    }

    // ============================================================
    //              GET /inventory/:id/photo
    // ============================================================
    /**
     * @swagger
     * /inventory/{id}/photo:
     *   get:
     *     summary: Отримати фото речі
     *     produces:
     *       - image/jpeg
     *       - image/png
     *       - image/webp
     *     parameters:
     *       - in: path
     *         name: id
     *         type: integer
     *         required: true
     *         description: ID інвентарної речі
     *     responses:
     *       200:
     *         description: Фото повернуто у відповідному форматі
     *       400:
     *         description: Некоректний ID
     *       404:
     *         description: Фото не знайдено
     *       500:
     *         description: Помилка сервера
     */
    if (req.method === "GET" && req.url.startsWith("/inventory/") && req.url.endsWith("/photo")) {
      try {
        const id = Number(req.url.split("/")[2]);
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid ID" }));
        }

        const raw = await fs.readFile(DB_FILE, "utf8");
        const db = JSON.parse(raw);

        const item = db.items.find(x => x.id === id);
        if (!item || !item.photoFile) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Photo not found" }));
        }

        const filePath = path.join(PHOTOS_DIR, item.photoFile);

        try {
          await fs.access(filePath);
        } catch {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "File missing on disk" }));
        }

        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === ".png" ? "image/png" :
          ext === ".webp" ? "image/webp" :
          "image/jpeg";

        res.writeHead(200, { "Content-Type": mime });
        const stream = (await fs.open(filePath)).createReadStream();
        stream.pipe(res);

      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server error", details: String(err) }));
      }
      return;
    }

    // ============================================================
    //               PUT /inventory/:id/photo
    // ============================================================
    /**
     * @swagger
     * /inventory/{id}/photo:
     *   put:
     *     summary: Оновити фото інвентарної речі
     *     description: Замінює існуюче фото на нове
     *     consumes:
     *       - multipart/form-data
     *     parameters:
     *       - in: path
     *         name: id
     *         type: integer
     *         required: true
     *         description: ID інвентарної речі
     *       - in: formData
     *         name: photo
     *         type: file
     *         required: true
     *         description: Нове фото речі
     *     responses:
     *       200:
     *         description: Фото успішно оновлено
     *       400:
     *         description: Некоректний ID або відсутнє фото
     *       404:
     *         description: Річ не знайдено
     *       500:
     *         description: Помилка сервера
     */
    if (req.method === "PUT" && req.url.startsWith("/inventory/") && req.url.endsWith("/photo")) {
      try {
        const id = Number(req.url.split("/")[2]);
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid ID" }));
        }

        const raw = await fs.readFile(DB_FILE, "utf8");
        const db = JSON.parse(raw);

        const item = db.items.find(x => x.id === id);
        if (!item) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Item not found" }));
        }

        await fs.mkdir(PHOTOS_DIR, { recursive: true });
        const form = formidable({
          uploadDir: PHOTOS_DIR,
          keepExtensions: true
        });

        form.parse(req, async (err, fields, files) => {
          if (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Upload error", details: String(err) }));
          }

          const fileObj = files.photo && (Array.isArray(files.photo) ? files.photo[0] : files.photo);
          if (!fileObj || !fileObj.filepath) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "No photo provided" }));
          }

          if (item.photoFile) {
            const oldPath = path.join(PHOTOS_DIR, item.photoFile);
            try {
              await fs.unlink(oldPath);
            } catch {}
          }

          const newFile = path.basename(fileObj.filepath);
          item.photoFile = newFile;

          await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

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

    // ============================================================
    //                DELETE /inventory/:id
    // ============================================================
    /**
     * @swagger
     * /inventory/{id}:
     *   delete:
     *     summary: Видалити річ
     *     description: Видаляє річ та пов'язане з нею фото (якщо існує)
     *     parameters:
     *       - in: path
     *         name: id
     *         type: integer
     *         required: true
     *         description: ID інвентарної речі
     *     responses:
     *       200:
     *         description: Річ успішно видалено
     *         schema:
     *           type: object
     *           properties:
     *             ok:
     *               type: boolean
     *             deleted_id:
     *               type: integer
     *       400:
     *         description: Некоректний ID
     *       404:
     *         description: Річ не знайдена
     *       500:
     *         description: Помилка сервера
     */
    if (req.method === "DELETE" && req.url.startsWith("/inventory/")) {
      try {
        const id = Number(req.url.split("/")[2]);
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Invalid ID" }));
        }

        const raw = await fs.readFile(DB_FILE, "utf8");
        const db = JSON.parse(raw);

        const idx = db.items.findIndex(x => x.id === id);
        if (idx === -1) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Item not found" }));
        }

        const [item] = db.items.splice(idx, 1);

        if (item.photoFile) {
          const filePath = path.join(PHOTOS_DIR, item.photoFile);
          try {
            await fs.unlink(filePath);
          } catch {}
        }

        await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, deleted_id: id }));

      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server error", details: String(err) }));
      }
      return;
    }

    // ============================================================
    //             GET HTML FORMS
    // ============================================================
    /**
     * @swagger
     * /RegisterForm.html:
     *   get:
     *     summary: Отримати HTML форму для реєстрації
     *     produces:
     *       - text/html
     *     responses:
     *       200:
     *         description: HTML форма повернута успішно
     *       404:
     *         description: Файл не знайдено
     */
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

    /**
     * @swagger
     * /SearchForm.html:
     *   get:
     *     summary: Отримати HTML форму для пошуку
     *     produces:
     *       - text/html
     *     responses:
     *       200:
     *         description: HTML форма повернута успішно
     *       404:
     *         description: Файл не знайдено
     */
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

    // ============================================================
    //                    SWAGGER DOCS
    // ============================================================
    /**
     * @swagger
     * /docs:
     *   get:
     *     summary: Перенаправлення на Swagger UI
     *     responses:
     *       302:
     *         description: Перенаправлення на /docs/ui
     */
    if (req.method === "GET" && req.url === "/docs") {
      res.writeHead(302, { Location: "/docs/ui" });
      return res.end();
    }

    /**
     * @swagger
     * /docs/swagger.json:
     *   get:
     *     summary: Отримати Swagger специфікацію у форматі JSON
     *     produces:
     *       - application/json
     *     responses:
     *       200:
     *         description: Swagger специфікація повернута успішно
     *       500:
     *         description: Файл не знайдено
     */
    if (req.method === "GET" && req.url === "/docs/swagger.json") {
      try {
        const json = await fs.readFile(path.join(PUBLIC_DIR, "swagger.json"), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(json);
      } catch (err) {
        res.writeHead(500);
        return res.end("Swagger file missing");
      }
    }

    /**
     * @swagger
     * /docs/ui:
     *   get:
     *     summary: Отримати Swagger UI
     *     produces:
     *       - text/html
     *     responses:
     *       200:
     *         description: Swagger UI повернуто успішно
     *       404:
     *         description: Файл не знайдено
     */
    if (req.method === "GET" && req.url === "/docs/ui") {
      try {
        const html = await fs.readFile(path.join(PUBLIC_DIR, "swagger.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(html);
      } catch {
        res.writeHead(404);
        return res.end("Swagger UI not found");
      }
    }

    // ============================================================
    //                     POST /search
    // ============================================================
    /**
     * @swagger
     * /search:
     *   post:
     *     summary: Пошук речі за ID (форма x-www-form-urlencoded)
     *     description: Шукає річ за ID та може додати посилання на фото до опису
     *     consumes:
     *       - application/x-www-form-urlencoded
     *     parameters:
     *       - name: id
     *         in: formData
     *         type: integer
     *         required: true
     *         description: ID інвентарної речі
     *       - name: has_photo
     *         in: formData
     *         type: boolean
     *         description: Додати посилання на фото до опису
     *     responses:
     *       200:
     *         description: Результат пошуку
     *         schema:
     *           type: object
     *           properties:
     *             id:
     *               type: integer
     *             name:
     *               type: string
     *             description:
     *               type: string
     *             photoFile:
     *               type: string
     *       400:
     *         description: Некоректний ID
     *       404:
     *         description: Річ не існує
     *       500:
     *         description: Помилка сервера
     */
    if (req.method === "POST" && req.url === "/search") {
      let body = "";

      req.on("data", chunk => (body += chunk));
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

          if (hasPhoto && item.photoFile && !item.description.includes("/photo")) {
            item.description += ` [Фото: /inventory/${item.id}/photo]`;
            await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(item));

        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Server error", details: e.toString() }));
        }
      });

      return;
    }

    // ============================================================
    //                     FALLBACK (останній!)
    // ============================================================
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
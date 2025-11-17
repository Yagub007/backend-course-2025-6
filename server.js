import express from "express";
import fs from "fs/promises";
import path from "path";
import { program } from "commander";
import formidable from "formidable";

program.requiredOption("-h, --host <host>").requiredOption("-p, --port <port>").requiredOption("-c, --cache <dir>").parse();
const { host: HOST, port: PORT, cache: CACHE_DIR } = program.opts();
const PUBLIC = path.join(process.cwd(), "public");

const initCache = async () => {
  const DATA = path.join(CACHE_DIR, "data"), PHOTOS = path.join(CACHE_DIR, "photos"), DB = path.join(DATA, "inventory.json");
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(PHOTOS, { recursive: true });
  try { await fs.access(DB); } catch { await fs.writeFile(DB, JSON.stringify({ lastId: 0, items: [] })); }
  return { PHOTOS, DB };
};

const db = { read: async (f) => JSON.parse(await fs.readFile(f, "utf8")), write: (f, d) => fs.writeFile(f, JSON.stringify(d, null, 2)) };
const item2res = (i) => ({ id: i.id, name: i.name, description: i.description, photo_url: i.photoFile ? `/inventory/${i.id}/photo` : null });

(async () => {
  const { PHOTOS, DB } = await initCache();
  const app = express();

  app.post("/register", (req, res) => {
    formidable({ uploadDir: PHOTOS, keepExtensions: true }).parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: "Upload error" });
      const name = (fields.inventory_name || "").toString().trim();
      if (!name) return res.status(400).json({ error: "inventory_name required" });
      const d = await db.read(DB), id = ++d.lastId, f = files.photo?.[0] || files.photo;
      d.items.push({ id, name, description: (fields.description || "").toString().trim(), photoFile: f ? path.basename(f.filepath) : null });
      await db.write(DB, d);
      res.status(201).json(item2res(d.items[d.items.length - 1]));
    });
  });

  app.get("/inventory", async (req, res) => res.json((await db.read(DB)).items.map(item2res)));

  app.get("/inventory/:id", async (req, res) => {
    const d = await db.read(DB), item = d.items.find(x => x.id === Number(req.params.id));
    item ? res.json(item2res(item)) : res.status(404).json({ error: "Not Found" });
  });

  app.put("/inventory/:id", express.json(), async (req, res) => {
    const d = await db.read(DB), item = d.items.find(x => x.id === Number(req.params.id));
    if (!item) return res.status(404).json({ error: "Not Found" });
    if (req.body.name) item.name = req.body.name;
    if (req.body.description) item.description = req.body.description;
    await db.write(DB, d);
    res.json(item);
  });

  app.get("/inventory/:id/photo", async (req, res) => {
    const d = await db.read(DB), item = d.items.find(x => x.id === Number(req.params.id));
    if (!item?.photoFile) return res.status(404).json({ error: "Photo not found" });
    const fp = path.join(PHOTOS, item.photoFile), ext = path.extname(fp).toLowerCase();
    try { await fs.access(fp); } catch { return res.status(404).json({ error: "File missing" }); }
    res.type(ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg");
    (await fs.open(fp)).createReadStream().pipe(res);
  });

  app.put("/inventory/:id/photo", (req, res) => {
    formidable({ uploadDir: PHOTOS, keepExtensions: true }).parse(req, async (err, _, files) => {
      if (err) return res.status(500).json({ error: "Upload error" });
      const d = await db.read(DB), item = d.items.find(x => x.id === Number(req.params.id));
      if (!item) return res.status(404).json({ error: "Item not found" });
      const f = files.photo?.[0] || files.photo;
      if (!f) return res.status(400).json({ error: "No photo" });
      if (item.photoFile) try { await fs.unlink(path.join(PHOTOS, item.photoFile)); } catch {}
      item.photoFile = path.basename(f.filepath);
      await db.write(DB, d);
      res.json(item2res(item));
    });
  });

  app.delete("/inventory/:id", async (req, res) => {
    const d = await db.read(DB), idx = d.items.findIndex(x => x.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    const [item] = d.items.splice(idx, 1);
    if (item.photoFile) try { await fs.unlink(path.join(PHOTOS, item.photoFile)); } catch {}
    await db.write(DB, d);
    res.json({ ok: true, deleted_id: Number(req.params.id) });
  });

  app.get(["/RegisterForm.html", "/SearchForm.html"], async (req, res) => {
    try { res.sendFile(path.join(PUBLIC, req.url.slice(1))); }
    catch { res.status(404).send("Not found"); }
  });

  app.get("/docs", (req, res) => res.redirect("/docs/ui"));
  app.get("/docs/swagger.json", (req, res) => res.sendFile(path.join(PUBLIC, "swagger.json"), err => err && res.status(500).send("Missing")));
  app.get("/docs/ui", (req, res) => res.sendFile(path.join(PUBLIC, "swagger.html"), err => err && res.status(404).send("Not found")));

  app.post("/search", express.urlencoded({ extended: true }), async (req, res) => {
    const id = Number(req.body.id), hasPhoto = req.body.has_photo !== undefined;
    if (!id) return res.status(400).json({ error: "Invalid ID" });
    const d = await db.read(DB), item = d.items.find(x => x.id === id);
    if (!item) return res.status(404).json({ error: "Not Found" });
    if (hasPhoto && item.photoFile && !item.description.includes("/photo")) {
      item.description += ` [Фото: /inventory/${item.id}/photo]`;
      await db.write(DB, d);
    }
    res.json(item);
  });

  app.get("/", (req, res) => res.send(`Server: http://${HOST}:${PORT}\nCache: ${CACHE_DIR}`));

  app.listen(PORT, HOST, () => console.log(`🚀 http://${HOST}:${PORT}`));
})();
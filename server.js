import http from "http";
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
  return { DATA, PHOTOS, DB };
};

const db = { read: async (f) => JSON.parse(await fs.readFile(f, "utf8")), write: (f, d) => fs.writeFile(f, JSON.stringify(d, null, 2)) };
const json = (res, code, data) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data, null, 2)); };
const item2res = (i) => ({ id: i.id, name: i.name, description: i.description, photo_url: i.photoFile ? `/inventory/${i.id}/photo` : null });

(async () => {
  const { PHOTOS, DB } = await initCache();
  
  http.createServer(async (req, res) => {
    const [_, seg1, seg2, seg3] = req.url.split("/");
    
    if (req.method === "POST" && req.url === "/register") {
      formidable({ uploadDir: PHOTOS, keepExtensions: true }).parse(req, async (err, fields, files) => {
        if (err) return json(res, 500, { error: "Upload error" });
        const name = (fields.inventory_name || "").toString().trim();
        if (!name) return json(res, 400, { error: "inventory_name required" });
        const d = await db.read(DB), id = ++d.lastId, f = files.photo?.[0] || files.photo;
        d.items.push({ id, name, description: (fields.description || "").toString().trim(), photoFile: f ? path.basename(f.filepath) : null });
        await db.write(DB, d);
        json(res, 201, item2res(d.items[d.items.length - 1]));
      });
      return;
    }
    
    if (req.method === "GET" && req.url === "/inventory") return json(res, 200, (await db.read(DB)).items.map(item2res));
    
    if (req.method === "GET" && seg1 === "inventory" && seg2 && !seg3) {
      const id = Number(seg2), d = await db.read(DB), item = d.items.find(x => x.id === id);
      return item ? json(res, 200, item2res(item)) : json(res, 404, { error: "Not Found" });
    }
    
    if (req.method === "PUT" && seg1 === "inventory" && seg2 && !seg3) {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", async () => {
        const id = Number(seg2), data = JSON.parse(body), d = await db.read(DB), item = d.items.find(x => x.id === id);
        if (!item) return json(res, 404, { error: "Not Found" });
        if (data.name) item.name = data.name;
        if (data.description) item.description = data.description;
        await db.write(DB, d);
        json(res, 200, item);
      });
      return;
    }
    
    if (req.method === "GET" && seg1 === "inventory" && seg3 === "photo") {
      const id = Number(seg2), d = await db.read(DB), item = d.items.find(x => x.id === id);
      if (!item?.photoFile) return json(res, 404, { error: "Photo not found" });
      const fp = path.join(PHOTOS, item.photoFile), ext = path.extname(fp).toLowerCase();
      try { await fs.access(fp); } catch { return json(res, 404, { error: "File missing" }); }
      res.writeHead(200, { "Content-Type": ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg" });
      return (await fs.open(fp)).createReadStream().pipe(res);
    }
    
    if (req.method === "PUT" && seg1 === "inventory" && seg3 === "photo") {
      const id = Number(seg2), d = await db.read(DB), item = d.items.find(x => x.id === id);
      if (!item) return json(res, 404, { error: "Item not found" });
      formidable({ uploadDir: PHOTOS, keepExtensions: true }).parse(req, async (err, _, files) => {
        if (err) return json(res, 500, { error: "Upload error" });
        const f = files.photo?.[0] || files.photo;
        if (!f) return json(res, 400, { error: "No photo" });
        if (item.photoFile) try { await fs.unlink(path.join(PHOTOS, item.photoFile)); } catch {}
        item.photoFile = path.basename(f.filepath);
        await db.write(DB, d);
        json(res, 200, item2res(item));
      });
      return;
    }
    
    if (req.method === "DELETE" && seg1 === "inventory" && seg2 && !seg3) {
      const id = Number(seg2), d = await db.read(DB), idx = d.items.findIndex(x => x.id === id);
      if (idx === -1) return json(res, 404, { error: "Not found" });
      const [item] = d.items.splice(idx, 1);
      if (item.photoFile) try { await fs.unlink(path.join(PHOTOS, item.photoFile)); } catch {}
      await db.write(DB, d);
      return json(res, 200, { ok: true, deleted_id: id });
    }
    
    if (req.method === "GET" && (req.url === "/RegisterForm.html" || req.url === "/SearchForm.html")) {
      try {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(await fs.readFile(path.join(PUBLIC, req.url.slice(1))));
      } catch { res.writeHead(404); return res.end("Not found"); }
    }
    
    if (req.method === "GET" && req.url === "/docs") { res.writeHead(302, { Location: "/docs/ui" }); return res.end(); }
    if (req.method === "GET" && req.url === "/docs/swagger.json") {
      try { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(await fs.readFile(path.join(PUBLIC, "swagger.json"))); }
      catch { res.writeHead(500); return res.end("Missing"); }
    }
    if (req.method === "GET" && req.url === "/docs/ui") {
      try { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(await fs.readFile(path.join(PUBLIC, "swagger.html"))); }
      catch { res.writeHead(404); return res.end("Not found"); }
    }
    
    if (req.method === "POST" && req.url === "/search") {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", async () => {
        const p = new URLSearchParams(body), id = Number(p.get("id")), hasPhoto = p.get("has_photo") !== null;
        if (!id) return json(res, 400, { error: "Invalid ID" });
        const d = await db.read(DB), item = d.items.find(x => x.id === id);
        if (!item) return json(res, 404, { error: "Not Found" });
        if (hasPhoto && item.photoFile && !item.description.includes("/photo")) {
          item.description += ` [Фото: /inventory/${item.id}/photo]`;
          await db.write(DB, d);
        }
        json(res, 200, item);
      });
      return;
    }
    
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Server: http://${HOST}:${PORT}\nCache: ${CACHE_DIR}`);
  }).listen(PORT, HOST, () => console.log(`🚀 http://${HOST}:${PORT}`));
})();
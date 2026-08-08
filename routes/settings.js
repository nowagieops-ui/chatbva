const express = require("express");
const { v4: uuid } = require("uuid");
const { query, run } = require("../db");
const router = express.Router();

async function getSetting(key) {
  const rows = await query("SELECT value FROM settings WHERE `key`=?", [key]);
  return rows.length ? JSON.parse(rows[0].value) : null;
}
async function setSetting(key, value) {
  await run("INSERT INTO settings (`key`,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
    [key, JSON.stringify(value)]);
}

router.get("/", async (req, res) => {
  const [vault, owner, escalate, windows] = await Promise.all([
    getSetting("vault"),
    getSetting("owner"),
    getSetting("escalate"),
    query("SELECT * FROM windows ORDER BY date, start"),
  ]);
  res.json({ vault, owner: owner||"", escalate: escalate||"", windows });
});

router.post("/vault", async (req, res) => {
  const { vault } = req.body;
  if (!vault?.pub || !vault?.salt || !vault?.iv || !vault?.priv)
    return res.status(400).json({ error: "Incomplete vault." });
  await setSetting("vault", vault);
  res.json({ ok: true });
});

router.patch("/", async (req, res) => {
  const { owner, escalate } = req.body;
  if (owner    !== undefined) await setSetting("owner",    owner);
  if (escalate !== undefined) await setSetting("escalate", escalate);
  res.json({ ok: true });
});

router.delete("/vault", async (req, res) => {
  await run("DELETE FROM settings WHERE `key`='vault'");
  await run("DELETE FROM feedback");
  res.json({ ok: true });
});

router.post("/windows", async (req, res) => {
  const { date, start, end } = req.body;
  if (!date || !start || !end) return res.status(400).json({ error: "date, start, end required." });
  const id = "w" + uuid().replace(/-/g,"");
  await run("INSERT INTO windows (id,date,start,end) VALUES (?,?,?,?)", [id, date, start, end]);
  res.json({ ok: true, id });
});

router.delete("/windows/:id", async (req, res) => {
  await run("DELETE FROM windows WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.delete("/windows", async (req, res) => {
  const today = new Date().toISOString().slice(0,10);
  await run("DELETE FROM windows WHERE date>=?", [today]);
  res.json({ ok: true });
});

// POST /api/settings/pin  – verify manager PIN
router.post("/pin", (req, res) => {
  const { pin } = req.body;
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(pin||"").digest("hex");
  const correct = process.env.MANAGER_PIN
    ? crypto.createHash("sha256").update(process.env.MANAGER_PIN).digest("hex")
    : "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
  if (hash !== correct) return res.status(403).json({ error: "Wrong PIN." });
  res.json({ ok: true });
});

module.exports = router;

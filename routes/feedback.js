const express = require("express");
const { v4: uuid } = require("uuid");
const { query, run } = require("../db");
const { sendManagerAlert } = require("../mailer");
const router = express.Router();

router.post("/", async (req, res) => {
  const { kind, code, day, enc } = req.body;
  if (!kind || !code || !day || !enc?.k || !enc?.iv || !enc?.c)
    return res.status(400).json({ error: "Invalid payload." });
  const allowed = ["Opinion","Request","Suggestion","Report"];
  if (!allowed.includes(kind)) return res.status(400).json({ error: "Unknown kind." });
  const id = "f" + uuid().replace(/-/g,"");
  await run(
    "INSERT INTO feedback (id,kind,code,day,ts,status,enc_k,enc_iv,enc_c) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, kind, code, day, Date.now(), "new", enc.k, enc.iv, enc.c]
  );
  sendManagerAlert(`New ${kind} on the Open Line`,
    `<p>A new <b>${kind}</b> was submitted on ${day}. Reference: <b>${code}</b>.</p><p>Open the Manager tab to read it.</p>`);
  res.json({ ok: true, id });
});

router.get("/", async (req, res) => {
  const rows = await query("SELECT * FROM feedback ORDER BY ts DESC");
  res.json(rows.map(r => ({
    id: r.id, kind: r.kind, code: r.code,
    day: r.day, ts: r.ts, status: r.status,
    enc: { k: r.enc_k, iv: r.enc_iv, c: r.enc_c }
  })));
});

router.patch("/:id", async (req, res) => {
  const { action } = req.body;
  if (action === "read") {
    await run("UPDATE feedback SET status='read' WHERE id=?", [req.params.id]);
  } else if (action === "delete") {
    await run("DELETE FROM feedback WHERE id=?", [req.params.id]);
  } else return res.status(400).json({ error: "Unknown action." });
  res.json({ ok: true });
});

module.exports = router;

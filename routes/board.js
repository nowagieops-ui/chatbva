const express = require("express");
const { v4: uuid } = require("uuid");
const { query, run } = require("../db");
const router = express.Router();

router.get("/", async (req, res) => {
  res.json(await query("SELECT * FROM board ORDER BY ts DESC"));
});

router.post("/", async (req, res) => {
  const { code, kind, topic, reply } = req.body;
  if (!reply?.trim()) return res.status(400).json({ error: "Reply text required." });
  const id = "b" + uuid().replace(/-/g,"");
  await run("INSERT INTO board (id,code,kind,topic,reply,ts) VALUES (?,?,?,?,?,?)",
    [id, code||"", kind||"", topic||"", reply.trim(), Date.now()]);
  res.json({ ok: true, id });
});

router.delete("/:id", async (req, res) => {
  await run("DELETE FROM board WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;

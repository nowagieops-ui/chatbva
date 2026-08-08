const express = require("express");
const { v4: uuid } = require("uuid");
const { query, run } = require("../db");
const { sendManagerAlert, sendBookingConfirmation } = require("../mailer");
const router = express.Router();

function today() { return new Date().toISOString().slice(0,10); }
function t2m(t) { const [h,m]=t.split(":"); return +h*60+ +m; }
function m2t(m) { return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }

router.get("/", async (req, res) => {
  const rows = await query("SELECT * FROM bookings");
  const out = {};
  rows.forEach(r => {
    out[r.slot_key] = {
      name: r.name, duration: r.duration, mode: r.mode,
      ts: r.ts, code: r.code, token: r.token,
      seen: !!r.seen, spanOf: r.span_of || undefined
    };
  });
  res.json(out);
});

router.post("/", async (req, res) => {
  const { key, name, duration, mode, token, code, email } = req.body;
  if (!key||!name||!duration||!mode||!token||!code)
    return res.status(400).json({ error: "Missing fields." });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(key))
    return res.status(400).json({ error: "Bad slot key." });
  if (key.slice(0,10) < today())
    return res.status(400).json({ error: "That slot is in the past." });

  const [date, time] = key.split("T");
  const wins = await query("SELECT * FROM windows WHERE date=? AND start<=? AND end>?", [date, time, time]);
  if (!wins.length) return res.status(409).json({ error: "Slot not available." });

  const taken = await query("SELECT slot_key FROM bookings WHERE slot_key=?", [key]);
  if (taken.length) return res.status(409).json({ error: "Already taken." });

  const mine = await query(
    "SELECT slot_key FROM bookings WHERE LOWER(name)=LOWER(?) AND span_of IS NULL", [name]
  );
  if (mine.length) return res.status(409).json({ error: "You already have a slot booked." });

  await run(
    "INSERT INTO bookings (slot_key,name,duration,mode,ts,code,token,seen,span_of) VALUES (?,?,?,?,?,?,?,0,NULL)",
    [key, name.trim(), duration, mode, Date.now(), code, token]
  );

  if (duration === 60) {
    const [h,m] = time.split(":").map(Number);
    const nextKey = date + "T" + m2t(h*60+m+30);
    const nextTaken = await query("SELECT slot_key FROM bookings WHERE slot_key=?", [nextKey]);
    if (!nextTaken.length) {
      await run(
        "INSERT INTO bookings (slot_key,name,duration,mode,ts,code,token,seen,span_of) VALUES (?,?,?,?,?,?,?,0,?)",
        [nextKey, name.trim(), 60, mode, Date.now(), code, token, key]
      );
    }
  }

  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    sendBookingConfirmation(email, { name, duration, mode, code }, key);

  sendManagerAlert(`New booking: ${name}`,
    `<p><b>${name}</b> booked a ${duration}-minute ${mode} on <b>${date}</b> at <b>${time}</b>. Reference: <b>${code}</b>.</p>`);

  res.json({ ok: true });
});

router.delete("/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Token required." });
  const rows = await query("SELECT * FROM bookings WHERE slot_key=?", [key]);
  if (!rows.length) return res.status(404).json({ error: "Not found." });
  const row = rows[0];
  if (token !== "manager" && row.token !== token && !row.span_of)
    return res.status(403).json({ error: "Token mismatch." });
  await run("DELETE FROM bookings WHERE slot_key=? OR span_of=?", [key, key]);
  res.json({ ok: true });
});

router.patch("/seen", async (req, res) => {
  await run("UPDATE bookings SET seen=1");
  res.json({ ok: true });
});

module.exports = router;

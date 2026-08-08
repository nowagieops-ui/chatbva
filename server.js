require("dotenv").config();
const express = require("express");
const helmet  = require("helmet");
const rateLimit = require("express-rate-limit");
const path    = require("path");
const { initSchema } = require("./db");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
    },
  },
}));

app.use("/api/feedback", rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: "Too many submissions. Try again in 15 minutes." }
}));
app.use("/api/bookings", rateLimit({
  windowMs: 5 * 60 * 1000, max: 30,
  message: { error: "Too many requests." }
}));

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/feedback", require("./routes/feedback"));
app.use("/api/bookings", require("./routes/bookings"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/board",    require("./routes/board"));

app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// Boot: init DB schema then start listening
initSchema()
  .then(() => app.listen(PORT, () => console.log(`BVA Open Line on port ${PORT}`)))
  .catch(err => {
    console.error("===== STARTUP FAILED =====");
    console.error("Reason:", err.message);
    console.error("Check DB_HOST, DB_NAME, DB_USER, DB_PASS env vars in hPanel.");
    console.error("Full error:", err);
    process.exit(1);
  });

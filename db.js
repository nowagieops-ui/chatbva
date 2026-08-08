const mysql = require("mysql2/promise");

let pool = null;

function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host:     process.env.DB_HOST     || "localhost",
    port:     parseInt(process.env.DB_PORT || "3306"),
    user:     process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
  });
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function run(sql, params = []) {
  const [result] = await getPool().execute(sql, params);
  return result;
}

async function initSchema() {
  const db = getPool();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\`  VARCHAR(100) PRIMARY KEY,
      value MEDIUMTEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS feedback (
      id      VARCHAR(64) PRIMARY KEY,
      kind    VARCHAR(20) NOT NULL,
      code    VARCHAR(10) NOT NULL,
      day     VARCHAR(10) NOT NULL,
      ts      BIGINT NOT NULL,
      status  VARCHAR(10) NOT NULL DEFAULT 'new',
      enc_k   MEDIUMTEXT NOT NULL,
      enc_iv  VARCHAR(64) NOT NULL,
      enc_c   MEDIUMTEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS board (
      id     VARCHAR(64) PRIMARY KEY,
      code   VARCHAR(10),
      kind   VARCHAR(20),
      topic  TEXT,
      reply  TEXT NOT NULL,
      ts     BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      slot_key  VARCHAR(20) PRIMARY KEY,
      name      VARCHAR(200) NOT NULL,
      duration  INT NOT NULL,
      mode      VARCHAR(50) NOT NULL,
      ts        BIGINT NOT NULL,
      code      VARCHAR(10) NOT NULL,
      token     VARCHAR(80) NOT NULL,
      seen      TINYINT NOT NULL DEFAULT 0,
      span_of   VARCHAR(20)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS windows (
      id      VARCHAR(64) PRIMARY KEY,
      date    VARCHAR(10) NOT NULL,
      start   VARCHAR(5) NOT NULL,
      end     VARCHAR(5) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log("Database schema ready.");
}

module.exports = { query, run, initSchema, getPool };

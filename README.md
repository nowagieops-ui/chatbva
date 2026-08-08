# BVA Open Line — Deployment Guide

## Stack
- **Express** – Node.js web server
- **MySQL** – Hostinger includes one on every plan, persists across deploys
- **mysql2** – database driver (pure JS, no native compilation needed)
- **nodemailer** – email confirmations and manager alerts

## File structure
```
bva-openline/
├── server.js          ← Entry point
├── db.js              ← MySQL pool + schema init
├── mailer.js          ← Email
├── package.json
├── .env.example       ← Copy to .env locally; use hPanel env vars on Hostinger
├── routes/
│   ├── feedback.js    ← Anonymous messages
│   ├── bookings.js    ← 1:1 slot booking
│   ├── settings.js    ← Vault, windows, owner
│   └── board.js       ← Public board
└── public/
    ├── index.html
    └── app.js
```

---

## Deploy via GitHub → Hostinger

### 1. Create a GitHub repo
Push this folder to a **private** GitHub repository.
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourname/bva-openline.git
git push -u origin main
```

### 2. Create the MySQL database on Hostinger
In **hPanel → Databases → MySQL Databases**:
- Create a database (e.g. `u123456_openline`)
- Create a user and a strong password
- Assign the user to the database with All Privileges
- Note the host (usually `localhost`), database name, username, and password

### 3. Connect GitHub to Hostinger
**hPanel → Websites → Add Website → Deploy Web App → Node.js Apps → Import Git Repository**
- Authorise Hostinger to access GitHub
- Select your `bva-openline` repo

### 4. Configure build settings
| Setting | Value |
|---|---|
| Build command | `npm install` |
| Start command | `node server.js` |
| Node version | 18 or above |
| Root directory | `/` |

### 5. Add environment variables
In hPanel before clicking Deploy, add each variable from `.env.example`:

| Variable | Where to find it |
|---|---|
| `DB_HOST` | MySQL Databases page (usually `localhost`) |
| `DB_PORT` | `3306` |
| `DB_NAME` | The database name you created |
| `DB_USER` | The database user you created |
| `DB_PASS` | The database user password |
| `SESSION_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | Your Hostinger email address |
| `SMTP_PASS` | Your email password |
| `MANAGER_EMAIL` | Where booking/message alerts go |
| `APP_URL` | `https://openline.yourdomain.com` |

### 6. Deploy
Click **Deploy**. Watch the log — the app will create its own tables on first boot.

### 7. Connect your domain
**hPanel → Domains** — point a subdomain (e.g. `openline.yourdomain.com`) at the app.
SSL is included and applied automatically.

### 8. First-time setup
Open the site → **Manager tab** → set your passphrase → write down the recovery code.
Do this before sharing the link. Whoever opens Manager first creates the key.

---

## Future updates
Push to GitHub → Hostinger auto-redeploys. The MySQL database is untouched between deploys.

## Local development
```bash
cp .env.example .env   # fill in your local MySQL details
npm install
node server.js
```

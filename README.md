# THREE O'CLOCK HR Desk

Shared people, attendance, leave, and payroll for the Bhilai store. Everyone uses the same server data — owner on a computer, staff on their phones.

## Run locally

```bash
python3 server.py
```

Open [http://localhost:4173](http://localhost:4173). Do not use `python3 -m http.server` — that copy cannot log in or save attendance.

Owner: `owner` / `3oclock`

## Keep phones working when this laptop is off (free)

The laptop copy (`http://192.168.29.141:4173`) dies when the lid closes. Host it on **Render** (free) and keep the database in a **private GitHub Gist**.

### 1. Private gist with your current data

1. GitHub → signed in → [gist.github.com](https://gist.github.com) → **Create gist**.
2. Filename: `store.json`
3. Paste the full contents of `data/store.json` from this project (so salaries, attendance, and leave stay).
4. Create a **secret** gist.
5. Copy the ID from the URL: `https://gist.github.com/yourname/THIS_ID`.

Then GitHub → Settings → Developer settings → Personal access tokens → generate a token with the **gist** scope. Save it.

### 2. Put the app on GitHub

On this Mac, in the project folder:

```bash
cd /Users/rakeshroby/Projects/threeoclock-hr
git init
git add index.html css js server.py Procfile render.yaml runtime.txt requirements.txt README.md .gitignore
git commit -m "THREE O'CLOCK HR desk"
```

On GitHub create a **private** repository (do not add a README), then:

```bash
git remote add origin https://github.com/YOUR_USER/threeoclock-hr.git
git branch -M main
git push -u origin main
```

Do not upload `data/` — that folder stays on this Mac only. The live app uses the gist.

### 3. Render web service

1. Sign up at [render.com](https://render.com) with GitHub.
2. **New → Web Service** → that private repo.
3. Start command: `python3 server.py`
4. Environment variables:
   - `GIST_ID` = gist ID from step 1
   - `GITHUB_TOKEN` = token from step 1
5. Create the service. Open the URL Render shows, e.g. `https://threeoclock-hr.onrender.com`.

Use **that https URL** on phones from now on. Owner is still `owner` / `3oclock`.

The free instance sleeps after idle time. The first open after sleep can take about 30–60 seconds, then it is normal. Data survives sleep because it is in the gist.

## Staff

On the live URL, use **Create account**. After the owner completes salary and bank details, they can clock in, apply for leave (not Friday–Sunday), and view pay. Advances the owner records come off the payslip.

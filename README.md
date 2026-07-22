# 🌍 World Mic — AI-Powered Blog Platform

> Multi-category blog with Groq AI content generation, Cloudinary image hosting, and MongoDB Atlas persistence.

---

## 🔑 Credentials Reference

| Service | Key / Detail |
|---------|-------------|
| **MongoDB Atlas** | `MONGO_URI` in `.env` — already configured |
| **Groq AI** | `GROQ_API_KEY` in `.env` — powers all AI features |
| **Cloudinary** | `CLOUDINARY_*` in `.env` — handles image uploads |

---

## 📁 Project Structure

```
worldmic/
├── server/
│   ├── app.js                  # Express entry point
│   ├── routes/
│   │   ├── auth.js             # Admin login / JWT
│   │   ├── posts.js            # Blog post CRUD
│   │   ├── data.js             # Comments, ads, settings
│   │   ├── ai.js               # AI command endpoints
│   │   └── upload.js           # Cloudinary image upload ← NEW
│   ├── services/
│   │   └── aiService.js        # Groq API wrapper ← UPDATED
│   ├── models/
│   │   ├── Post.js
│   │   └── Models.js
│   └── middleware/
│       └── auth.js
├── config/
│   ├── db.js                   # Mongoose connection
│   └── cloudinary.js           # Cloudinary + multer ← NEW
├── public/                     # Frontend (HTML/CSS/JS)
├── .env                        # All secrets (never commit!)
├── .gitignore
└── package.json
```

---

## 🚀 Deploy to Render (Free Tier)

### 1 — Push to GitHub first (see section below)

### 2 — Create Web Service on Render
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment:** `Node`

### 3 — Add Environment Variables on Render
Go to **Dashboard → Your Service → Environment** and add every key from your `.env` file.

> ⚠️ Never push `.env` to GitHub. It's in `.gitignore` already.

---

## 💻 Pushing from Acode / Termux to GitHub

This is the complete workflow you run from Termux (or Acode's terminal).

### One-Time Setup (do this once per device)

```bash
# 1 — Install git if not present
pkg install git -y

# 2 — Set your identity
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# 3 — Store credentials so you don't type them every push
git config --global credential.helper store

# 4 — Generate a GitHub Personal Access Token (PAT)
#     Go to: GitHub → Settings → Developer settings
#             → Personal access tokens → Tokens (classic)
#             → Generate new token (classic)
#     Scopes: check "repo"
#     Copy the token — you only see it once!
```

### First Push (new repo)

```bash
# Navigate to your project folder
cd /path/to/worldmic

# Initialise git
git init

# Add remote — replace YOUR_USERNAME and YOUR_REPO
git remote add origin https://github.com/YOUR_USERNAME/worldmic-blog.git

# Stage all files
git add .

# First commit
git commit -m "Initial commit — World Mic blog"

# Push (enter your GitHub username + PAT as password when prompted)
git push -u origin main
```

> After the first push with `credential.helper store`, your PAT is saved.
> All future pushes just need `git push`.

### Daily Workflow

```bash
cd /path/to/worldmic

# See what changed
git status

# Stage everything
git add .

# Or stage specific files
git add server/services/aiService.js public/index.html

# Commit with a message
git commit -m "feat: add Cloudinary image upload route"

# Push to GitHub
git push
```

### Useful Git Commands

```bash
# See commit history
git log --oneline

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Discard all uncommitted changes (careful!)
git checkout -- .

# Pull latest from GitHub
git pull origin main

# Check remote URL
git remote -v

# Change remote URL
git remote set-url origin https://github.com/YOUR_USERNAME/worldmic-blog.git
```

### If Push Is Rejected (diverged history)

```bash
# Pull first, then push
git pull origin main --rebase
git push
```

---

## 🖼 Image Upload API (NEW)

```
POST /api/upload/image   — upload featured image (returns { url, public_id })
POST /api/upload/ad      — upload ad banner image
DELETE /api/upload/:id   — delete image from Cloudinary
```

All endpoints require the admin JWT token in the `Authorization: Bearer <token>` header.

**Frontend usage:**
```js
const formData = new FormData();
formData.append('image', fileInput.files[0]);

const res = await fetch('/api/upload/image', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${adminToken}` },
  body: formData,
});
const { url } = await res.json();
// Save `url` as the post's featuredImage field
```

---

## 🤖 AI Features (Powered by Groq)

| Feature | Endpoint |
|---------|----------|
| Natural language admin commands | `POST /api/ai/command` |
| Generate full blog post | `POST /api/ai/generate-post` |
| Re-edit existing post | `POST /api/ai/reedit` |
| Auto-reply to comment | `POST /api/ai/reply-comment` |
| Trending topic suggestions | `POST /api/ai/trending` |

Model: **llama-3.3-70b-versatile** via Groq (fast, free tier available)

---

## 🛠 Local Development

```bash
# Install dependencies
npm install

# Start dev server with auto-reload
npm run dev

# Open in browser
# http://localhost:3000
# Admin: http://localhost:3000/admin-login.html
```

---

## ⚠️ Important Notes

- **`.env` is gitignored** — add env vars manually on Render
- **Render filesystem is ephemeral** — always use Cloudinary for images, never local disk
- **Free Render tier sleeps after 15 min** — ping `/api/posts` via UptimeRobot to keep it awake
- **MongoDB Atlas** free tier (M0) = 512 MB storage

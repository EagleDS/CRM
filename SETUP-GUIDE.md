# Eagle DS CRM — Setup Guide

Everything you need to get the upgraded system live. Three short tasks in the Firebase console, then deploy the files. Budget about 15 minutes.

---

## What changed in this upgrade

The big one: your database is no longer open to the public. The old "1234" passcode is gone. Access now requires a real login, and the database enforces it at the server level — not just in the page.

Everything else (CRM, events, automation, blog, tracking, web capture) works exactly as before, just on a secure foundation.

---

## Task 1 — Enable login (5 min)

1. Go to https://console.firebase.google.com and open your **taekwondo-scoreboard-e58ec** project.
2. Left menu → **Build** → **Authentication** → **Get started**.
3. Click the **Sign-in method** tab.
4. Click **Email/Password**, toggle **Enable**, click **Save**.
5. Go to the **Users** tab → **Add user**.
6. Enter your email (use **info@eagleds.co.nz** or your personal email) and a strong password. This is now your login for all four tools. Click **Add user**.

> Add one user per person who needs access (you, a coach, an admin). Each gets their own login. No more shared passcode.

---

## Task 2 — Lock the database (5 min)

1. In the Firebase console, left menu → **Build** → **Realtime Database** → **Rules** tab.
2. Delete everything in the rules box.
3. Open the file **FIREBASE-SECURITY-RULES.json** (included), copy all of it, paste it in.
4. Click **Publish**.

What these rules do:
- **Contacts, broadcasts, automation, events** — only readable/writable when logged in. The public cannot see your contact list.
- **Blog posts** — publicly readable (so the public blog works), only writable when logged in.
- **Web leads** — the public can submit a trial enquiry (create only), but cannot read or edit anyone's data.
- **Email tracking** — the public can register an open/click (so tracking works), but cannot read the data.

---

## Task 3 — Add your Firebase API key (2 min)

The login needs your project's public API key (this one is safe to expose — it only identifies the project; the security rules do the actual protecting).

1. Firebase console → **Project settings** (gear icon, top-left).
2. Scroll to **Your apps**. If you have a web app, the config is there. If not, click **</>** (Add web app), name it "Eagle DS Tools", register.
3. Copy the **apiKey** value (starts with `AIza...`).
4. In each of these four files — **crm.html, events.html, scheduler.html, blog.html** — find this line near the bottom:
   ```
   apiKey: "AIzaSyD-PLACEHOLDER-REPLACE-WITH-YOURS",
   ```
   Replace the placeholder with your real key. Same key in all four files.

> Tip: open each file in a text editor and use Find & Replace — search `AIzaSyD-PLACEHOLDER-REPLACE-WITH-YOURS`, replace with your key.

---

## Task 4 — Add analytics IDs (optional, 5 min)

For the public blog (**blog-public.html**):

- **Google Analytics 4:** create a free property at https://analytics.google.com, get your Measurement ID (`G-XXXXXXXXXX`), and replace both instances of `G-XXXXXXXXXX` in blog-public.html.
- **Microsoft Clarity:** create a free project at https://clarity.microsoft.com, get your Project ID, and replace `XXXXXXXXXX` in blog-public.html.

Skip this if you're not ready — the page works fine without it.

---

## Deploy — push to GitHub

Upload all of these to your GitHub Pages repo:

| File | Purpose | Who uses it |
|------|---------|-------------|
| crm.html | Master CRM + leads inbox + email analytics | You (login) |
| events.html | Event calendar + email sequences | You (login) |
| scheduler.html | Automation + retention rules | You (login) |
| blog.html | Blog editor (internal) | You (login) |
| blog-public.html | Public blog — rename to **blog.html** on the public site, OR keep separate | Public |
| capture.html | Trial booking form | Public |
| track.html | Email open/click tracker | Automatic |

> **Note on the two blog files:** `blog.html` is your private editor. `blog-public.html` is what readers see. Decide how you want them named — if your public site is a separate repo, put `blog-public.html` there as `blog.html`. If it's the same repo, keep both names as-is and link the public one from your main site.

---

## Connect the trial form to your site

Add a "Book a Trial" button anywhere on your main site pointing to `capture.html`. For example, in your nav:
```html
<a href="capture.html" class="nav-cta">Book a Trial</a>
```
Enquiries land in the **Leads** tab of your CRM, where you add them to the directory with one click.

---

## Your Resend key

Unchanged — the first time you send an email in any tool, it asks for your Resend API key and stores it in that browser. It is never written into the code.

---

## Quick test after deploy

1. Open crm.html → you should see the login screen → sign in with your new account → CRM loads.
2. Open capture.html (logged out, or incognito) → submit a test enquiry → check it appears in the CRM Leads tab.
3. Send yourself a test broadcast → open it → check it shows in Email Analytics.

That's it. You're secure and live.

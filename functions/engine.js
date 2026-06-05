// ═══════════════════════════════════════════════════════════════
// EAGLE DS — THE ENGINE
// One event-driven core that RUNS the business. Every arm sends it
// events; it decides what to do and DOES it — no dashboard, no human
// step. Built to run a five-arm operation for one person.
//
// Firebase Functions v2 · Node 20 · runs on the owned spine.
//
// The whole idea: things HAPPEN (enquiry, payment, registration,
// programme milestone). The engine LISTENS, DECIDES, and ACTS —
// follows up, sequences, files, routes, certifies, reminds — itself.
// You are not in the loop unless a human decision is genuinely needed,
// and then it brings that ONE decision to you, pre-made, one tap.
// ═══════════════════════════════════════════════════════════════
const { onValueCreated } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { Resend } = require("resend");

const resendKey = defineSecret("RESEND_API_KEY");
const FB = "https://taekwondo-scoreboard-e58ec-default-rtdb.firebaseio.com";
const FROM = "Eagle DS <info@eagleds.co.nz>";

// ── helpers ──────────────────────────────────────────────────
const fbGet = async (path) => {
  const r = await fetch(`${FB}/${path}.json`); return r.json();
};
const fbSet = async (path, val) => {
  await fetch(`${FB}/${path}.json`, { method:"PUT", body: JSON.stringify(val) });
};
const fbPush = async (path, val) => {
  await fetch(`${FB}/${path}.json`, { method:"POST", body: JSON.stringify(val) });
};
const emailKey = (e) => e.trim().toLowerCase().replace(/\./g,"%2E").replace(/@/g,"%40");
const send = async (resend, to, subject, html) =>
  resend.emails.send({ from: FROM, to, subject, html });

// ── Email shells ─────────────────────────────────────────────
// Standard transactional shell — enquiries, payments, confirmations
const shell = (body) => `
<div style="background:#0a0a0a;color:#f8f4ee;padding:40px 36px;font-family:Arial,sans-serif;max-width:580px;margin:0 auto;">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr>
      <td>
        <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:4px;color:#C8960C;text-transform:uppercase;">EAGLE DS</div>
        <div style="font-family:monospace;font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Combat &amp; Wellness · East Tāmaki, Auckland</div>
      </td>
    </tr>
  </table>
  <div style="border-top:1px solid #1a1a1a;padding-top:20px;">
    ${body}
  </div>
  <div style="margin-top:32px;padding-top:20px;border-top:1px solid #1a1a1a;">
    <div style="font-family:monospace;font-size:9px;color:#444;line-height:1.8;letter-spacing:0.5px;">
      <strong style="color:#666;">Dafydd Sanders</strong> — Founder &amp; Head Coach, Eagle DS<br>
      NZ Representative · Four Combat Disciplines · 27 Years Coaching<br>
      17 Nandina Avenue, East Tāmaki, Auckland 2013<br>
      <a href="tel:+64210902471" style="color:#555;text-decoration:none;">021 902 471</a> ·
      <a href="mailto:info@eagleds.co.nz" style="color:#555;text-decoration:none;">info@eagleds.co.nz</a> ·
      <a href="https://eagleds.co.nz" style="color:#C8960C;text-decoration:none;">eagleds.co.nz</a>
    </div>
  </div>
</div>`;

// Blog series shell — full branded treatment for editorial content
const blogShell = (title, body, postNum, postUrl, recipientEmail) => `
<div style="background:#0a0a0a;color:#f8f4ee;margin:0 auto;max-width:600px;font-family:Arial,sans-serif;">

  <!-- Header -->
  <div style="padding:32px 40px 24px;border-bottom:1px solid #1a1a1a;">
    <div style="font-family:Arial,sans-serif;font-size:20px;font-weight:900;letter-spacing:4px;color:#C8960C;text-transform:uppercase;">EAGLE DS</div>
    <div style="font-family:monospace;font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">The Journal · eagleds.co.nz</div>
  </div>

  <!-- Post label -->
  <div style="padding:24px 40px 0;">
    <div style="font-family:monospace;font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">Post ${postNum} of 12</div>
    <!-- Title -->
    <div style="font-family:Georgia,serif;font-size:32px;font-weight:600;color:#f8f4ee;line-height:1.2;margin-bottom:24px;">${title}</div>
  </div>

  <!-- Body -->
  <div style="padding:0 40px;font-family:Georgia,serif;font-size:15px;color:#ccc;line-height:1.9;">
    ${body}
  </div>

  <!-- Read more -->
  <div style="padding:32px 40px;">
    <a href="${postUrl}" style="display:inline-block;background:#C8960C;color:#000;font-family:monospace;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:14px 28px;text-decoration:none;">Read on the blog →</a>
  </div>

  <!-- About -->
  <div style="margin:0 40px;padding:24px;background:#0f0f0f;border:1px solid #1a1a1a;">
    <div style="font-family:monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#555;margin-bottom:10px;">About the author</div>
    <div style="font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#f8f4ee;margin-bottom:6px;">Dafydd Sanders</div>
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#888;line-height:1.7;">Founder &amp; Head Coach of Eagle DS. NZ Representative across four combat disciplines — Taekwondo (World #10, two Olympic campaigns), Kickboxing, K1, and MMA. 27 years coaching. Builder of the Combat Games Series — 50+ clubs, 450+ matches, zero concussions. Eagle DS is a Ngāi Tahu family business in East Tāmaki, Auckland.</div>
  </div>

  <!-- Footer -->
  <div style="padding:24px 40px 32px;">
    <div style="font-family:monospace;font-size:9px;color:#444;line-height:2;letter-spacing:0.5px;">
      <strong style="color:#555;">Eagle DS Combat &amp; Wellness</strong><br>
      17 Nandina Avenue, East Tāmaki, Auckland 2013<br>
      <a href="tel:+64210902471" style="color:#444;text-decoration:none;">021 902 471</a> ·
      <a href="mailto:info@eagleds.co.nz" style="color:#444;text-decoration:none;">info@eagleds.co.nz</a> ·
      <a href="https://eagleds.co.nz" style="color:#C8960C;text-decoration:none;">eagleds.co.nz</a><br>
      <a href="https://us-central1-taekwondo-scoreboard-e58ec.cloudfunctions.net/unsubscribe?e=${encodeURIComponent(recipientEmail)}" style="color:#333;text-decoration:underline;font-size:9px;">Unsubscribe</a>
    </div>
  </div>

</div>`;

// ═══════════════════════════════════════════════════════════════
// THE EVENT BUS
// Every arm writes an event to /events/{pushid}. The engine fires
// on creation, routes by type, and acts. Arms never need to know
// what happens next — they just announce what happened.
//
// Event shape: { type, email, name, arm, data:{...}, ts }
// ═══════════════════════════════════════════════════════════════
exports.trialAutomationEngine = onValueCreated(
  { ref: "/events/{id}", instance: "taekwondo-scoreboard-e58ec-default-rtdb", secrets: [resendKey] },
  async (event) => {
    const e = event.data.val();
    const resend = new Resend(resendKey.value());
    if (!e || !e.type) return;

    const key = e.email ? emailKey(e.email) : null;
    const log = async (action) =>
      fbPush("engine_log", { type:e.type, email:e.email||null, action, ts:new Date().toISOString() });

    switch (e.type) {

      // ── ENQUIRY (gym trial, referral, any "interested" event) ──
      case "enquiry": {
        // 1. File them into the directory as a lead-identity (idempotent upsert)
        if (key) {
          const existing = await fbGet(`directory_crm_master/${key}`).catch(()=>null);
          await fbSet(`directory_crm_master/${key}`, {
            ...(existing||{}),
            email: e.email, name: e.name || (existing&&existing.name) || "",
            arms: Array.from(new Set([...((existing&&existing.arms)||[]), e.arm||"gym"])),
            lastActivity: e.ts, added: (existing&&existing.added)||e.ts,
            source: (existing&&existing.source)||e.data?.source||"enquiry",
          });
        }
        // 2. Respond instantly — no human step
        if (e.email) {
          await send(resend, e.email, "Welcome to Eagle DS — let's get you started",
            shell(`<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${e.name||"there"},</p>
            <p style="font-size:14px;color:#bbb;line-height:1.7;">Thanks for reaching out. We develop people through combat sport — not damage them — and we'd love to show you what that looks like on the mat. Someone will be in touch to lock in your trial. In the meantime, here's what to expect on your first session.</p>
            <p style="font-size:13px;color:#888;line-height:1.7;">Wear comfortable clothes you can move in, bring a water bottle, and just turn up ready to learn. No experience needed.</p>`));
        }
        // 3. Start the follow-up sequence (engine will chase if no progress)
        await fbSet(`sequences/enquiry/${key}`, { stage:0, email:e.email, name:e.name||"", startedAt:e.ts, arm:e.arm||"gym" });
        await log("filed + welcomed + sequence started");
        break;
      }

      // ── PAYMENT (shop order, membership, event entry) ──
      case "payment": {
        if (e.email) {
          await send(resend, e.email, "Payment received — thank you",
            shell(`<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${e.name||"there"},</p>
            <p style="font-size:14px;color:#bbb;line-height:1.7;">We've received your payment of $${((e.data?.amount||0)/100).toFixed(2)} for ${e.data?.what||"your order"}. ${e.data?.note||""}</p>`));
        }
        // route to the right arm's fulfilment without you
        if (e.data?.kind === "shop") {
          // hand to the order queue (already built) — engine just confirms here
          await log("payment confirmed → shop fulfilment");
        } else if (e.data?.kind === "membership") {
          if (key) {
            const ex = await fbGet(`directory_crm_master/${key}`).catch(()=>null);
            await fbSet(`directory_crm_master/${key}`, { ...(ex||{}), email:e.email, name:e.name||(ex&&ex.name)||"",
              arms: Array.from(new Set([...((ex&&ex.arms)||[]), "gym"])),
              membership: { status:"active", since:e.ts, plan:e.data?.plan||"" },
              lastActivity:e.ts, added:(ex&&ex.added)||e.ts });
          }
          await log("membership activated on spine");
        }
        break;
      }

      // ── REGISTRATION (CGS competitor) ──
      case "cgs_registration": {
        if (key) {
          const ex = await fbGet(`directory_crm_master/${key}`).catch(()=>null);
          await fbSet(`directory_crm_master/${key}`, { ...(ex||{}), email:e.email, name:e.name||(ex&&ex.name)||"",
            arms: Array.from(new Set([...((ex&&ex.arms)||[]), "cgs"])),
            lastActivity:e.ts, added:(ex&&ex.added)||e.ts });
        }
        if (e.email) {
          await send(resend, e.email, "You're registered — Combat Games Series",
            shell(`<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${e.name||"competitor"},</p>
            <p style="font-size:14px;color:#bbb;line-height:1.7;">Your registration for ${e.data?.event||"the next event"} is in. We'll send your bout details and schedule closer to the day. Come ready.</p>`));
        }
        await log("competitor filed to cgs arm + confirmed");
        break;
      }

      // ── CERTIFICATION milestone (coach/ref progress) ──
      case "certification": {
        if (e.data?.certified && e.email) {
          await send(resend, e.email, `You're certified — ${e.data?.course||"Eagle DS"}`,
            shell(`<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${e.name||"there"},</p>
            <p style="font-size:14px;color:#bbb;line-height:1.7;">You've met the standard and you're now a certified ${e.data?.role||"official"} on the Eagle DS system. You carry the standard now — use it well.</p>`));
          await log("certification issued + notified");
        }
        break;
      }

      // ── PROGRAMME milestone (community cohort) ──
      case "programme_complete": {
        if (e.email) {
          await send(resend, e.email, "Programme complete — what's next",
            shell(`<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${e.name||"there"},</p>
            <p style="font-size:14px;color:#bbb;line-height:1.7;">You've finished the programme — that's a real achievement. The door stays open: here's how you can keep training with us if you'd like to.</p>`));
        }
        await log("programme completion handled");
        break;
      }

      default:
        await log("unknown event type — logged only");
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// THE CHASER — runs daily, moves sequences forward on its own.
// This is what makes it RUN rather than wait: people who enquired
// and didn't progress get the next nudge automatically, until they
// either convert or politely time out. You never chase anyone.
// ═══════════════════════════════════════════════════════════════
exports.advanceSequences = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Pacific/Auckland", secrets: [resendKey] },
  async () => {
    const resend = new Resend(resendKey.value());
    const seqs = await fbGet("sequences/enquiry").catch(()=>({})) || {};
    const now = Date.now();

    // enquiry follow-up cadence (days → message)
    const steps = [
      { day:2, subject:"Still keen to give it a go?",
        body:"Just checking in — the offer of a trial still stands whenever you're ready. No pressure, no commitment. Reply to this email or call 021 902 471 and we'll sort a time." },
      { day:5, subject:"What makes Eagle DS different",
        body:"We're not a drop-in fitness class. We build a pathway — for your tamariki or for you — with a real standard and real outcomes. That's why families travel to train with us. Come see it for yourself." },
      { day:10, subject:"The door's always open",
        body:"We'll leave it here for now so we're not crowding your inbox. Whenever the time is right, we'd love to have you on the mat. Everything you need is at eagleds.co.nz." },
    ];

    for (const key in seqs) {
      const s = seqs[key];
      if (!s || !s.email || s.done) continue;
      const ageDays = (now - new Date(s.startedAt).getTime()) / 86400000;
      const stage = s.stage || 0;
      const next = steps[stage];
      if (next && ageDays >= next.day) {
        await send(resend, s.email, next.subject,
          shell(`<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${s.name||"there"},</p>
          <p style="font-size:14px;color:#bbb;line-height:1.7;">${next.body}</p>`));
        const newStage = stage + 1;
        await fbSet(`sequences/enquiry/${key}`, { ...s, stage:newStage, done: newStage >= steps.length, lastSent:new Date().toISOString() });
      }
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// THE SERIES ENGINE — runs every Wednesday 9am NZ.
// Sends the next blog post in sequence to every enrolled subscriber.
// Each subscriber has their own position — latecomers start at post 1.
// Never sends the same post twice. Stops automatically when done.
//
// Subscriber record at /sequences/blog_series/{emailKey}:
// { email, name, stage, startedAt, lastSent, done }
//
// Post order is fixed: 01→12. Release schedule: one per week Wednesday.
// ═══════════════════════════════════════════════════════════════
exports.advanceBlogSeries = onSchedule(
  { schedule: "0 9 * * 3", timeZone: "Pacific/Auckland", secrets: [resendKey] },
  async () => {
    const resend = new Resend(resendKey.value());

    // Load blog posts from Firebase
    const posts = await fbGet("eagle_blog").catch(() => ({})) || {};

    // Build ordered sequence of published posts by postNumber
    const orderedPosts = Object.values(posts)
      .filter(p => p.status === "published" && p.postNumber)
      .sort((a, b) => a.postNumber - b.postNumber);

    if (!orderedPosts.length) return;

    // Load subscribers
    const subs = await fbGet("sequences/blog_series").catch(() => ({})) || {};
    let sent = 0, finished = 0;

    for (const key in subs) {
      const s = subs[key];
      if (!s || !s.email || s.done) { if (s && s.done) finished++; continue; }

      const stage = s.stage || 0;
      const post = orderedPosts[stage];
      if (!post) {
        // Subscriber has received all posts
        await fbSet(`sequences/blog_series/${key}`, { ...s, done: true, finishedAt: new Date().toISOString() });
        finished++;
        continue;
      }

      // Build email — Cormorant title, DM Sans body, gold Eagle DS branding
      const postUrl = `https://eagleds.co.nz/blog.html`;
      const postExcerpt = `<p style="border-left:3px solid #C8960C;padding-left:16px;color:#999;font-style:italic;">${post.excerpt}</p>`;
      const html = blogShell(post.title, postExcerpt, String(post.postNumber).padStart(2,'0'), postUrl, s.email);

      await send(resend, s.email, post.title, html);
      const newStage = stage + 1;
      const done = newStage >= orderedPosts.length;
      await fbSet(`sequences/blog_series/${key}`, {
        ...s,
        stage: newStage,
        done,
        lastSent: new Date().toISOString(),
        lastPost: post.title,
        ...(done ? { finishedAt: new Date().toISOString() } : {})
      });
      sent++;
    }

    await fbPush("engine_log", {
      type: "blog_series_advance",
      action: `Sent post to ${sent} subscribers. ${finished} completed the series.`,
      ts: new Date().toISOString()
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// UNSUBSCRIBE — one-click removal from the blog series.
// Linked from every blog series email footer.
// GET /unsubscribe?e=email@address.com
// Sets done:true on the subscriber record and shows a confirmation page.
// ═══════════════════════════════════════════════════════════════
exports.unsubscribe = onRequest(async (req, res) => {
  const email = req.query.e;
  if (!email || !email.includes("@")) {
    res.status(400).send(unsubPage("Invalid request.", false));
    return;
  }
  const key = emailKey(email);
  try {
    const sub = await fbGet(`sequences/blog_series/${key}`).catch(() => null);
    if (!sub) {
      res.status(200).send(unsubPage(email, false));
      return;
    }
    await fbSet(`sequences/blog_series/${key}`, {
      ...sub,
      done: true,
      unsubscribedAt: new Date().toISOString()
    });
    await fbPush("engine_log", {
      type: "unsubscribe",
      email,
      action: "Removed from blog series via one-click unsubscribe.",
      ts: new Date().toISOString()
    });
    res.status(200).send(unsubPage(email, true));
  } catch(e) {
    res.status(500).send(unsubPage(email, false));
  }
});

const unsubPage = (email, success) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Eagle DS — Unsubscribe</title>
</head>
<body style="background:#0a0a0a;color:#f8f4ee;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;">
  <div style="max-width:480px;text-align:center;">
    <div style="font-size:22px;font-weight:900;letter-spacing:4px;color:#C8960C;margin-bottom:4px;">EAGLE DS</div>
    <div style="font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:40px;">Combat &amp; Wellness</div>
    ${success
      ? `<div style="font-size:22px;font-weight:600;color:#f8f4ee;margin-bottom:12px;">You've been unsubscribed.</div>
         <div style="font-size:13px;color:#888;line-height:1.8;">${email} has been removed from the Eagle DS Journal series. You won't receive any further posts.<br><br>The door stays open. <a href="https://eagleds.co.nz" style="color:#C8960C;">eagleds.co.nz</a></div>`
      : `<div style="font-size:22px;font-weight:600;color:#f8f4ee;margin-bottom:12px;">That address wasn't found.</div>
         <div style="font-size:13px;color:#888;line-height:1.8;">We couldn't find an active subscription for ${email}. You may have already been removed, or the link may have expired.<br><br><a href="https://eagleds.co.nz" style="color:#C8960C;">eagleds.co.nz</a></div>`
    }
  </div>
</body>
</html>`;

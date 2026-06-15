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

// Brand email shell — everything the engine sends looks like Eagle DS
const shell = (body) => `
<div style="background:#0a0a0a;color:#f8f4ee;padding:36px;font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;">
  <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:3px;color:#C8960C;">EAGLE DS</div>
  <div style="font-family:monospace;font-size:9px;color:#666;letter-spacing:2px;border-bottom:1px solid #222;padding-bottom:12px;margin-bottom:18px;">COMBAT &amp; WELLNESS · EAST TĀMAKI</div>
  ${body}
  <div style="margin-top:26px;font-family:monospace;font-size:9px;color:#444;border-top:1px solid #1a1a1a;padding-top:14px;">Eagle DS · 17 Nandina Ave, East Tāmaki, Auckland · 021 902 471</div>
</div>`;

// ═══════════════════════════════════════════════════════════════
// THE EVENT BUS
// Every arm writes an event to /events/{pushid}. The engine fires
// on creation, routes by type, and acts. Arms never need to know
// what happens next — they just announce what happened.
//
// Event shape: { type, email, name, arm, data:{...}, ts }
// ═══════════════════════════════════════════════════════════════
exports.engine = onValueCreated(
  { ref: "/events/{id}", secrets: [resendKey] },
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

      case "broadcast": {
        if (e.to && e.subject && e.body) {
          const html = shell(
            (e.name ? `<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${e.name},</p>` : "") +
            e.body.split("\n").map(p => {
              if (!p.trim()) return "";
              if (p.trim().startsWith("<")) return p;
              return `<p style="font-size:14px;color:#bbb;line-height:1.7;">${p}</p>`;
            }).join("")
          );
          await send(resend, e.to, e.subject, html);
          await log("broadcast email sent to " + e.to);
        } else {
          await log("broadcast event missing to/subject/body — skipped");
        }
        break;
      }
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
// SEND SINGLE EMAIL — called by CRM for individual replies
// POST { to, name, subject, body }
// Auth: Firebase ID token in Authorization header
// ═══════════════════════════════════════════════════════════════
exports.sendSingleEmail = onRequest(
  { secrets: [resendKey], cors: ["https://eagleds.github.io", "https://crm-4si.pages.dev"] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

    // Verify Firebase Auth token
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) { res.status(401).json({ error: "Unauthorised" }); return; }
    try {
      const admin = require("firebase-admin");
      if (!admin.apps.length) {
        admin.initializeApp({
          projectId: "taekwondo-scoreboard-e58ec",
          databaseURL: "https://taekwondo-scoreboard-e58ec-default-rtdb.firebaseio.com"
        });
      }
      await admin.auth().verifyIdToken(token);
    } catch(e) { res.status(401).json({ error: "Invalid token" }); return; }

    const { to, name, subject, body } = req.body;
    if (!to || !subject || !body) { res.status(400).json({ error: "to, subject and body required" }); return; }

    const greeting = name ? `<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${name},</p>` : "";
    const paragraphs = body.split("\n").map(p => {
      if (!p.trim()) return "";
      if (p.trim().startsWith("<")) return p; // raw HTML passes through
      return `<p style="font-size:14px;color:#bbb;line-height:1.7;">${p}</p>`;
    }).join("");

    const html = `<div style="background:#0a0a0a;color:#f8f4ee;padding:40px 36px;font-family:Arial,sans-serif;max-width:580px;margin:0 auto;">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td>
        <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:4px;color:#C8960C;text-transform:uppercase;">EAGLE DS</div>
        <div style="font-family:monospace;font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Combat &amp; Wellness · East Tāmaki, Auckland</div>
      </td></tr></table>
      <div style="border-top:1px solid #1a1a1a;padding-top:20px;">
        ${greeting}${paragraphs}
      </div>
      <div style="margin-top:32px;padding-top:20px;border-top:1px solid #1a1a1a;">
        <div style="font-family:monospace;font-size:9px;color:#444;line-height:1.8;letter-spacing:0.5px;">
          <strong style="color:#666;">Dafydd Sanders</strong> — Founder &amp; Head Coach, Eagle DS<br>
          17 Nandina Avenue, East Tāmaki, Auckland 2013<br>
          <a href="tel:+64210902471" style="color:#555;text-decoration:none;">021 902 471</a> ·
          <a href="mailto:info@eagleds.co.nz" style="color:#555;text-decoration:none;">info@eagleds.co.nz</a> ·
          <a href="https://eagleds.co.nz" style="color:#C8960C;text-decoration:none;">eagleds.co.nz</a>
        </div>
      </div>
    </div>`;

    try {
      const resend = new Resend(resendKey.value());
      await resend.emails.send({ from: "Eagle DS <info@eagleds.co.nz>", to, subject, html });
      res.status(200).json({ ok: true });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// BROADCAST EMAIL — called by CRM for bulk sends
// POST { contacts: [{email, name}], subject, body, bid }
// Auth: Firebase ID token in Authorization header
// ═══════════════════════════════════════════════════════════════
exports.broadcastEmail = onRequest(
  { secrets: [resendKey], cors: ["https://eagleds.github.io", "https://crm-4si.pages.dev"], timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) { res.status(401).json({ error: "Unauthorised" }); return; }
    try {
      const admin = require("firebase-admin");
      if (!admin.apps.length) {
        admin.initializeApp({
          projectId: "taekwondo-scoreboard-e58ec",
          databaseURL: "https://taekwondo-scoreboard-e58ec-default-rtdb.firebaseio.com"
        });
      }
      await admin.auth().verifyIdToken(token);
    } catch(e) { res.status(401).json({ error: "Invalid token" }); return; }

    const { contacts, subject, body, bid } = req.body;
    if (!contacts || !subject || !body) { res.status(400).json({ error: "contacts, subject and body required" }); return; }

    const resend = new Resend(resendKey.value());
    let sent = 0, failed = 0;

    for (const c of contacts) {
      const name = c.name || "";
      const greeting = name ? `<p style="font-size:14px;color:#bbb;line-height:1.7;">Kia ora ${name},</p>` : "";
      const personalBody = body.replace(/\[FirstName\]/g, name).replace(/\[ChildName\]/g, c.childName || "");
      const paragraphs = personalBody.split("\n").map(p => {
        if (!p.trim()) return "";
        if (p.trim().startsWith("<")) return p; // raw HTML passes through
        return `<p style="font-size:14px;color:#bbb;line-height:1.7;">${p}</p>`;
      }).join("");
      const personalSubject = subject.replace(/\[FirstName\]/g, name);

      // Tracking pixel
      const pixel = bid ? `<img src="https://us-central1-taekwondo-scoreboard-e58ec.cloudfunctions.net/track?bid=${bid}&e=${encodeURIComponent(c.email)}&t=o" width="1" height="1" style="display:none;">` : "";

      const html = `<div style="background:#0a0a0a;color:#f8f4ee;padding:40px 36px;font-family:Arial,sans-serif;max-width:580px;margin:0 auto;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td>
          <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:4px;color:#C8960C;text-transform:uppercase;">EAGLE DS</div>
          <div style="font-family:monospace;font-size:9px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Combat &amp; Wellness · East Tāmaki, Auckland</div>
        </td></tr></table>
        <div style="border-top:1px solid #1a1a1a;padding-top:20px;">
          ${greeting}${paragraphs}
        </div>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #1a1a1a;">
          <div style="font-family:monospace;font-size:9px;color:#444;line-height:1.8;letter-spacing:0.5px;">
            <strong style="color:#666;">Dafydd Sanders</strong> — Founder &amp; Head Coach, Eagle DS<br>
            17 Nandina Avenue, East Tāmaki, Auckland 2013<br>
            <a href="tel:+64210902471" style="color:#555;text-decoration:none;">021 902 471</a> ·
            <a href="mailto:info@eagleds.co.nz" style="color:#555;text-decoration:none;">info@eagleds.co.nz</a> ·
            <a href="https://eagleds.co.nz" style="color:#C8960C;text-decoration:none;">eagleds.co.nz</a><br>
            <a href="https://us-central1-taekwondo-scoreboard-e58ec.cloudfunctions.net/unsubscribe?e=${encodeURIComponent(c.email)}" style="color:#333;text-decoration:underline;font-size:9px;">Unsubscribe</a>
          </div>
        </div>
        ${pixel}
      </div>`;

      try {
        await resend.emails.send({ from: "Eagle DS <info@eagleds.co.nz>", to: c.email, subject: personalSubject, html });
        sent++;
      } catch(e) {
        failed++;
      }
    }

    res.status(200).json({ ok: true, sent, failed });
  }
);

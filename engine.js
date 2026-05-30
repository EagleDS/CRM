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

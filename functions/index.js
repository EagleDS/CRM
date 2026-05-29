
// ═══════════════════════════════════════════════════════════════
// Eagle DS Dropship Automation — Firebase Cloud Function v2
// Deploy: firebase deploy --only functions
// ═══════════════════════════════════════════════════════════════
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Stripe = require("stripe");
const { Resend } = require("resend");

// Secrets stored in Firebase Secret Manager — never in code
const stripeSecret  = defineSecret("STRIPE_SECRET_KEY");
const webhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const resendKey     = defineSecret("RESEND_API_KEY");

// ── SKU MAP ──────────────────────────────────────────────────
// Map Stripe Price IDs → wholesaler SKU + supplier email
// Add new products here without touching function logic
const SKU_MAP = {
  // Morgan Sports — replace PRICE_ID_... with real Stripe price IDs
  "PRICE_ID_MORGANALPHAMMA":    { sku:"MS-ALPHA-MMA-GLOVES",   desc:"Morgan Alpha MMA Sparring Gloves",           supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANSHIN":        { sku:"MS-ALPHA-SHIN",          desc:"Morgan Alpha Shin & Instep Protectors",      supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANSHOTO":       { sku:"MS-B2-SHOTO-MMA",        desc:"Morgan B2 Bomber Leather Shoto MMA Gloves",  supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANCOTTONWRAP":  { sku:"MS-WRAP-COTTON-180",     desc:"Morgan Cotton Boxing Hand Wraps 4m",         supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANELASTICWRAP": { sku:"MS-WRAP-ELASTIC",        desc:"Morgan Elasticated Easy Hand Wraps",         supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANMG":          { sku:"MS-MOUTHGUARD-END",      desc:"Morgan Endurance Mouth Guard",               supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANBOXING":      { sku:"MS-BOXING-END-PRO",      desc:"Morgan Endurance Pro Boxing Gloves",         supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANKIDSHIN":     { sku:"MS-KIDS-SHIN-ELASTIC",   desc:"Morgan Kids Elastic Shin & Instep Guards",   supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANGROIN":       { sku:"MS-GROIN-PLASTIC",       desc:"Morgan Plastic Groin Guard with Cup",        supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANGLOVESPINK":  { sku:"MS-V2-CLASSIC-PINK",     desc:"Morgan V2 Classic Boxing Gloves Pink",       supplier:"orders@morgansports.com.au" },
  "PRICE_ID_MORGANSHINV2":      { sku:"MS-V2-SHIN",             desc:"Morgan V2 Classic Shin & Instep Guards",     supplier:"orders@morgansports.com.au" },
  // Eagle DS branded — fulfil from your own stock or secondary supplier
  "PRICE_ID_SINGLET":           { sku:"EDS-SINGLET-YOUTH",      desc:"Youth Eagle DS Training Singlet",            supplier:"info@eagleds.co.nz" },
  "PRICE_ID_DOBOK":             { sku:"EDS-DOBOK",               desc:"Do Bok Taekwondo Uniform",                   supplier:"info@eagleds.co.nz" },
  "PRICE_ID_GIRLSSHORTS":       { sku:"EDS-GIRLS-SHORTS",        desc:"Fearless Girls Muay Thai Shorts",            supplier:"info@eagleds.co.nz" },
  "PRICE_ID_KIDSMMABOY":        { sku:"EDS-KIT-KIDS-MMA-BOY",   desc:"Kids MMA Starter Pack Boys",                 supplier:"info@eagleds.co.nz" },
  "PRICE_ID_KIDSMMGIRL":        { sku:"EDS-KIT-KIDS-MMA-GIRL",  desc:"Kids MMA Starter Pack Girls",                supplier:"info@eagleds.co.nz" },
  "PRICE_ID_MMASTARTER":        { sku:"EDS-KIT-MMA-STD",         desc:"MMA Starter Pack",                           supplier:"info@eagleds.co.nz" },
  "PRICE_ID_MMAPREMBOY":        { sku:"EDS-KIT-MMA-PREM-BOY",   desc:"MMA Starter Pack Premium Boys",              supplier:"info@eagleds.co.nz" },
  "PRICE_ID_MMAPREEMGIRL":      { sku:"EDS-KIT-MMA-PREM-GIRL",  desc:"MMA Starter Pack Premium Girls",             supplier:"info@eagleds.co.nz" },
  "PRICE_ID_KBSTARTER":         { sku:"EDS-KIT-KB-STD",          desc:"Kickboxing Starter Pack",                    supplier:"info@eagleds.co.nz" },
  "PRICE_ID_KBMMA":             { sku:"EDS-KIT-KB-MMA",          desc:"Kickboxing & MMA Starter Pack",              supplier:"info@eagleds.co.nz" },
};

// ── WEBHOOK HANDLER ──────────────────────────────────────────
exports.stripeWebhook = onRequest(
  { secrets: [stripeSecret, webhookSecret, resendKey] },
  async (req, res) => {
    const stripe = new Stripe(stripeSecret.value());
    const resend = new Resend(resendKey.value());

    // Verify Stripe signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers["stripe-signature"],
        webhookSecret.value()
      );
    } catch (err) {
      console.error("Webhook signature failed:", err.message);
      return res.status(400).send("Webhook Error: " + err.message);
    }

    if (event.type !== "checkout.session.completed") {
      return res.json({ received: true });
    }

    const session = event.data.object;

    // Retrieve full session with line items + shipping
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items.data.price", "shipping_details"],
    });

    const shipping = fullSession.shipping_details?.address || {};
    const customerName = fullSession.customer_details?.name || "Customer";
    const customerEmail = fullSession.customer_details?.email || "";

    // Group line items by supplier
    const supplierOrders = {};
    for (const item of fullSession.line_items.data) {
      const priceId = item.price?.id;
      const skuEntry = SKU_MAP[priceId];
      if (!skuEntry) {
        console.warn("No SKU mapping for price ID:", priceId);
        continue;
      }
      const { sku, desc, supplier } = skuEntry;
      const size = item.price?.metadata?.size || "N/A";
      if (!supplierOrders[supplier]) supplierOrders[supplier] = [];
      supplierOrders[supplier].push({ sku, desc, qty: item.quantity, size });
    }

    // Fire one PO email per supplier
    for (const [supplierEmail, items] of Object.entries(supplierOrders)) {
      const itemBlock = items.map(i =>
        `SUPPLIER SKU:  ${i.sku}\nITEM DESC:     ${i.desc}\nSIZE:          ${i.size}\nQUANTITY:      ${i.qty}`
      ).join("\n\n---\n\n");

      const poBody = `
DEALER PROFILE: Eagle DS Combat Sport Training (Auckland, NZ)
ACCOUNT TYPE:   AUTHORISED DIGITAL RESELLER
DISPATCH TYPE:  DIRECT-TO-CONSUMER DROPSHIP

================================================
ORDER LINE ITEMS
================================================
${itemBlock}

================================================
SHIPPING DESTINATION (NEW ZEALAND RESIDENTIAL)
================================================
DELIVER TO:  ${customerName}
STREET 1:    ${shipping.line1 || ""}
STREET 2:    ${shipping.line2 || ""}
CITY:        ${shipping.city || ""}
POSTAL CODE: ${shipping.postal_code || ""}
COUNTRY:     New Zealand

================================================
FULFILMENT INSTRUCTIONS
================================================
Please pick, pack and dispatch directly to the residential address above.
Settle wholesale cost against the Eagle DS dealer account on file.

ORDER REF: ${session.id}
      `.trim();

      await resend.emails.send({
        from: "orders@eagleds.co.nz",
        to: supplierEmail,
        subject: `Eagle DS Dropship Order — ${session.id}`,
        text: poBody,
      });

      console.log("PO sent to", supplierEmail, "for", items.length, "item(s)");
    }

    // Send customer confirmation
    if (customerEmail) {
      const allItems = Object.values(supplierOrders).flat();
      await resend.emails.send({
        from: "orders@eagleds.co.nz",
        to: customerEmail,
        subject: "Your Eagle DS order is confirmed",
        html: `
<div style="background:#0a0a0a;color:#f8f4ee;padding:40px;font-family:DM Sans,sans-serif;max-width:560px;margin:0 auto;">
  <div style="font-family:Bebas Neue,sans-serif;font-size:28px;letter-spacing:3px;color:#C8960C;margin-bottom:4px;">EAGLE DS</div>
  <div style="font-family:monospace;font-size:10px;color:#666;letter-spacing:2px;margin-bottom:24px;border-bottom:1px solid #222;padding-bottom:12px;">ORDER CONFIRMED</div>
  <p style="font-size:14px;color:#888;line-height:1.7;margin-bottom:16px;">Hi ${customerName},</p>
  <p style="font-size:14px;color:#888;line-height:1.7;margin-bottom:20px;">Your order has been received and is being processed. Your gear will ship directly to you from our supplier.</p>
  <div style="background:#1a1a1a;padding:16px;margin-bottom:20px;">
    ${allItems.map(i=>`<div style="font-size:12px;color:#aaa;padding:4px 0;border-bottom:1px solid #222;">${i.desc} × ${i.qty} — Size: ${i.size}</div>`).join('')}
  </div>
  <p style="font-size:13px;color:#666;line-height:1.8;">Questions? Reply to this email or contact us at <a href="mailto:info@eagleds.co.nz" style="color:#C8960C;">info@eagleds.co.nz</a></p>
  <div style="margin-top:24px;font-family:monospace;font-size:9px;color:#444;border-top:1px solid #1a1a1a;padding-top:16px;">Eagle DS · 17 Nandina Ave, East Tāmaki · 021 902 471</div>
</div>`,
      });
    }

    res.json({ received: true });
  }
);

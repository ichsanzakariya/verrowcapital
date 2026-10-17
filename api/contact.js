// POST /api/contact — receives the website's forms (newsletter + consultation)
// and forwards them by email through Resend (https://resend.com).
//
// Environment variables (set them in the Vercel project settings):
//   RESEND_API_KEY  required — API key from https://resend.com/api-keys
//   CONTACT_EMAIL   required — inbox that should receive submissions
//   CONTACT_FROM    optional — verified sender, e.g.
//                   "Verrow Capital <site@verrowcapital.com>"
//                   (defaults to Resend's onboarding sender)
//
// If the variables are missing the endpoint answers honestly with a 501 so the
// site can show a real error instead of a fake success.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_EMAIL;
  if (!apiKey || !to) {
    // Not configured yet — say so instead of pretending the message was sent.
    return res.status(501).json({ error: "Email is not configured on this deployment" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (err) {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};

  const type = body.type === "consultation" ? "consultation" : "newsletter";
  const email = clean(body.email, 320);
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  let subject;
  let text;
  if (type === "consultation") {
    const name = clean(body.name, 200);
    if (!name) return res.status(400).json({ error: "Name is required" });
    const phone = clean(body.phone, 80);
    const service = clean(body.service, 200);
    const message = clean(body.message, 4000);
    subject = "Consultation request — " + name;
    text = [
      "New consultation request from verrowcapital.com",
      "",
      "Name: " + name,
      "Email: " + email,
      "Phone: " + (phone || "—"),
      "Service: " + (service || "—"),
      "",
      "Message:",
      message || "—",
    ].join("\n");
  } else {
    subject = "Newsletter signup — " + email;
    text = "New newsletter signup from verrowcapital.com: " + email;
  }

  try {
    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM || "Verrow Capital <onboarding@resend.dev>",
        to: [to],
        reply_to: email,
        subject: subject,
        text: text,
      }),
    });
    if (!upstream.ok) {
      console.error("Resend rejected the request", upstream.status, await upstream.text());
      return res.status(502).json({ error: "Email service rejected the request" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Contact endpoint failure", err);
    return res.status(500).json({ error: "Unexpected server error" });
  }
};

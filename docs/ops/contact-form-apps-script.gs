/**
 * Creatofolio: contact form -> your Gmail. Free, no server, no exposed address.
 *
 * The site's /api/forms/submit posts JSON here (the FORM_WEBHOOK_URL environment variable).
 * This script emails it to the Google account that owns the script, with
 * Reply-To set to the visitor's email, so "Reply" in Gmail answers them.
 *
 * Setup (about 5 minutes):
 *   1. script.google.com -> New project -> paste this file -> rename to "Contact form".
 *   2. Project Settings -> Script properties -> add SECRET = a long random string.
 *   3. Deploy -> New deployment -> Web app: Execute as "Me", Who has access "Anyone".
 *      Authorize (it asks to send email as you). Copy the Web app URL (ends in /exec).
 *   4. FORM_WEBHOOK_URL = <that URL>?k=<the same SECRET>  (your host's environment variables).
 */
function doPost(e) {
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || !e || !e.parameter || e.parameter.k !== secret) {
    return json_({ ok: false, error: "forbidden" });
  }
  var body = {};
  try {
    body = JSON.parse((e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "bad json" });
  }
  var fields = body.fields || {};
  var lines = [];
  Object.keys(fields).forEach(function (k) {
    lines.push(k + ": " + String(fields[k]).slice(0, 5000));
  });
  lines.push("");
  lines.push("Form: " + (body.form || "-") + "   Page: " + (body.pageUri || body.page || "-"));
  lines.push("Sent: " + (body.submittedAt || new Date().toISOString()));

  var visitorEmail = String(fields.email || fields.Email || "").trim();
  var name = String(fields.name || fields.Name || "").trim();
  var options = { name: "Creatofolio" };
  if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(visitorEmail)) options.replyTo = visitorEmail;

  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    "Hello from your site" + (name ? " — " + name : ""),
    lines.join("\n"),
    options
  );
  return json_({ ok: true });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

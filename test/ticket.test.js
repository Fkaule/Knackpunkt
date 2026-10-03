// Freischaltung: Ticket gültig, mit fremdem Schlüssel, verändert, für anderen Empfänger, abgelaufen
const test = require("node:test");
const assert = require("node:assert");
const TICKET = require("../src/ticket.js");

const b64 = b => Buffer.from(b).toString("base64url");
async function paar() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", k.publicKey);
  return { k, jwk: { kty, crv, x, y } };
}
async function ticket(k, inhalt) {
  const kopf = b64(JSON.stringify({ alg: "ES256", typ: "JWT" })), body = b64(JSON.stringify(inhalt));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.privateKey, new TextEncoder().encode(kopf + "." + body));
  return kopf + "." + body + "." + b64(new Uint8Array(sig));
}

test("Ticket: nur mit passendem Schlüssel, unverändert, für Knackpunkt und in der Frist", async () => {
  const { k, jwk } = await paar(), fremd = await paar(), jetzt = 1e9;
  const t = await ticket(k, { aud: "knackpunkt", name: "Fuchs", exp: jetzt + 60 });
  assert.strictEqual((await TICKET.pruefen(t, jetzt, jwk)).name, "Fuchs");
  assert.strictEqual(await TICKET.pruefen(t, jetzt, fremd.jwk), null);
  const [kopf, , sig] = t.split(".");
  const verlaengert = kopf + "." + b64(JSON.stringify({ aud: "knackpunkt", name: "Fuchs", exp: jetzt + 9e9 })) + "." + sig;
  assert.strictEqual(await TICKET.pruefen(verlaengert, jetzt, jwk), null);
  assert.strictEqual(await TICKET.pruefen(await ticket(k, { aud: "anderes", exp: jetzt + 60 }), jetzt, jwk), null);
  assert.strictEqual((await TICKET.pruefen(t, jetzt + 61, jwk)).abgelaufen, true);
  assert.strictEqual(await TICKET.pruefen(null, jetzt, jwk), null);
});

test("Ticket lesen (vor der Prüfung): Inhalt nur in der Frist", async () => {
  const { k } = await paar(), jetzt = 1e9;
  const t = await ticket(k, { aud: "knackpunkt", name: "Fuchs", exp: jetzt + 60 });
  assert.strictEqual(TICKET.lesen(t, jetzt).name, "Fuchs");
  assert.strictEqual(TICKET.lesen(t, jetzt + 61), null);
  assert.strictEqual(TICKET.lesen("kaputt"), null);
  assert.strictEqual(TICKET.lesen(null), null);
});

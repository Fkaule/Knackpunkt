/* Freischaltung über den FEM-Kurs Strukturmechanik: Wer dort alle Aufgaben aller Praktika bearbeitet hat,
   bekommt vom Kurs-Backend ein persönliches, befristetes Ticket (JWT, ES256). Geprüft wird es hier mit dem
   öffentlichen Schlüssel des Backends (GET /fem/api/kp/schluessel). Kein DOM. */
const TICKET = (() => {
  const SCHLUESSEL = { kty: 'EC', crv: 'P-256', x: 'zCk5eWh-df-PrmWK7UEoi_RcuqgoIuBpW0kMh0MJl_w', y: 'Nq5DlGE3JuLeYoUyT-_t0XyZZKiBscL2K6ejTMUtljg' };
  const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const json = s => JSON.parse(new TextDecoder().decode(bytes(s)));

  // Inhalt ohne Prüfung der Signatur, nur für den ersten Bildaufbau; null, wenn unlesbar oder abgelaufen
  function lesen(ticket, jetzt = Date.now() / 1000) {
    try {
      const p = json(String(ticket).split('.')[1]);
      return p.aud === 'knackpunkt' && p.exp > jetzt ? p : null;
    } catch { return null; }
  }
  // Inhalt, wenn die Signatur stimmt (nach Ablauf mit abgelaufen: true), sonst null
  async function pruefen(ticket, jetzt = Date.now() / 1000, schluessel = SCHLUESSEL) {
    try {
      const [kopf, inhalt, sig] = String(ticket).split('.');
      if (json(kopf).alg !== 'ES256') return null;
      const key = await crypto.subtle.importKey('jwk', schluessel, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(sig),
        new TextEncoder().encode(kopf + '.' + inhalt));
      const p = json(inhalt);
      if (!ok || p.aud !== 'knackpunkt') return null;
      return p.exp > jetzt ? p : { ...p, abgelaufen: true };
    } catch { return null; }
  }

  return { lesen, pruefen };
})();
if (typeof module !== 'undefined') module.exports = TICKET;

#!/usr/bin/env node
/* Erzeugt zwei zufällige 32-Byte-Schlüssel (base64) für MASTER_KEY und HMAC_KEY.
 * Ausgabe direkt in `wrangler secret put` geben, nicht in Chats/Tickets/Repo kopieren.
 * Den MASTER_KEY zusätzlich offline sicher verwahren (z. B. Passwort-Tresor): ohne ihn sind alle Belege unlesbar. */
const k = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
console.log('MASTER_KEY=' + k());
console.log('HMAC_KEY=' + k());

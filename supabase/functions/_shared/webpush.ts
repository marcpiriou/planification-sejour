// Envoi Web Push : chiffrement du message (RFC 8291, « aes128gcm ») et
// signature VAPID (RFC 8292), en WebCrypto seul.
//
// Pourquoi pas la bibliothèque `web-push` : elle s'appuie sur le module
// `crypto` de Node (ECDH, chiffrement par flux) et sur `https.request`, que le
// runtime Deno des Edge Functions n'émule qu'en partie. WebCrypto y est natif,
// comme dans Node 22 où ce module se teste tel quel. Le protocole tient en
// quelques dérivations de clés : mieux vaut les avoir sous les yeux qu'une
// dépendance dont on ne contrôle pas le comportement en production.

export type Abonnement = { endpoint: string; p256dh: string; auth: string };
export type ClesVapid = { publique: string; privee: string };

const enc = new TextEncoder();

export function b64url(octets: Uint8Array): string {
  let s = "";
  for (const o of octets) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deB64url(texte: string): Uint8Array {
  const b64 = texte.replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hkdf(sel: Uint8Array, ikm: Uint8Array, info: Uint8Array, octets: number): Promise<Uint8Array> {
  const cle = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sel, info }, cle, octets * 8);
  return new Uint8Array(bits);
}

// Paire VAPID neuve : la clé publique au format brut non compressé (65
// octets), celle que le navigateur attend dans `applicationServerKey` ; la
// privée réduite à son scalaire (32 octets). Les deux en base64url.
export async function genereClesVapid(): Promise<ClesVapid> {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
  const publique = concat(new Uint8Array([4]), deB64url(jwk.x!), deB64url(jwk.y!));
  return { publique: b64url(publique), privee: jwk.d! };
}

// Jeton VAPID : il prouve au service de push (Google, Apple, Mozilla) que
// l'envoi vient du serveur dont la clé publique a servi à l'abonnement.
// `sub` est un contact exigé par le protocole ; Apple refuse un envoi sans lui.
async function jetonVapid(endpoint: string, cles: ClesVapid, contact: string): Promise<string> {
  const pub = deB64url(cles.publique);
  const cle = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: cles.privee,
    x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)),
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const entete = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const charge = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: contact,
  })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cle, enc.encode(`${entete}.${charge}`));
  return `${entete}.${charge}.${b64url(new Uint8Array(signature))}`;
}

// Corps chiffré pour UN abonnement (RFC 8291 §3-4). Chaque message a sa propre
// paire éphémère et son propre sel : rien n'est réutilisé d'un envoi à l'autre.
export async function chiffre(abo: Abonnement, message: Uint8Array): Promise<Uint8Array> {
  const uaPublique = deB64url(abo.p256dh);
  const secretAuth = deB64url(abo.auth);
  const ephemere = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublique = new Uint8Array(await crypto.subtle.exportKey("raw", ephemere.publicKey));
  const uaCle = await crypto.subtle.importKey("raw", uaPublique, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaCle }, ephemere.privateKey, 256));

  const ikm = await hkdf(secretAuth, partage, concat(enc.encode("WebPush: info\0"), uaPublique, asPublique), 32);
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sel, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sel, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // Un seul enregistrement, terminé par le délimiteur 0x02, sans remplissage.
  const cleAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce },
    cleAes, concat(message, new Uint8Array([2]))));

  // En-tête : sel, taille d'enregistrement (4096), puis la clé éphémère.
  const rs = new Uint8Array([0, 0, 0x10, 0]);
  return concat(sel, rs, new Uint8Array([asPublique.length]), asPublique, chiffre);
}

export type Resultat = { endpoint: string; statut: number; ok: boolean; expire: boolean };

// Envoie un message à un abonnement. `expire` dit que le navigateur a résilié
// l'abonnement (404 ou 410) : il faut l'oublier, il ne servira plus jamais.
// `ttl` borne la durée de garde par le service de push si le téléphone est
// injoignable : un rappel arrivé après l'étape n'a plus de sens.
export async function envoie(
  abo: Abonnement, charge: unknown, cles: ClesVapid, contact: string, ttl = 900,
): Promise<Resultat> {
  try {
    const corps = await chiffre(abo, enc.encode(JSON.stringify(charge)));
    const jeton = await jetonVapid(abo.endpoint, cles, contact);
    const rep = await fetch(abo.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": String(ttl),
        "Urgency": "high",
        "Authorization": `vapid t=${jeton}, k=${cles.publique}`,
      },
      body: corps,
    });
    await rep.body?.cancel();
    return { endpoint: abo.endpoint, statut: rep.status, ok: rep.ok, expire: rep.status === 404 || rep.status === 410 };
  } catch (e) {
    console.error("push", abo.endpoint.slice(0, 60), String(e));
    return { endpoint: abo.endpoint, statut: 0, ok: false, expire: false };
  }
}

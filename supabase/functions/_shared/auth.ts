// Exige une session UTILISATEUR, et non la simple clé publique de l'application.
//
// `verify_jwt` ne suffisait pas : la passerelle Supabase accepte aussi la clé
// publiable du bundle (`sb_publishable_…`) comme jeton. Or cette clé est lisible
// par quiconque ouvre le site — les quatre fonctions, et donc le quota Google
// qu'elles consomment, étaient appelables par n'importe qui, sans compte.
//
// Ce qu'on peut tenir pour acquis ici : la passerelle a déjà VÉRIFIÉ LA
// SIGNATURE du jeton — un JWT forgé est refusé en 401 avant d'arriver jusqu'à
// cette fonction. Il ne reste donc qu'à distinguer une session d'utilisateur
// d'une clé d'API, ce que fait la seule lecture des revendications, sans appel
// réseau ni secret supplémentaire :
//   • une clé d'API récente (`sb_publishable_…`, `sb_secret_…`) n'a pas la forme
//     d'un JWT — trois segments — et tombe d'emblée ;
//   • une clé anon ou service_role au format JWT hérité porte `role=anon` ou
//     `role=service_role`, jamais `role=authenticated`.
//
// Côté client, supabase-js place le JWT de l'utilisateur connecté dans
// Authorization et n'y met jamais la clé publique (option `omitApiKeyAsBearer`
// appliquée aux Edge Functions) : un appel légitime de l'application passe donc,
// un appel sans session est refusé.

export type Utilisateur = { id: string };

// Charge utile d'un JWT, sans vérifier la signature : c'est la passerelle qui
// s'en est chargée. Base64URL, dont le remplissage « = » est optionnel.
function revendications(jeton: string): Record<string, unknown> | null {
  const parts = jeton.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const charge = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    return charge && typeof charge === "object" ? charge as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// L'utilisateur derrière la requête, ou null si l'appel ne vient pas d'une
// session ouverte.
export function utilisateurConnecte(req: Request): Utilisateur | null {
  const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jeton) return null;
  const c = revendications(jeton);
  if (!c || c.role !== "authenticated") return null;
  const sub = typeof c.sub === "string" ? c.sub.trim() : "";
  if (!sub) return null;
  // Expiration : la passerelle la contrôle déjà, on ne s'en remet pas à elle seule.
  const exp = typeof c.exp === "number" ? c.exp : 0;
  if (exp && exp * 1000 <= Date.now()) return null;
  return { id: sub };
}

// Refus uniforme. Le corps reste vague : il n'y a rien à apprendre à un appelant
// qui n'est pas authentifié.
export function refusAuth(cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "authentification requise" }), {
    status: 401,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

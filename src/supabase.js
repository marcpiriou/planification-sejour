import { createClient } from "@supabase/supabase-js";

// URL et clé "publishable" du projet Supabase.
// Ces valeurs sont publiques par conception (protégées par la RLS côté base) ;
// on les laisse en secours pour que le site déployé fonctionne sans configuration d'env.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://awmtajjbwgrechzmhorr.supabase.co";
const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_I8Uk5Co7EXPNZzxvFPbDHw_MEDQG5Hc";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// URL de redirection pour le lien magique : fonctionne en dev (/) comme en prod (/planification-sejour/).
export const redirectTo =
  typeof window !== "undefined"
    ? window.location.origin + import.meta.env.BASE_URL
    : undefined;

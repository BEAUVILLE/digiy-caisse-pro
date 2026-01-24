/* =========================
   DIGIY GUARD — UNIVERSAL
   Slug + PIN → owner_id → Session 8h
========================= */
(function () {
  "use strict";

  // =============================
  // SUPABASE
  // =============================
  const SUPABASE_URL = "https://wesqmwjjtsefyjnluosj.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indlc3Ftd2pqdHNlZnlqbmx1b3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxNzg4ODIsImV4cCI6MjA4MDc1NDg4Mn0.dZfYOc2iL2_wRYL3zExZFsFSBK6AbMeOid2LrIjcTdA";

  const SESSION_KEY = "DIGIY_SESSION";
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

  function now() { return Date.now(); }

  // =============================
  // SESSION
  // =============================
  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const s = JSON.parse(raw);
      if (!s || !s.expires_at || now() > s.expires_at) return null;
      return s;
    } catch {
      return null;
    }
  }

  function setSession(data) {
    const session = {
      ...data,
      created_at: now(),
      expires_at: now() + SESSION_TTL_MS
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  // =============================
  // SUPABASE
  // =============================
  function getSb() {
    if (!window.supabase?.createClient) return null;
    if (!window.__digiy_sb__) {
      window.__digiy_sb__ = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return window.__digiy_sb__;
  }

  // =============================
  // LOGIN AVEC SLUG + PIN
  // =============================
  async function loginWithPin(slug, pin) {
    const sb = getSb();
    if (!sb) return { ok: false, error: "Supabase non initialisé" };

    slug = (slug || "").trim();
    pin = (pin || "").trim();

    if (!slug || !pin) return { ok: false, error: "Slug et PIN requis" };

    // ✅ Appel RPC verify_access_pin(slug, pin)
    const { data, error } = await sb.rpc("verify_access_pin", {
      p_slug: slug,
      p_pin: pin
    });

    if (error) return { ok: false, error: error.message };

    // Parse si string JSON
    const result = typeof data === "string" ? JSON.parse(data) : data;

    if (!result?.ok || !result?.owner_id) {
      return { ok: false, error: result?.error || "PIN invalide" };
    }

    // ✅ STOCKER owner_id + infos en session
    const session = setSession({
      ok: true,
      owner_id: result.owner_id,
      slug: result.slug,
      title: result.title,
      phone: result.phone
    });

    return { ok: true, session };
  }

  // =============================
  // PROTECTION DE PAGE
  // =============================
function getSlugFromUrl(){
  try { return (new URL(location.href)).searchParams.get("slug"); } catch { return null; }
}

function getStickySlug(){
  const u = (getSlugFromUrl() || "").trim();
  if(u) {
    sessionStorage.setItem("DIGIY_LAST_SLUG", u);
    return u;
  }
  return (sessionStorage.getItem("DIGIY_LAST_SLUG") || "").trim();
}

function withSlug(url){
  const slug = getStickySlug();
  if(!slug) return url;
  return url.includes("?")
    ? url + "&slug=" + encodeURIComponent(slug)
    : url + "?slug=" + encodeURIComponent(slug);
}
   
function requireSession(redirect = "pin.html") {
  const s = getSession();
  if (!s || !s.owner_id) {
    location.replace(withSlug(redirect));
    return null;
  }
  return s;
}


  // =============================
  // BOOT (pour index.html)
  // =============================
  async function boot(options) {
    const redirect = options?.login || "pin.html";
    const s = requireSession(redirect);
    
    if (!s) return { ok: false };
    
    return { 
      ok: true, 
      session: s 
    };
  }

  // =============================
  // LOGOUT
  // =============================
  function logout(redirect = "index.html") {
  clearSession();
  location.replace(withSlug(redirect));
}


  // =============================
  // EXPORT
  // =============================
  window.DIGIY_GUARD = {
    boot,
    loginWithPin,
    requireSession,
    logout,
    getSession,
    getSb
  };

})();

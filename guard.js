/* =========================
   DIGIY GUARD — UNIVERSAL (CAISSE PRO)
   Slug + PIN → token 30j → Session locale
   + Refresh silencieux
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
  const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours local

  function nowMs() { return Date.now(); }

  // =============================
  // SLUG sticky
  // =============================
  function getSlugFromUrl(){
    try { return (new URL(location.href)).searchParams.get("slug"); } catch { return null; }
  }

  function touchSlug(){
    const u = (getSlugFromUrl() || "").trim();
    if(u) sessionStorage.setItem("DIGIY_LAST_SLUG", u);
    return u;
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

  function go(url, mode){
    // mode="assign" => conserve slug dans l’URL (et fixe sticky)
    if(mode === "assign"){
      const target = withSlug(url);
      touchSlug();
      location.href = target;
      return;
    }
    location.href = url;
  }

  // =============================
  // SESSION
  // =============================
  function safeParse(raw){
    try { return JSON.parse(raw); } catch { return null; }
  }

  function getSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = safeParse(raw);
    if (!s || !s.local_expires_at) return null;

    // TTL local
    if (nowMs() > Number(s.local_expires_at || 0)) return null;

    // TTL serveur (si connu)
    // server_expires_at peut être ISO ou timestamp → on gère les 2
    if (s.server_expires_at) {
      const t = typeof s.server_expires_at === "number"
        ? s.server_expires_at
        : Date.parse(String(s.server_expires_at));
      if (Number.isFinite(t) && nowMs() > t) return null;
    }

    // basics
    if(!s.owner_id || !s.slug || !s.token) return null;

    return s;
  }

  function setSession(data) {
    const session = {
      ...data,
      created_at: nowMs(),
      local_expires_at: nowMs() + SESSION_TTL_MS
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function updateSession(patch){
    const s = getSession();
    if(!s) return null;
    const next = { ...s, ...patch };
    // IMPORTANT : on ne touche pas local_expires_at ici
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    return next;
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
  // LOGIN SLUG + PIN -> TOKEN
  // =============================
  async function loginWithPin(slug, pin) {
    const sb = getSb();
    if (!sb) return { ok: false, error: "Supabase non initialisé (charge supabase-js avant guard.js)" };

    slug = (slug || "").trim();
    pin  = (pin  || "").trim();
    if (!slug || !pin) return { ok: false, error: "Slug et PIN requis" };

    const { data, error } = await sb.rpc("caisse_issue_token_v1", {
      p_slug: slug,
      p_pin: pin
    });

    if (error) return { ok: false, error: error.message };

    const result = (typeof data === "string") ? safeParse(data) : data;

    if (!result?.ok || !result?.owner_id || !result?.token) {
      return { ok: false, error: result?.error || "PIN invalide" };
    }

    // server expires : garde tel quel
    const session = setSession({
      ok: true,
      owner_id: result.owner_id,
      slug: result.slug,
      title: result.title,
      phone: result.phone,
      token: result.token,
      server_expires_at: result.expires_at || null
    });

    // sticky slug
    if(session?.slug) sessionStorage.setItem("DIGIY_LAST_SLUG", String(session.slug));

    return { ok: true, session };
  }

  // =============================
  // REFRESH TOKEN (silencieux)
  // =============================
  async function refreshTokenIfNeeded() {
    const sb = getSb();
    if (!sb) return { ok: false, error: "no_sb" };

    const s = getSession();
    if (!s?.token) return { ok: false, error: "no_session" };

    try{
      const { data, error } = await sb.rpc("caisse_refresh_token_v1", { p_token: s.token });
      if (error) return { ok: false, error: error.message };

      const r = (typeof data === "string") ? safeParse(data) : data;
      if (r?.ok && (r.expires_at || r.server_expires_at)) {
        updateSession({ server_expires_at: r.expires_at || r.server_expires_at });
      }
      return r || { ok: true };
    }catch(e){
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // =============================
  // PROTECTION DE PAGE
  // =============================
  function requireSession(redirect = "pin.html") {
    const s = getSession();
    if (!s) {
      location.replace(withSlug(redirect));
      return null;
    }
    return s;
  }

  // =============================
  // BOOT
  // =============================
  async function boot(options) {
    const redirect = options?.login || "pin.html";
    const s = requireSession(redirect);
    if (!s) return { ok: false };

    // refresh silencieux (ne bloque pas l’UI)
    // on le lance seulement si Supabase est dispo
    if (getSb()) refreshTokenIfNeeded();

    return { ok: true, session: s };
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
    getSb,
    go,
    withSlug
  };

})();

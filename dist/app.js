const config = window.WM_CONFIG || {};
const isDemo = new URLSearchParams(location.search).get("demo") === "1";
const isConfigured = Boolean(config.supabaseUrl && config.supabasePublishableKey && !config.supabasePublishableKey.startsWith("__"));
let supabase = null;
let currentUser = null;
let currentProfile = null;
let currentData = { stays: [], activities: [], ledger: [], requests: [], claims: [] };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const formatDate = (value) => value ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "À confirmer";
const authError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid login credentials")) return "Adresse e-mail ou mot de passe incorrect.";
  if (message.includes("email not confirmed")) return "Confirmez d’abord votre adresse e-mail grâce au message reçu.";
  if (message.includes("user already registered")) return "Un compte existe déjà avec cette adresse e-mail.";
  if (message.includes("password should be")) return "Choisissez un mot de passe d’au moins 8 caractères.";
  if (message.includes("rate limit") || message.includes("too many requests")) return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  if (message.includes("network") || message.includes("fetch")) return "Connexion au service momentanément impossible. Vérifiez votre réseau.";
  return error?.message || "Une erreur est survenue. Réessayez dans un instant.";
};

const rewardCatalog = [
  { code: "activity-10", points: 150, title: "10 € sur une activité", detail: "À utiliser sur une location de vélo ou une expérience surf." },
  { code: "welcome-rooftop", points: 250, title: "Pause au rooftop", detail: "Deux boissons offertes au rooftop café-restaurant." },
  { code: "room-attention", points: 450, title: "Attention en chambre", detail: "Une surprise préparée par l'équipe avant votre arrivée." },
  { code: "partner-experience", points: 750, title: "Expérience partenaire", detail: "Spa, piscine ou expérience locale, selon disponibilité." },
  { code: "free-night-request", points: 1500, title: "Demande de nuitée", detail: "Une nuitée offerte sur certaines dates et catégories." },
];

const demoData = {
  user: { id: "demo-user", email: "voyageur@exemple.com", user_metadata: { full_name: "Samira" } },
  profile: { full_name: "Samira", phone: "+212 6 00 00 00 00", birthday: "1992-08-14", marketing_opt_in: true },
  stays: [{ id: "s1", reference: "WM-2481", property_name: "White Majorelle Horizon", check_in: "2026-12-18", check_out: "2026-12-22", guests: 2, status: "confirmed", source: "direct", direct_booking: true }],
  activities: [{ id: "a1", reference: "ACT-3812", activity_type: "surf", activity_date: "2026-12-20", quantity: 2, periods: 1, payment_status: "paid" }],
  ledger: [{ id: "l1", points: 680, reason: "Séjour direct confirmé" }],
  requests: [], claims: [],
};

function toast(message, status = "success") {
  const node = $("#toast");
  node.textContent = message;
  node.dataset.status = status;
  node.classList.add("is-visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("is-visible"), 4200);
}

function authMessage(message = "", status = "error") {
  const node = $("#auth-message");
  node.textContent = message;
  node.dataset.status = status;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent.trim();
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  const recovery = mode === "recovery";
  $$(".auth-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === mode));
  $("#name-field").classList.toggle("is-hidden", mode !== "signup");
  $("#password-confirm-field").classList.toggle("is-hidden", mode === "login");
  $("#consent-field").classList.toggle("is-hidden", mode !== "signup");
  $("#email-field").classList.toggle("is-hidden", recovery);
  $("#auth-tabs").classList.toggle("is-hidden", recovery);
  $("#google-button").classList.toggle("is-hidden", recovery);
  $("#auth-separator").classList.toggle("is-hidden", recovery);
  $("#forgot-password").classList.toggle("is-hidden", mode !== "login");
  $("#auth-title").textContent = recovery ? "Choisissez un nouveau mot de passe." : mode === "signup" ? "Rejoignez le Club Majorelle." : "Bon retour parmi nous.";
  $("#auth-subtitle").textContent = recovery ? "Utilisez au moins 8 caractères pour protéger votre espace." : mode === "signup" ? "Créez votre espace en moins d'une minute." : "Connectez-vous pour retrouver votre séjour.";
  $("#auth-submit").textContent = recovery ? "Enregistrer le mot de passe" : mode === "signup" ? "Créer mon espace" : "Se connecter";
  $("#password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#password-confirm").required = mode !== "login";
  $("#password-confirm").value = "";
  authMessage();
}

function showAuth() {
  $("#dashboard-view").classList.add("is-hidden");
  $("#auth-view").classList.remove("is-hidden");
}

function showDashboard() {
  $("#auth-view").classList.add("is-hidden");
  $("#dashboard-view").classList.remove("is-hidden");
}

function firstName() {
  const name = currentProfile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email?.split("@")[0] || "voyageur";
  return name.trim().split(/\s+/)[0];
}

function pointsTotal() {
  return currentData.ledger.reduce((total, entry) => total + Number(entry.points || 0), 0) - currentData.claims.filter((claim) => ["requested", "approved"].includes(claim.status)).reduce((total, claim) => total + Number(claim.points_cost || 0), 0);
}

function tierFor(points) {
  if (points >= 1500) return { label: "Majorelle", progress: 100, copy: "Votre statut le plus exclusif est actif." };
  if (points >= 500) return { label: "Azul", progress: Math.round(((points - 500) / 1000) * 100), copy: `${1500 - points} points avant le niveau Majorelle.` };
  return { label: "Explorateur", progress: Math.round((points / 500) * 100), copy: `${500 - points} points avant le niveau Azul.` };
}

function renderStays() {
  const list = $("#stays-list");
  if (!currentData.stays.length) {
    list.innerHTML = '<article class="empty-card"><div><span>01</span><h3>Aucune réservation associée</h3><p>Réservez directement ou rattachez la référence reçue après votre réservation.</p></div></article>';
    return;
  }
  list.innerHTML = currentData.stays.map((stay) => `<article class="data-card"><header><span>Séjour</span><em class="status">${esc(stay.status === "confirmed" ? "Confirmé" : stay.status)}</em></header><h3>${esc(stay.property_name || "White Majorelle")}</h3><p><strong>${formatDate(stay.check_in)}</strong>${stay.check_out ? ` → ${formatDate(stay.check_out)}` : ""}</p><dl><div><dt>Référence</dt><dd>${esc(stay.reference)}</dd></div><div><dt>Voyageurs</dt><dd>${esc(stay.guests || "À confirmer")}</dd></div></dl></article>`).join("");
}

function renderActivities() {
  const list = $("#activities-list");
  if (!currentData.activities.length) {
    list.innerHTML = '<article class="empty-card"><div><span>02</span><h3>Aucune activité réservée</h3><p>Vos prochaines locations de vélo et expériences surf apparaîtront ici.</p></div></article>';
    return;
  }
  list.innerHTML = currentData.activities.map((activity) => `<article class="data-card"><header><span>Activité</span><em class="status">${esc(activity.payment_status === "paid" ? "Payé" : activity.payment_status)}</em></header><h3>${activity.activity_type === "bike" ? "Location de vélo" : "Planche & cours de surf"}</h3><p><strong>${formatDate(activity.activity_date)}</strong></p><dl><div><dt>Référence</dt><dd>${esc(activity.reference)}</dd></div><div><dt>Quantité</dt><dd>${esc(activity.quantity || 1)}</dd></div></dl></article>`).join("");
}

function renderRewards() {
  const points = Math.max(pointsTotal(), 0);
  $("#rewards-list").innerHTML = rewardCatalog.map((reward) => {
    const claim = currentData.claims.find((item) => item.reward_code === reward.code && ["requested", "approved", "fulfilled"].includes(item.status));
    const disabled = points < reward.points || Boolean(claim);
    return `<article class="reward-card"><span>${reward.points.toLocaleString("fr-FR")} pts</span><h3>${esc(reward.title)}</h3><p>${esc(reward.detail)}</p><button type="button" data-claim="${esc(reward.code)}" ${disabled ? "disabled" : ""}>${claim ? "Demande enregistrée ✓" : points < reward.points ? "Points insuffisants" : "Utiliser mes points"}</button></article>`;
  }).join("");
}

function renderDashboard() {
  const now = new Date();
  $("#today-label").textContent = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(now);
  $("#welcome-title").textContent = `Bonjour, ${firstName()}.`;
  const nextStay = [...currentData.stays].filter((stay) => !stay.check_in || new Date(`${stay.check_in}T23:59:59`) >= now).sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)))[0];
  if (nextStay) {
    $("#next-stay-title").textContent = nextStay.property_name || "White Majorelle";
    $("#next-stay-copy").textContent = `${formatDate(nextStay.check_in)}${nextStay.check_out ? ` → ${formatDate(nextStay.check_out)}` : ""} · ${nextStay.guests || 1} voyageur${Number(nextStay.guests || 1) > 1 ? "s" : ""}.`;
  }
  const points = Math.max(pointsTotal(), 0);
  const tier = tierFor(points);
  $("#tier-label").textContent = `Niveau ${tier.label}`;
  $("#points-value").textContent = points.toLocaleString("fr-FR");
  $("#points-progress").style.width = `${Math.min(tier.progress, 100)}%`;
  $("#points-copy").textContent = tier.copy;
  renderStays(); renderActivities(); renderRewards();
  const profileForm = $("#profile-form");
  profileForm.fullName.value = currentProfile?.full_name || currentUser?.user_metadata?.full_name || "";
  profileForm.phone.value = currentProfile?.phone || "";
  profileForm.birthday.value = currentProfile?.birthday || "";
  profileForm.marketingOptIn.checked = Boolean(currentProfile?.marketing_opt_in);
  showDashboard();
}

async function fetchTable(table, columns = "*") {
  const { data, error } = await supabase.from(table).select(columns).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadPortalData(user) {
  currentUser = user;
  if (isDemo) {
    currentProfile = demoData.profile;
    currentData = { stays: demoData.stays, activities: demoData.activities, ledger: demoData.ledger, requests: demoData.requests, claims: demoData.claims };
    renderDashboard(); return;
  }
  const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (profileError) throw profileError;
  currentProfile = profile || { full_name: user.user_metadata?.full_name || "", phone: "", birthday: "", marketing_opt_in: false };
  const results = await Promise.allSettled([fetchTable("reservations"), fetchTable("activity_bookings"), fetchTable("loyalty_ledger"), fetchTable("special_requests"), fetchTable("reward_claims")]);
  const values = results.map((result) => result.status === "fulfilled" ? result.value : []);
  currentData = { stays: values[0], activities: values[1], ledger: values[2], requests: values[3], claims: values[4] };
  renderDashboard();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!isConfigured) return authMessage("La connexion Supabase est en cours de finalisation. Réessayez dans quelques instants.");
  const button = $("#auth-submit");
  const email = $("#email").value.trim().toLowerCase();
  const password = $("#password").value;
  const passwordConfirm = $("#password-confirm").value;
  if ((authMode !== "recovery" && !email) || password.length < 8) return authMessage("Saisissez une adresse valide et un mot de passe de 8 caractères minimum.");
  if (authMode !== "login" && password !== passwordConfirm) return authMessage("Les deux mots de passe ne sont pas identiques.");
  setBusy(button, true, authMode === "recovery" ? "Enregistrement…" : authMode === "signup" ? "Création…" : "Connexion…"); authMessage();
  try {
    if (authMode === "recovery") {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast("Votre nouveau mot de passe est enregistré.");
      await loadPortalData(data.user);
    } else if (authMode === "signup") {
      const fullName = $("#full-name").value.trim();
      if (!fullName) throw new Error("Indiquez votre nom complet.");
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback`, data: { full_name: fullName, marketing_opt_in: $("#club-consent").checked } } });
      if (error) throw error;
      if (!data.session) authMessage("Votre compte est créé. Consultez votre e-mail pour confirmer l'inscription.", "success");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) { authMessage(authError(error)); }
  finally { setBusy(button, false); }
}

async function signInWithGoogle() {
  if (!isConfigured) return authMessage("La connexion Supabase est en cours de finalisation.");
  const button = $("#google-button"); setBusy(button, true, "Redirection vers Google…");
  const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { access_type: "offline", prompt: "select_account" } } });
  if (error) { authMessage(authError(error)); setBusy(button, false); }
}

async function resetPassword() {
  const email = $("#email").value.trim().toLowerCase();
  if (!email) return authMessage("Saisissez d'abord votre adresse e-mail.");
  if (!isConfigured) return authMessage("La connexion Supabase est en cours de finalisation.");
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?type=recovery` });
  authMessage(error ? authError(error) : "Un lien de réinitialisation vient de vous être envoyé.", error ? "error" : "success");
}

function navigate(section) {
  $$(".dashboard-section").forEach((node) => node.classList.toggle("is-active", node.id === `section-${section}`));
  $$(".nav-item").forEach((node) => node.classList.toggle("is-active", node.dataset.section === section));
  $(".sidebar").classList.remove("is-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveProfile(event) {
  event.preventDefault();
  if (isDemo) return toast("Mode démonstration : vos préférences sont prêtes à être enregistrées.");
  const form = new FormData(event.currentTarget);
  const payload = { full_name: form.get("fullName")?.toString().trim() || null, phone: form.get("phone")?.toString().trim() || null, birthday: form.get("birthday") || null, marketing_opt_in: form.get("marketingOptIn") === "on" };
  const { data, error } = await supabase.from("profiles").update(payload).eq("id", currentUser.id).select().single();
  if (error) return toast(error.message, "error");
  currentProfile = data; toast("Vos préférences ont été enregistrées."); renderDashboard();
}

async function linkStay(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (isDemo) { event.currentTarget.reset(); return toast("Demande de rattachement envoyée en mode démonstration."); }
  const payload = { user_id: currentUser.id, reference: form.get("reference")?.toString().trim().toUpperCase(), check_in: form.get("checkIn"), accommodation: form.get("accommodation"), status: "pending" };
  const { error } = await supabase.from("reservation_link_requests").insert(payload);
  if (error) return toast(error.message, "error");
  event.currentTarget.reset(); toast("Votre réservation a été transmise pour vérification.");
}

async function submitRequest(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (isDemo) { $("#request-dialog").close(); event.currentTarget.reset(); return toast("Votre demande spéciale a été enregistrée en mode démonstration."); }
  const payload = { user_id: currentUser.id, request_type: form.get("requestType"), event_date: form.get("eventDate") || null, guest_count: Number(form.get("guestCount") || 2), message: form.get("message")?.toString().trim() || null, status: "received" };
  const { error } = await supabase.from("special_requests").insert(payload);
  if (error) return toast(error.message, "error");
  $("#request-dialog").close(); event.currentTarget.reset(); toast("Votre demande a été transmise à l'équipe White Majorelle.");
}

async function claimReward(code) {
  const reward = rewardCatalog.find((item) => item.code === code);
  if (!reward) return;
  if (isDemo) return toast(`Demande « ${reward.title} » enregistrée en mode démonstration.`);
  const { error } = await supabase.rpc("claim_reward", { p_reward_code: code });
  if (error) return toast(error.message, "error");
  currentData.claims = await fetchTable("reward_claims"); renderRewards(); toast("Votre demande d'avantage a été enregistrée.");
}

function bindUi() {
  $$(".auth-tab").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $("#google-button").addEventListener("click", signInWithGoogle);
  $("#forgot-password").addEventListener("click", resetPassword);
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.section)));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  $$('[data-open-request]').forEach((button) => button.addEventListener("click", () => $("#request-dialog").showModal()));
  $("#close-request").addEventListener("click", () => $("#request-dialog").close());
  $("#mobile-menu").addEventListener("click", () => $(".sidebar").classList.toggle("is-open"));
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#link-stay-form").addEventListener("submit", linkStay);
  $("#request-form").addEventListener("submit", submitRequest);
  $("#rewards-list").addEventListener("click", (event) => { const button = event.target.closest("[data-claim]"); if (button) claimReward(button.dataset.claim); });
  $("#signout-button").addEventListener("click", async () => { if (!isDemo && supabase) await supabase.auth.signOut(); currentUser = null; currentProfile = null; showAuth(); });
}

async function init() {
  bindUi();
  if (isDemo) { currentUser = demoData.user; await loadPortalData(currentUser); return; }
  if (!isConfigured) { showAuth(); authMessage("Configuration sécurisée en cours. Le portail sera ouvert dès l'installation de la clé publique Supabase."); return; }
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });
    const recoveryRequested = new URLSearchParams(location.search).get("type") === "recovery" || location.hash.includes("type=recovery");
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { setAuthMode("recovery"); showAuth(); toast("Choisissez maintenant votre nouveau mot de passe."); return; }
      if (event === "SIGNED_IN" && session?.user && authMode !== "recovery" && session.user.id !== currentUser?.id) loadPortalData(session.user).catch((error) => toast(authError(error), "error"));
      if (event === "SIGNED_OUT") showAuth();
    });
    const { data: { session } } = await supabase.auth.getSession();
    if (recoveryRequested) { setAuthMode("recovery"); showAuth(); }
    else if (session?.user) await loadPortalData(session.user);
    else showAuth();
  } catch (error) { showAuth(); authMessage("Le service de connexion est momentanément indisponible."); }
}

init();

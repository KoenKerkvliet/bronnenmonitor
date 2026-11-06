// Dashboard van de bronnenmonitor. Plain JavaScript + supabase-js, geen build-stap.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const PAGE_SIZE = 50;
const CATEGORY_LABELS = { onderwijs: "Onderwijs", webdesign: "Webdesign & tools" };
const STATUS_TITLES = { "": "Alle berichten", unread: "Ongelezen", saved: "Favorieten", urgent: "Urgent" };
const FETCH_HOURS_UTC = [5, 11, 17]; // moet gelijk zijn aan de cron in .github/workflows/fetch.yml
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

const $ = (sel) => document.querySelector(sel);
const state = {
  view: "items",
  sources: [],
  stats: [],      // alle items, alleen id/source_id/is_read: voor de tellers
  items: [],      // de items die nu getoond worden
  offset: 0,
  total: 0,
  filters: { status: "", category: "", source: "", tag: "", q: "" },
};
let sb;

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

/** Maakt een element met attributen en kinderen. Tekst gaat altijd via textContent (veilig). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Klein SVG-icoon (vaste, eigen paden — geen invoer van buiten). */
function icon(name, size = 15) {
  const paths = {
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
  };
  const span = document.createElement("span");
  span.style.display = "grid";
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${name === "star" ? 1.8 : 2.2}" stroke-linejoin="round">${paths[name]}</svg>`;
  return span;
}

const safeUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : null);
const categoryLabel = (cat) => CATEGORY_LABELS[cat] || (cat ? cat[0].toUpperCase() + cat.slice(1) : "");
const toList = (text) => text.split(",").map((s) => s.trim()).filter(Boolean);

function shortDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function clock(date) {
  return date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a, b) {
  return a.toDateString() === b.toDateString();
}

function whenLabel(date) {
  if (!date) return "nog niet";
  if (sameDay(date, new Date())) return `vandaag ${clock(date)}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${clock(date)}`;
}

/** Twee letters voor het monogram: "Kennisnet nieuws" → "Kn", "PO-Raad" → "PR", "Etch" → "Et". */
function monogram(name) {
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return words[0][0].toUpperCase() + words[1][0];
  return name.slice(0, 1).toUpperCase() + name.slice(1, 2).toLowerCase();
}

/** Vaste kleur per bron, afgeleid van de naam. */
function hue(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function mono(source, size = "") {
  return el("span", { class: `mono ${size}`, style: `--hue:${hue(source.name)}` }, monogram(source.name));
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

function displayTitle(item) {
  // Een kale versie als "4.0.2" wordt "Bricksforge 4.0.2".
  return /[a-z]/i.test(item.title) ? item.title : `${item.sources.name} ${item.title}`;
}

function nextFetch(now = new Date()) {
  for (let day = 0; day < 2; day++) {
    for (const h of FETCH_HOURS_UTC) {
      const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h));
      if (t > now) return t;
    }
  }
  return null;
}

function notify(message, isError = false) {
  const box = $("#notice");
  box.textContent = message;
  box.className = "notice" + (isError ? " error" : "");
  box.hidden = false;
  clearTimeout(notify.timer);
  if (!isError) notify.timer = setTimeout(() => (box.hidden = true), 4000);
}

function check({ error }) {
  if (error) {
    notify(navigator.onLine ? `Er ging iets mis: ${error.message}` : "Geen internetverbinding. Probeer het opnieuw als je weer online bent.", true);
    throw error;
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------------
// Thema, menu en zoeken
// ---------------------------------------------------------------------------

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("bm-theme", theme); } catch {}
  $('meta[name="theme-color"]').content = theme === "dark" ? "#0d0d11" : "#f3f2ee";
  $("#theme-btn").title = theme === "dark" ? "Licht thema" : "Donker thema";
}

function toggleMenu(open) {
  $("#app").classList.toggle("menu-open", open ?? !$("#app").classList.contains("menu-open"));
}

function toggleSearch(open) {
  const pop = $("#search-pop");
  pop.hidden = !(open ?? pop.hidden);
  if (!pop.hidden) $("#f-search").focus();
  $("#search-btn").classList.toggle("active", !pop.hidden || !!state.filters.q);
}

// ---------------------------------------------------------------------------
// App (PWA): service worker, installeren en offline-melding
// ---------------------------------------------------------------------------

function setupPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker niet geregistreerd:", err));
  }
  // Chrome/Edge/Android: eigen installatieknop. (iPhone: Deel → Zet op beginscherm.)
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event;
    $("#install").hidden = false;
  });
  $("#install").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $("#install").hidden = true;
  });
  window.addEventListener("appinstalled", () => ($("#install").hidden = true));
  window.addEventListener("offline", () => notify("Je bent offline. Nieuwe berichten laden lukt pas weer met verbinding.", true));
  window.addEventListener("online", () => notify("Weer online."));
}

// ---------------------------------------------------------------------------
// Inloggen
// ---------------------------------------------------------------------------

async function signInWithPassword(event) {
  event.preventDefault();
  const { error } = await sb.auth.signInWithPassword({
    email: $("#login-email").value.trim(),
    password: $("#login-password").value,
  });
  if (error) {
    const message = error.message === "Invalid login credentials"
      ? "E-mailadres of wachtwoord klopt niet. Nog geen wachtwoord ingesteld? Vraag dan een inloglink aan."
      : `Inloggen mislukt: ${error.message}`;
    loginNotice(message, true);
  }
}

async function sendMagicLink() {
  const email = $("#login-email").value.trim();
  if (!email || !$("#login-email").checkValidity()) {
    loginNotice("Vul eerst je e-mailadres in.", true);
    $("#login-email").focus();
    return;
  }
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false, // alleen bestaande gebruikers
      emailRedirectTo: location.origin + location.pathname,
    },
  });
  if (error) loginNotice(`Inloglink versturen mislukt: ${error.message}`, true);
  else loginNotice("Check je mail en klik op de inloglink.");
}

/** Meldingen op het inlogscherm (de gewone melding zit in de app, die dan verborgen is). */
function loginNotice(message, isError = false) {
  let box = $("#login-notice");
  if (!box) {
    box = el("div", { id: "login-notice", class: "notice" });
    $(".login-card .brand").after(box);
  }
  box.textContent = message;
  box.className = "notice" + (isError ? " error" : "");
  box.style.marginTop = "20px";
}

async function savePassword(event) {
  event.preventDefault();
  const form = event.target.elements;
  if (form.password.value !== form.repeat.value) {
    notify("De twee wachtwoorden zijn niet gelijk.", true);
    return;
  }
  const { error } = await sb.auth.updateUser({ password: form.password.value });
  if (error) {
    notify(`Wachtwoord opslaan mislukt: ${error.message}`, true);
    return;
  }
  $("#password-dialog").close();
  notify("Wachtwoord opgeslagen. Voortaan kun je hiermee inloggen.");
}

async function openPasswordDialog() {
  $("#password-form").reset();
  const { data } = await sb.auth.getUser();
  $("#password-username").value = data?.user?.email || "";
  $("#password-dialog").showModal();
}

async function onSignedIn() {
  const { data: allowed, error } = await sb.rpc("is_allowed");
  if (error || !allowed) {
    loginNotice("Je bent ingelogd, maar dit adres staat niet op de allowlist (tabel allowed_users).", true);
    await sb.auth.signOut();
    return;
  }
  document.body.classList.remove("signed-out");
  await Promise.all([loadSources(), loadStats()]);
  setView(state.view); // blijf waar je bent als je tijdens het laden al hebt geklikt
  await loadItems(true);
}

function onSignedOut() {
  document.body.classList.add("signed-out");
}

// ---------------------------------------------------------------------------
// Weergave wisselen en zijbalk
// ---------------------------------------------------------------------------

function setView(view) {
  state.view = view;
  $("#view-items").hidden = view !== "items";
  $("#view-sources").hidden = view !== "sources";
  $(".filters").style.visibility = view === "items" ? "" : "hidden";
  renderSidebar();
  toggleMenu(false);
  window.scrollTo({ top: 0 });
}

function selectSource(sourceId) {
  state.filters.source = sourceId;
  setView("items");
  renderHeader();
  loadItems(true);
}

function unreadCount(sourceId = null) {
  return state.stats.filter((r) => !r.is_read && (!sourceId || r.source_id === sourceId)).length;
}

function renderSidebar() {
  const totalUnread = unreadCount();
  $("#nav-unread").textContent = totalUnread || "";
  $("#nav-sources").textContent = state.sources.length;
  $("#all-unread").textContent = totalUnread || "";

  document.querySelectorAll(".nav-row").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  $("#all-sources").classList.toggle("on", state.view === "items" && !state.filters.source);

  $("#side-source-list").replaceChildren(...state.sources.map((s) => el("button", {
    class: "src-row" + (state.view === "items" && state.filters.source === s.id ? " on" : "") + (s.active ? "" : " inactive"),
    title: s.active ? s.name : `${s.name} (uit)`,
    onclick: () => selectSource(s.id),
  }, mono(s), el("span", { class: "src-name" }, s.name), el("span", { class: "count" }, unreadCount(s.id) || ""))));

  // Status onderin: wanneer laatst opgehaald, wanneer de volgende keer, en of er fouten zijn
  const checked = state.sources.map((s) => s.last_checked_at).filter(Boolean).sort().at(-1);
  const last = checked ? new Date(checked) : null;
  const next = nextFetch();
  const errors = state.sources.filter((s) => s.active && s.last_error).length;
  $("#status-dot").classList.toggle("warn", errors > 0);
  $("#status-text").textContent = errors
    ? `${errors} ${errors === 1 ? "bron" : "bronnen"} met een fout`
    : `Ingeladen ${last ? (sameDay(last, new Date()) ? clock(last) : whenLabel(last)) : "–"}${next ? ` · volgende ${clock(next)}` : ""}`;
}

// ---------------------------------------------------------------------------
// Bronnen
// ---------------------------------------------------------------------------

async function loadSources() {
  const result = await sb.from("sources").select("*").order("category").order("name");
  check(result);
  state.sources = result.data;
  fillCategoryOptions();
  renderSidebar();
  renderSources();
  renderHeader();
}

async function loadStats() {
  const result = await sb.from("items").select("id,source_id,is_read,tags").range(0, 4999);
  check(result);
  state.stats = result.data.map(({ id, source_id, is_read }) => ({ id, source_id, is_read }));
  const tags = [...new Set(result.data.flatMap((r) => r.tags || []))].sort((a, b) => a.localeCompare(b, "nl"));
  const select = $("#f-tag");
  select.replaceChildren(el("option", { value: "" }, "Alle tags"), ...tags.map((t) => el("option", { value: t }, t)));
  select.value = state.filters.tag;
  renderSidebar();
  renderSources();
}

function fillCategoryOptions() {
  const categories = [...new Set(state.sources.map((s) => s.category))].sort();
  const select = $("#f-category");
  select.replaceChildren(el("option", { value: "" }, "Alle categorieën"),
    ...categories.map((c) => el("option", { value: c }, categoryLabel(c))));
  select.value = state.filters.category;
  $("#category-list").replaceChildren(...categories.map((c) => el("option", { value: c })));
}

function renderSources() {
  const times = FETCH_HOURS_UTC.map((h) => {
    const d = new Date();
    d.setUTCHours(h, 0, 0, 0);
    return clock(d);
  });
  $("#sources-subtitle").textContent = `Gekoppelde websites worden drie keer per dag ingeladen: ${times.slice(0, -1).join(", ")} en ${times.at(-1)}.`;

  $("#sources").replaceChildren(...state.sources.map((s) => {
    const total = state.stats.filter((r) => r.source_id === s.id).length;
    const status = s.last_error
      ? el("span", { class: "source-status error" }, `Fout ${whenLabel(new Date(s.last_error_at))}: ${s.last_error}`)
      : el("span", { class: "source-status" }, s.last_success_at ? `✓ Laatst gelukt ${whenLabel(new Date(s.last_success_at))}` : "Nog niet opgehaald");
    return el("div", { class: "source-row" + (s.active ? "" : " inactive") },
      mono(s, "lg"),
      el("div", { class: "source-info" },
        el("span", { class: "source-name" }, s.name, s.active ? "" : " (uit)"),
        el("span", { class: "source-url" }, `${hostOf(s.url)} · ${s.type}`),
        status),
      el("span", { class: "chip static" }, categoryLabel(s.category)),
      el("span", { class: "source-total" }, `${total} ${total === 1 ? "bericht" : "berichten"}`),
      el("div", { class: "source-actions" },
        el("button", { class: "pill-btn", onclick: () => toggleSource(s) }, s.active ? "Uitzetten" : "Aanzetten"),
        el("button", { class: "pill-btn", onclick: () => openSourceDialog(s) }, "Bewerken"),
        el("button", { class: "pill-btn", onclick: () => selectSource(s.id) }, "Bekijk berichten →")));
  }));
}

async function toggleSource(source) {
  check(await sb.from("sources").update({ active: !source.active }).eq("id", source.id));
  notify(`${source.name} staat nu ${source.active ? "uit" : "aan"}.`);
  await loadSources();
}

function openSourceDialog(source = null) {
  const formEl = $("#source-form");
  formEl.reset();
  const form = formEl.elements;
  $("#source-dialog-title").textContent = source ? `Bron bewerken` : "Nieuwe bron";
  $("#delete-source").hidden = !source;
  const s = source || { type: "rss", active: true, include_keywords: [], exclude_keywords: [] };
  form.source_id.value = s.id || "";
  form.name.value = s.name || "";
  form.type.value = s.type;
  form.category.value = s.category || "";
  form.url.value = s.url || "";
  form.include_keywords.value = (s.include_keywords || []).join(", ");
  form.exclude_keywords.value = (s.exclude_keywords || []).join(", ");
  form.selector.value = s.selector || "";
  form.item_pattern.value = s.item_pattern || "";
  form.notes.value = s.notes || "";
  form.active.checked = s.active;
  togglePageFields();
  $("#source-dialog").showModal();
}

function togglePageFields() {
  $(".page-only").hidden = $("#source-form").elements.type.value !== "page";
}

async function saveSource(event) {
  event.preventDefault();
  const form = event.target.elements;
  const row = {
    name: form.name.value.trim(),
    type: form.type.value,
    category: form.category.value.trim().toLowerCase(),
    url: form.url.value.trim(),
    include_keywords: toList(form.include_keywords.value),
    exclude_keywords: toList(form.exclude_keywords.value),
    selector: form.selector.value.trim() || null,
    item_pattern: form.item_pattern.value.trim() || null,
    notes: form.notes.value.trim() || null,
    active: form.active.checked,
  };
  if (row.type === "page" && !row.selector) {
    notify("Een page-bron heeft een CSS-selector nodig.", true);
    return;
  }
  const id = form.source_id.value;
  check(id ? await sb.from("sources").update(row).eq("id", id) : await sb.from("sources").insert(row));
  $("#source-dialog").close();
  notify(id ? "Bron opgeslagen." : "Bron toegevoegd. De eerste ophaalrun is een nulmeting (geen mails).");
  await loadSources();
}

async function deleteSource() {
  const id = $("#source-form").elements.source_id.value;
  const source = state.sources.find((s) => s.id === id);
  if (!source) return;
  if (!confirm(`"${source.name}" verwijderen? Alle opgeslagen berichten van deze bron worden ook verwijderd. Liever alleen uitzetten?`)) return;
  check(await sb.from("sources").delete().eq("id", source.id));
  $("#source-dialog").close();
  notify(`${source.name} is verwijderd.`);
  if (state.filters.source === source.id) state.filters.source = "";
  await Promise.all([loadSources(), loadStats()]);
  await loadItems(true);
}

// ---------------------------------------------------------------------------
// Berichten
// ---------------------------------------------------------------------------

function buildItemsQuery() {
  const f = state.filters;
  let query = sb.from("items")
    .select("id,title,url,summary,tags,published_at,found_at,is_read,is_saved,is_urgent,source_id,sources!inner(name,category,type,url)", { count: "exact" })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("found_at", { ascending: false });

  if (f.status === "unread") query = query.eq("is_read", false);
  if (f.status === "saved") query = query.eq("is_saved", true);
  if (f.status === "urgent") query = query.eq("is_urgent", true);
  if (f.category) query = query.eq("sources.category", f.category);
  if (f.source) query = query.eq("source_id", f.source);
  if (f.tag) query = query.contains("tags", [f.tag]);

  // Zoeken: tekens die de filtersyntax breken eruit halen.
  const search = f.q.replace(/[,()%*]/g, " ").trim();
  if (search) query = query.or(`title.ilike.*${search}*,summary.ilike.*${search}*`);
  return query;
}

async function loadItems(reset = false) {
  if (reset) {
    state.items = [];
    state.offset = 0;
  }
  const result = await buildItemsQuery().range(state.offset, state.offset + PAGE_SIZE - 1);
  check(result);
  state.items.push(...result.data);
  state.offset += result.data.length;
  state.total = result.count ?? state.items.length;
  renderHeader();
  renderItems();
}

function renderHeader() {
  const f = state.filters;
  const source = state.sources.find((s) => s.id === f.source);
  const checked = (source ? [source.last_checked_at] : state.sources.map((s) => s.last_checked_at)).filter(Boolean).sort().at(-1);
  const loaded = `laatst ingeladen ${whenLabel(checked ? new Date(checked) : null)}`;

  $("#items-eyebrow").textContent = source ? `Bron · ${categoryLabel(source.category)}`
    : f.category ? `Categorie · ${categoryLabel(f.category)}` : "Overzicht";
  $("#items-title").textContent = source ? source.name : STATUS_TITLES[f.status];
  $("#items-subtitle").textContent = source
    ? `${hostOf(source.url)} · ${loaded}`
    : `${state.sources.filter((s) => s.active).length} bronnen · ${loaded}`;
  $("#items-count").textContent = `${state.total} ${state.total === 1 ? "bericht" : "berichten"}`;
  document.title = source ? `${source.name} · Bronnenmonitor` : "Bronnenmonitor";
}

function renderItems() {
  $("#load-more").hidden = state.items.length >= state.total;
  $("#items-empty").hidden = state.items.length > 0;
  $("#items").replaceChildren(...state.items.map(renderItem));
}

function renderItem(item) {
  const url = safeUrl(item.url);
  const titleText = displayTitle(item);
  const title = el("h2", { class: "card-title" }, url
    ? el("a", { href: url, target: "_blank", rel: "noopener", onclick: () => !item.is_read && setFlag(item, "is_read", true) }, titleText)
    : titleText);

  const tags = item.tags?.length ? item.tags : [];
  const chips = el("div", { class: "chips" },
    item.is_urgent ? el("span", { class: "chip urgent" }, "Urgent") : null,
    tags.slice(0, 2).map((t) => el("button", { class: "chip", title: `Filter op "${t}"`, onclick: () => filterOnTag(t) }, t)),
    !tags.length && !item.is_urgent ? el("span", { class: "chip static" }, categoryLabel(item.sources.category)) : null);

  return el("article", { class: "card" + (item.is_read ? " is-read" : "") },
    el("div", { class: "card-head" },
      mono(item.sources, "md"),
      el("div", { class: "card-source" },
        el("span", { class: "card-source-name" }, item.sources.name),
        el("span", { class: "card-meta" }, [categoryLabel(item.sources.category), shortDate(item.published_at || item.found_at)].filter(Boolean).join(" · "))),
      item.is_read ? null : el("span", { class: "unread-dot", title: "Ongelezen" })),
    title,
    item.summary ? el("p", { class: "card-text", title: "Klik om alles te lezen", onclick: (e) => e.currentTarget.classList.toggle("open") }, item.summary) : null,
    el("div", { class: "card-foot" },
      chips,
      el("div", { class: "card-buttons" },
        el("button", {
          class: "toggle star" + (item.is_saved ? " on" : ""), title: item.is_saved ? "Uit favorieten halen" : "Favoriet",
          "aria-label": "Favoriet", "aria-pressed": String(item.is_saved), onclick: () => setFlag(item, "is_saved", !item.is_saved),
        }, starIcon(item.is_saved)),
        el("button", {
          class: "toggle read" + (item.is_read ? " on" : ""), title: item.is_read ? "Markeer als ongelezen" : "Markeer als gelezen",
          "aria-label": "Gelezen", "aria-pressed": String(item.is_read), onclick: () => setFlag(item, "is_read", !item.is_read),
        }, icon("check")))));
}

function starIcon(filled) {
  const i = icon("star");
  i.querySelector("svg").setAttribute("fill", filled ? "currentColor" : "none");
  return i;
}

async function setFlag(item, field, value) {
  check(await sb.from("items").update({ [field]: value }).eq("id", item.id));
  item[field] = value;
  if (field === "is_read") {
    const stat = state.stats.find((r) => r.id === item.id);
    if (stat) stat.is_read = value;
    renderSidebar();
  }
  renderItems();
}

function filterOnTag(tag) {
  state.filters.tag = tag;
  $("#f-tag").value = tag;
  loadItems(true);
}

async function markVisibleRead() {
  const ids = state.items.filter((i) => !i.is_read).map((i) => i.id);
  if (!ids.length) return notify("Alles hier is al gelezen.");
  check(await sb.from("items").update({ is_read: true }).in("id", ids));
  state.items.forEach((i) => (i.is_read = true));
  state.stats.forEach((r) => { if (ids.includes(r.id)) r.is_read = true; });
  renderSidebar();
  renderItems();
  notify(`${ids.length} berichten als gelezen gemarkeerd.`);
}

// ---------------------------------------------------------------------------
// Opstarten
// ---------------------------------------------------------------------------

function init() {
  setupPwa();
  setTheme(document.documentElement.dataset.theme || "light");
  $("#theme-btn").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  if (!SUPABASE_ANON_KEY) {
    loginNotice("Vul de publishable/anon key in web/config.js in.", true);
    return;
  }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // inloggen en account
  $("#login-form").addEventListener("submit", signInWithPassword);
  $("#magic-link").addEventListener("click", sendMagicLink);
  $("#logout").addEventListener("click", () => sb.auth.signOut());
  $("#open-password").addEventListener("click", openPasswordDialog);
  $("#password-form").addEventListener("submit", savePassword);
  $("#cancel-password").addEventListener("click", () => $("#password-dialog").close());

  // navigatie
  document.querySelectorAll(".nav-row").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.view === "items") state.filters.source = "";
    setView(b.dataset.view);
    if (b.dataset.view === "items") loadItems(true);
  }));
  $("#all-sources").addEventListener("click", () => selectSource(""));
  $("#menu-btn").addEventListener("click", () => toggleMenu());
  $("#scrim").addEventListener("click", () => toggleMenu(false));

  // filters
  $("#f-status").addEventListener("click", (e) => {
    const button = e.target.closest("button[data-status]");
    if (!button) return;
    state.filters.status = button.dataset.status;
    $("#f-status").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === button));
    loadItems(true);
  });
  $("#f-category").addEventListener("change", (e) => { state.filters.category = e.target.value; loadItems(true); });
  $("#f-tag").addEventListener("change", (e) => { state.filters.tag = e.target.value; loadItems(true); });

  // zoeken
  $("#search-btn").addEventListener("click", () => toggleSearch());
  $("#f-search").addEventListener("input", debounce((e) => {
    state.filters.q = e.target.value;
    $("#clear-search").hidden = !state.filters.q;
    loadItems(true);
  }, 300));
  $("#f-search").addEventListener("keydown", (e) => { if (e.key === "Escape") toggleSearch(false); });
  $("#clear-search").addEventListener("click", () => {
    $("#f-search").value = "";
    state.filters.q = "";
    $("#clear-search").hidden = true;
    $("#search-btn").classList.toggle("active", !$("#search-pop").hidden);
    loadItems(true);
    $("#f-search").focus();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap") && !$("#search-pop").hidden) toggleSearch(false);
  });

  $("#load-more").addEventListener("click", () => loadItems());
  $("#mark-all-read").addEventListener("click", markVisibleRead);

  // bronnen
  $("#add-source").addEventListener("click", () => openSourceDialog());
  $("#source-form").addEventListener("submit", saveSource);
  $("#source-form").elements.type.addEventListener("change", togglePageFields);
  $("#cancel-source").addEventListener("click", () => $("#source-dialog").close());
  $("#delete-source").addEventListener("click", deleteSource);

  let signedIn = false;
  sb.auth.onAuthStateChange((_event, session) => {
    if (session && !signedIn) {
      signedIn = true;
      // Niet direct awaiten binnen de callback (aanbevolen door supabase-js).
      setTimeout(onSignedIn, 0);
    } else if (!session) {
      signedIn = false;
      onSignedOut();
    }
  });
}

init();

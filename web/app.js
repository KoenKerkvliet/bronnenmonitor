// Dashboard van de bronnenmonitor. Plain JavaScript + supabase-js, geen build-stap.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const PAGE_SIZE = 50;
const CATEGORY_LABELS = { onderwijs: "Onderwijs", webdesign: "Webdesign & tools" };

const $ = (sel) => document.querySelector(sel);
const state = { sources: [], items: [], offset: 0, total: 0 };
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
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : null;
}

function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || (cat ? cat[0].toUpperCase() + cat.slice(1) : "");
}

function formatDate(value, withTime = false) {
  if (!value) return "";
  const options = { day: "2-digit", month: "2-digit", year: "numeric" };
  if (withTime) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
  return new Date(value).toLocaleString("nl-NL", options);
}

function displayTitle(item) {
  // Een kale versie als "4.0.2" wordt "Bricksforge 4.0.2".
  return /[a-z]/i.test(item.title) ? item.title : `${item.sources.name} ${item.title}`;
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

function show(view) {
  for (const id of ["login", "items", "sources"]) $(`#view-${id}`).hidden = id !== view;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
}

const toList = (text) => text.split(",").map((s) => s.trim()).filter(Boolean);

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
    notify(message, true);
  }
}

async function sendMagicLink() {
  const email = $("#login-email").value.trim();
  if (!email || !$("#login-email").checkValidity()) {
    notify("Vul eerst je e-mailadres in.", true);
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
  if (error) notify(`Inloglink versturen mislukt: ${error.message}`, true);
  else notify("Check je mail en klik op de inloglink.");
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
  $("#tabs").hidden = false;
  $("#account").hidden = false;
  const { data: allowed, error } = await sb.rpc("is_allowed");
  if (error || !allowed) {
    show("login");
    $("#view-login").hidden = true;
    notify("Je bent ingelogd, maar dit adres staat niet op de allowlist (tabel allowed_users).", true);
    return;
  }
  await loadSources();
  await loadTags();
  show("items");
  await loadItems(true);
}

function onSignedOut() {
  $("#tabs").hidden = true;
  $("#account").hidden = true;
  show("login");
}

// ---------------------------------------------------------------------------
// Bronnen
// ---------------------------------------------------------------------------

async function loadSources() {
  const result = await sb.from("sources").select("*").order("category").order("name");
  check(result);
  state.sources = result.data;
  fillFilterOptions();
  renderSources();
}

function fillFilterOptions() {
  const categories = [...new Set(state.sources.map((s) => s.category))].sort();
  const keep = (select) => select.value;

  const catSelect = $("#f-category");
  const catValue = keep(catSelect);
  catSelect.replaceChildren(el("option", { value: "" }, "Alle categorieën"),
    ...categories.map((c) => el("option", { value: c }, categoryLabel(c))));
  catSelect.value = catValue;

  const srcSelect = $("#f-source");
  const srcValue = keep(srcSelect);
  srcSelect.replaceChildren(el("option", { value: "" }, "Alle bronnen"),
    ...state.sources.map((s) => el("option", { value: s.id }, s.name)));
  srcSelect.value = srcValue;

  $("#category-list").replaceChildren(...categories.map((c) => el("option", { value: c })));
}

function renderSources() {
  $("#sources-count").textContent = `${state.sources.length} bronnen, ${state.sources.filter((s) => s.active).length} actief`;
  const list = $("#sources");
  list.replaceChildren(...state.sources.map((s) => {
    const status = s.last_error
      ? el("div", { class: "source-error" }, `Laatste fout (${formatDate(s.last_error_at, true)}): ${s.last_error}`)
      : el("div", { class: "source-ok" }, s.last_success_at ? `✔ Laatst gelukt: ${formatDate(s.last_success_at, true)}` : "Nog niet opgehaald");
    return el("li", { class: "source" + (s.active ? "" : " inactive") },
      el("div", {},
        el("span", { class: "source-name" }, s.name), " ",
        el("span", { class: "badge" }, s.type), el("span", { class: "badge" }, categoryLabel(s.category)),
        s.active ? null : el("span", { class: "badge" }, "uit")),
      el("div", { class: "source-meta" }, s.url),
      el("div", { class: "source-actions" },
        el("button", { class: "secondary", onclick: () => toggleSource(s) }, s.active ? "Uitzetten" : "Aanzetten"),
        el("button", { class: "secondary", onclick: () => openSourceDialog(s) }, "Bewerken")),
      status,
      s.notes ? el("div", { class: "source-ok" }, s.notes) : null);
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
  $("#source-dialog-title").textContent = source ? `Bron bewerken: ${source.name}` : "Nieuwe bron";
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
  await loadSources();
  await loadItems(true);
}

// ---------------------------------------------------------------------------
// Berichten
// ---------------------------------------------------------------------------

async function loadTags() {
  const result = await sb.from("items").select("tags").not("tags", "eq", "{}").limit(2000);
  check(result);
  const tags = [...new Set(result.data.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "nl"));
  const select = $("#f-tag");
  const value = select.value;
  select.replaceChildren(el("option", { value: "" }, "Alle tags"), ...tags.map((t) => el("option", { value: t }, t)));
  select.value = value;
}

function buildItemsQuery() {
  let query = sb.from("items")
    .select("id,title,url,summary,tags,published_at,found_at,is_read,is_saved,is_urgent,source_id,sources!inner(name,category,type)", { count: "exact" })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("found_at", { ascending: false });

  const status = $("#f-status").value;
  if (status === "unread") query = query.eq("is_read", false);
  if (status === "saved") query = query.eq("is_saved", true);
  if (status === "urgent") query = query.eq("is_urgent", true);
  if ($("#f-category").value) query = query.eq("sources.category", $("#f-category").value);
  if ($("#f-source").value) query = query.eq("source_id", $("#f-source").value);
  if ($("#f-tag").value) query = query.contains("tags", [$("#f-tag").value]);

  // Zoeken: tekens die de filtersyntax breken eruit halen.
  const search = $("#f-search").value.replace(/[,()%*]/g, " ").trim();
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
  renderItems();
}

function renderItems() {
  $("#items-count").textContent = `${state.total} ${state.total === 1 ? "bericht" : "berichten"}`;
  $("#load-more").hidden = state.items.length >= state.total;
  const list = $("#items");
  if (!state.items.length) {
    list.replaceChildren(el("li", { class: "empty" }, "Geen berichten met deze filters."));
    return;
  }
  list.replaceChildren(...state.items.map(renderItem));
}

function renderItem(item) {
  const url = safeUrl(item.url);
  const title = url
    ? el("a", { class: "item-title", href: url, target: "_blank", rel: "noopener", onclick: () => !item.is_read && setFlag(item, "is_read", true) }, displayTitle(item))
    : el("span", { class: "item-title" }, displayTitle(item));

  const summary = item.summary
    ? el("p", { class: "item-summary clamp", title: "Klik om alles te lezen", onclick: (e) => e.currentTarget.classList.toggle("clamp") }, item.summary)
    : null;

  return el("li", { class: "item" + (item.is_read ? " read" : "") },
    el("div", {}, item.is_urgent ? el("span", { class: "badge urgent" }, "URGENT") : null, title),
    el("div", { class: "item-meta" },
      `${item.sources.name} · ${categoryLabel(item.sources.category)}`,
      item.published_at ? ` · ${formatDate(item.published_at)}` : "",
      ...(item.tags || []).map((t) => el("span", { class: "tag", title: "Filter op deze tag", onclick: () => filterOnTag(t) }, t))),
    el("div", { class: "item-actions" },
      el("button", {
        class: "icon" + (item.is_saved ? " on" : ""), title: item.is_saved ? "Niet meer bewaren" : "Bewaren",
        "aria-label": "Bewaren", onclick: () => setFlag(item, "is_saved", !item.is_saved),
      }, item.is_saved ? "★" : "☆"),
      el("button", {
        class: "icon" + (item.is_read ? " on" : ""), title: item.is_read ? "Markeer als ongelezen" : "Markeer als gelezen",
        "aria-label": "Gelezen", onclick: () => setFlag(item, "is_read", !item.is_read),
      }, "✓")),
    summary);
}

async function setFlag(item, field, value) {
  check(await sb.from("items").update({ [field]: value }).eq("id", item.id));
  item[field] = value;
  renderItems();
}

function filterOnTag(tag) {
  $("#f-tag").value = tag;
  loadItems(true);
}

async function markVisibleRead() {
  const ids = state.items.filter((i) => !i.is_read).map((i) => i.id);
  if (!ids.length) return notify("Alles hier is al gelezen.");
  check(await sb.from("items").update({ is_read: true }).in("id", ids));
  state.items.forEach((i) => (i.is_read = true));
  renderItems();
  notify(`${ids.length} berichten als gelezen gemarkeerd.`);
}

// ---------------------------------------------------------------------------
// Opstarten
// ---------------------------------------------------------------------------

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function init() {
  setupPwa();
  if (!SUPABASE_ANON_KEY) {
    notify("Vul de publishable/anon key in web/config.js in.", true);
    return;
  }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  $("#login-form").addEventListener("submit", signInWithPassword);
  $("#magic-link").addEventListener("click", sendMagicLink);
  $("#logout").addEventListener("click", () => sb.auth.signOut());
  $("#open-password").addEventListener("click", openPasswordDialog);
  $("#password-form").addEventListener("submit", savePassword);
  $("#cancel-password").addEventListener("click", () => $("#password-dialog").close());
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.view)));

  for (const id of ["#f-status", "#f-category", "#f-source", "#f-tag"]) $(id).addEventListener("change", () => loadItems(true));
  $("#f-search").addEventListener("input", debounce(() => loadItems(true), 300));
  $("#filters").addEventListener("submit", (e) => e.preventDefault());
  $("#load-more").addEventListener("click", () => loadItems());
  $("#mark-all-read").addEventListener("click", markVisibleRead);

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

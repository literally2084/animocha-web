import { config } from "./config.js";
import { titles as manualTitles } from "./content.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { titles: [], filter: "all", sort: "featured", query: "", ratingTarget: null, selectedRating: 0, heroIndex: 0, accountMode: "login", channel: null, user: null };
const apiRoot = config.apiBaseUrl.replace(/\/$/, "");
let heroTimer;

function toast(message) {
  const node = $("#toast"); node.textContent = message; node.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 3000);
}
function escapeHTML(value = "") { return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function safeUrl(value) {
  if (!value) return "";
  try { const url = new URL(value, location.href); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
}
async function request(path, options = {}) {
  if (!apiRoot) throw new Error("API base URL is not configured.");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${apiRoot}${path}`, { ...options, signal: options.signal ?? controller.signal, credentials: "include", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    if (!response.ok) { let message = `Request failed (${response.status}).`; try { message = (await response.json()).message || message; } catch {} throw new Error(message); }
    return response.status === 204 ? null : response.json();
  } finally { clearTimeout(timeout); }
}
function unwrapList(payload) { if (Array.isArray(payload)) return payload; return payload?.items ?? payload?.results ?? payload?.data ?? []; }
function normalizeTitle(item = {}) {
  const creatorObj = typeof item.creator === "object" && item.creator ? item.creator : {};
  return {
    id: String(item.id ?? item.slug ?? ""), title: String(item.title ?? item.name ?? "Untitled"),
    creator: String(creatorObj.displayName ?? creatorObj.name ?? item.creatorName ?? (typeof item.creator === "string" ? item.creator : "")),
    creatorSlug: String(creatorObj.slug ?? item.creatorSlug ?? item.creator_slug ?? ""),
    type: String(item.type ?? item.kind ?? item.format ?? "film").toLowerCase(), synopsis: String(item.synopsis ?? item.description ?? ""),
    thumbnailUrl: safeUrl(item.thumbnailUrl ?? item.thumbnail_url ?? item.posterUrl ?? item.poster_url ?? item.image ?? ""),
    bannerUrl: safeUrl(item.bannerUrl ?? item.banner_url ?? item.backdropUrl ?? item.backdrop_url ?? item.thumbnailUrl ?? item.thumbnail_url ?? item.posterUrl ?? ""),
    year: item.year ?? "", duration: String(item.duration ?? ""), rating: Number.isFinite(Number(item.rating)) && item.rating !== null && item.rating !== "" ? Number(item.rating) : null,
    ratingCount: Number.isFinite(Number(item.ratingCount ?? item.rating_count)) ? Number(item.ratingCount ?? item.rating_count) : 0,
    href: safeUrl(item.href ?? item.watchUrl ?? item.watch_url ?? item.url ?? ""), live: Boolean(item.isLive ?? item.live ?? String(item.type ?? "").toLowerCase() === "live"),
    featured: Boolean(item.featured), createdAt: item.createdAt ?? item.created_at ?? "", tags: Array.isArray(item.tags) ? item.tags : [],
  };
}
function typeLabel(item) { if (item.live || item.type === "live") return "LIVE"; return ({ film: "FILM", series: "SERIES", short: "SHORT", loop: "LOOP", premiere: "PREMIERE", vod: "VIDEO" })[item.type] ?? item.type.toUpperCase(); }
function ratingMarkup(item) { return item.rating === null ? `<span class="rating-summary rating-unrated">Not yet rated</span>` : `<span class="rating-summary" aria-label="Rated ${item.rating.toFixed(1)} out of 5">★ ${item.rating.toFixed(1)} <small>(${item.ratingCount})</small></span>`; }
function creatorLink(item) { const slug = item.creatorSlug || item.creator; return slug ? `#channel/${encodeURIComponent(slug)}` : ""; }
function cardMarkup(item, index) {
  const image = item.thumbnailUrl ? `<img class="title-poster" src="${escapeHTML(item.thumbnailUrl)}" alt="" loading="lazy">` : `<div class="poster-placeholder poster-tone-${index % 4}"><span>${escapeHTML(item.title.slice(0, 1).toUpperCase())}</span></div>`;
  const meta = [item.year, item.duration].filter(Boolean).map(escapeHTML).join(" · ");
  return `<article class="title-card" data-title-id="${escapeHTML(item.id)}"><a class="poster-wrap" href="${item.href ? escapeHTML(item.href) : `#title/${encodeURIComponent(item.id)}`}" aria-label="View ${escapeHTML(item.title)}">${image}<span class="type-pill ${item.live ? "is-live" : ""}">${escapeHTML(typeLabel(item))}</span>${item.live ? `<span class="live-indicator"><i></i> Live now</span>` : ``}<span class="poster-play" aria-hidden="true">▶</span></a><div class="title-card-body"><div class="title-card-heading"><h3 class="title-name">${escapeHTML(item.title)}</h3>${ratingMarkup(item)}</div>${item.creator ? `<a class="creator-name" href="${escapeHTML(creatorLink(item) || "#home")}">${escapeHTML(item.creator)}</a>` : ""}${meta ? `<p class="title-meta">${meta}</p>` : ""}${item.synopsis ? `<p class="title-synopsis">${escapeHTML(item.synopsis)}</p>` : ""}<div class="title-card-actions"><button class="text-action rate-title" type="button" data-rate-id="${escapeHTML(item.id)}">Rate title <span aria-hidden="true">★</span></button>${item.href ? `<a class="text-action watch-title" href="${escapeHTML(item.href)}">Watch ↗</a>` : ""}</div></div></article>`;
}
function filteredTitles() {
  let list = [...state.titles];
  if (state.filter === "live") list = list.filter(item => item.live || item.type === "live");
  else if (state.filter !== "all") list = list.filter(item => item.type === state.filter || (state.filter === "short" && ["short", "loop"].includes(item.type)));
  if (state.query) { const q = state.query.toLocaleLowerCase(); list = list.filter(item => `${item.title} ${item.creator} ${item.synopsis} ${item.type} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(q)); }
  if (state.sort === "newest") list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (state.sort === "rating") list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  if (state.sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
  if (state.sort === "featured") list.sort((a, b) => Number(b.featured) - Number(a.featured));
  return list;
}
function renderCatalog() {
  const items = filteredTitles(); const primary = items.slice(0, 8); const remaining = items.slice(8);
  $("#featured-grid").innerHTML = primary.map(cardMarkup).join("");
  $("#catalog-section").hidden = !remaining.length;
  $("#catalog-grid").innerHTML = remaining.map((item, i) => cardMarkup(item, i + 8)).join("");
  $("#catalog-heading").textContent = state.query ? "Search results" : "More to discover";
  $("#result-count").textContent = `${items.length} ${items.length === 1 ? "title" : "titles"}`;
  $("#empty-state").hidden = items.length > 0;
  $("#empty-title").textContent = state.query ? "Nothing found just yet." : "Hey! Who spilled the coffee? ";
  $("#empty-description").textContent = state.query ? "Try another title, format, or creator name." : apiRoot ? "The catalogue is empty for now. New independent animations will appear here when published." : "TODO: Connect titles API to bring the collection to life, adding titles to js/content.js are for local preview.";
  document.title = state.query ? `Search: ${state.query} — Animocha` : "Animocha";
}
function renderHero() {
  const items = state.titles.filter(item => item.bannerUrl || item.thumbnailUrl).slice(0, 8);
  const dots = $("#hero-dots");
  if (!items.length) { $("#hero-backdrop").style.backgroundImage = ""; $("#hero-title").innerHTML = "Stories outside<br>the mainstream."; $("#hero-description").textContent = "Find your next favourite from independent animators, studios, and storytellers."; $("#hero-caption-text").textContent = "A home for independent animation"; $("#hero-watch").href = "#catalog"; dots.innerHTML = ""; clearInterval(heroTimer); return; }
  const active = items[state.heroIndex % items.length]; const image = active.bannerUrl || active.thumbnailUrl;
  $("#hero-backdrop").style.backgroundImage = `url("${image.replace(/["\\]/g, "\\$&")}")`;
  $("#hero-kicker").textContent = active.live ? "LIVE FROM THE COMMUNITY" : active.featured ? "FEATURED ON ANIMOCHA" : "INDEPENDENT ANIMATION";
  $("#hero-title").textContent = active.title; $("#hero-description").textContent = active.synopsis || `Discover ${active.title}${active.creator ? `, from ${active.creator}` : ""}.`;
  $("#hero-caption-text").textContent = [active.creator, active.year, typeLabel(active)].filter(Boolean).join(" · ");
  $("#hero-watch").href = active.href || (active.id ? `#title/${encodeURIComponent(active.id)}` : "#catalog"); $("#hero-watch").innerHTML = `Explore title <span aria-hidden="true">→</span>`;
  dots.innerHTML = items.map((item, i) => `<button type="button" class="hero-dot ${i === state.heroIndex % items.length ? "is-active" : ""}" data-hero-index="${i}" aria-label="Show ${escapeHTML(item.title)}"></button>`).join("");
  clearInterval(heroTimer); if (items.length > 1) heroTimer = setInterval(() => { state.heroIndex = (state.heroIndex + 1) % items.length; renderHero(); }, 6500);
}
async function loadContent() {
  state.titles = manualTitles.map(normalizeTitle);
  if (apiRoot) {
    try { state.titles = unwrapList(await request(config.endpoints.titles)).map(normalizeTitle); }
    catch (error) { console.warn("Catalogue API unavailable:", error); toast("The catalogue API could not be reached."); }
  }
  renderCatalog(); renderHero();
}
function showView(view) { $$(".page-view").forEach(node => { node.hidden = node.id !== `${view}-view`; }); window.scrollTo({ top: 0, behavior: "smooth" }); }
function renderAccount(mode) {
  state.accountMode = mode === "signup" ? "signup" : "login"; const signup = state.accountMode === "signup";
  showView("account"); $("#account-title").textContent = signup ? "Make yourself at home." : "Welcome back.";
  $("#account-intro").textContent = signup ? "Create an account to rate animation and build your own channel." : "Sign in to rate titles and connect with creators.";
  $("#display-name-wrap").hidden = !signup; $("#account-name").required = signup; $("#account-password").autocomplete = signup ? "new-password" : "current-password";
  $("#account-submit").textContent = signup ? "Create account" : "Sign in"; $("#login-tab").classList.toggle("is-active", !signup); $("#signup-tab").classList.toggle("is-active", signup); $("#account-message").textContent = "";
}
async function renderChannel(slug) {
  showView("channel"); $("#channel-grid").innerHTML = ""; $("#channel-empty").hidden = true;
  let channel = null; let works = state.titles.filter(item => item.creatorSlug.toLowerCase() === slug.toLowerCase() || item.creator.toLowerCase() === decodeURIComponent(slug).toLowerCase());
  if (apiRoot) { try { const data = await request(`${config.endpoints.channels}/${encodeURIComponent(slug)}`); channel = data?.channel ?? data; if (Array.isArray(data?.titles ?? data?.items)) works = (data.titles ?? data.items).map(normalizeTitle); } catch (error) { console.warn("Channel endpoint unavailable:", error); } }
  state.channel = channel || { displayName: works[0]?.creator || decodeURIComponent(slug), slug, bio: "Independent animation and ideas in motion." };
  const name = state.channel.displayName ?? state.channel.name ?? state.channel.title ?? decodeURIComponent(slug);
  $("#channel-name").textContent = name; $("#channel-bio").textContent = state.channel.bio ?? state.channel.description ?? "Independent animation and ideas in motion.";
  $("#channel-avatar").textContent = name.slice(0, 1).toUpperCase(); $("#channel-banner").style.backgroundImage = safeUrl(state.channel.bannerUrl ?? state.channel.banner_url) ? `url("${safeUrl(state.channel.bannerUrl ?? state.channel.banner_url)}")` : "";
  $("#channel-stats").textContent = `${works.length} ${works.length === 1 ? "title" : "titles"} published`;
  $("#channel-grid").innerHTML = works.map(cardMarkup).join(""); $("#channel-empty").hidden = works.length > 0;
  $("#channel-follow").onclick = async () => { if (!apiRoot) return toast("Connect the follow endpoint to enable channel follows."); try { await request(config.endpoints.follow, { method: "POST", body: JSON.stringify({ channelSlug: slug }) }); toast("Channel followed."); } catch (e) { toast(e.message || "Sign in to follow this channel."); } };
  document.title = `${name} — Animocha`;
}
function route() {
  const parts = decodeURIComponent(location.hash.slice(1) || "home").split("/");
  if (parts[0] === "account") return renderAccount(parts[1] || "login");
  if (parts[0] === "channel" && parts[1]) return renderChannel(parts[1]);
  if (parts[0] === "title" && parts[1]) { const item = state.titles.find(title => title.id === parts[1]); if (item?.href) location.href = item.href; else { showView("home"); toast(item ? "A watch URL has not been configured for this title." : "That title could not be found."); } return; }
  showView("home"); if (parts[0] === "catalog") $("#catalog").scrollIntoView({ behavior: "smooth" });
}

$("#search-form").addEventListener("submit", async event => { event.preventDefault(); state.query = $("#site-search").value.trim(); if (apiRoot && state.query) { try { state.titles = unwrapList(await request(`${config.endpoints.search}?q=${encodeURIComponent(state.query)}`)).map(normalizeTitle); renderHero(); } catch (e) { console.warn("Using local search:", e); } } renderCatalog(); showView("home"); $("#catalog").scrollIntoView({ behavior: "smooth" }); });
$("#site-search").addEventListener("input", () => { if (!$("#site-search").value.trim() && state.query) { state.query = ""; renderCatalog(); } });
$$("[data-filter]").forEach(button => button.addEventListener("click", () => { state.filter = button.dataset.filter; $$("[data-filter]").forEach(item => item.classList.toggle("is-active", item === button)); renderCatalog(); }));
$("#sort-select").addEventListener("change", event => { state.sort = event.target.value; renderCatalog(); });
$("#hero-dots").addEventListener("click", event => { const dot = event.target.closest("[data-hero-index]"); if (!dot) return; state.heroIndex = Number(dot.dataset.heroIndex); renderHero(); });
document.addEventListener("click", event => {
  const rate = event.target.closest("[data-rate-id]"); if (rate) { const item = state.titles.find(title => title.id === rate.dataset.rateId); if (!item) return toast("This title needs a unique id before it can be rated."); state.ratingTarget = item; state.selectedRating = 0; $("#rating-title").textContent = `Rate "${item.title}"`; $("#rating-subtitle").textContent = item.creator ? `Your rating for ${item.creator}'s work.` : "Ratings help viewers discover work that resonates with them."; $("#rating-review").value = ""; updateRatingPicker(); $("#rating-dialog").showModal(); }
});
function updateRatingPicker() { $$('[data-rating]').forEach(button => { const active = Number(button.dataset.rating) <= state.selectedRating; button.classList.toggle("is-selected", active); button.setAttribute("aria-pressed", String(active)); }); }
$$('[data-rating]').forEach(button => button.addEventListener("click", () => { state.selectedRating = Number(button.dataset.rating); updateRatingPicker(); }));
$("#close-rating").addEventListener("click", () => $("#rating-dialog").close());
$("#rating-form").addEventListener("submit", async event => { event.preventDefault(); if (!state.ratingTarget || !state.selectedRating) return toast("Choose a rating from one to five stars first."); if (!apiRoot) return toast("Rating interface ready; TODO: configure an API to save ratings."); try { await request(config.endpoints.ratings, { method: "POST", body: JSON.stringify({ titleId: state.ratingTarget.id, rating: state.selectedRating, review: $("#rating-review").value.trim() }) }); toast("Your rating was submitted."); $("#rating-dialog").close(); await loadContent(); } catch (e) { toast(e.message || "Rating could not be saved. Sign in and try again."); } });
$("#account-form").addEventListener("submit", async event => { event.preventDefault(); const signup = state.accountMode === "signup"; const message = $("#account-message"); message.textContent = ""; if (!apiRoot) { message.textContent = "Account UI is ready. TODO: set apiBaseUrl in js/config.js and connect the authentication endpoints to enable sign-in."; return; } const payload = { email: $("#account-email").value.trim(), password: $("#account-password").value }; if (signup) payload.displayName = $("#account-name").value.trim(); try { const result = await request(signup ? config.endpoints.signup : config.endpoints.login, { method: "POST", body: JSON.stringify(payload) }); state.user = result?.user ?? result; message.textContent = signup ? "Account created. Welcome to Animocha!" : "Signed in successfully."; toast(message.textContent); setTimeout(() => { location.hash = "home"; }, 700); } catch (e) { message.textContent = e.message || "We couldn't complete that request."; } });
window.addEventListener("hashchange", route);
loadContent().then(route);

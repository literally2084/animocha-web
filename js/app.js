import { config } from "./config.js";
import { titles as manualTitles } from "./content.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { titles: [], searchResults: null, filter: "all", sort: "featured", query: "", ratingTarget: null, selectedRating: 0, heroIndex: 0, accountMode: "login", channel: null, user: null, channels: [], watchTitle: null, titleOrder: "shuffle", channelOrder: "shuffle" };
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
    if (!response.ok) { let message = `Request failed (${response.status}).`; try { const body = await response.json(); message = body.message || body.detail || message; } catch {} throw new Error(typeof message === "string" ? message : JSON.stringify(message)); }
    return response.status === 204 ? null : response.json();
  } finally { clearTimeout(timeout); }
}
function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["items", "results", "titles", "channels", "data"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return [];
}
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
    href: safeUrl(item.href ?? item.url ?? ""), videoUrl: safeUrl(item.videoUrl ?? item.video_url ?? item.playbackUrl ?? item.playback_url ?? item.streamUrl ?? item.stream_url ?? ""),
    live: Boolean(item.isLive ?? item.live ?? String(item.type ?? "").toLowerCase() === "live"),
    featured: Boolean(item.featured), createdAt: item.createdAt ?? item.created_at ?? "", tags: Array.isArray(item.tags) ? item.tags : [],
    access: item.access ?? item.monetization ?? item.accessOptions ?? item.access_options ?? null,
  };
}
function typeLabel(item) { if (item.live || item.type === "live") return "LIVE"; return ({ film: "FILM", series: "SERIES", short: "SHORT", loop: "LOOP", premiere: "PREMIERE", vod: "VIDEO" })[item.type] ?? item.type.toUpperCase(); }
function ratingMarkup(item) { return item.rating === null ? `<span class="rating-summary rating-unrated">Not yet rated</span>` : `<span class="rating-summary" aria-label="Rated ${item.rating.toFixed(1)} out of 5">★ ${item.rating.toFixed(1)} <small>(${item.ratingCount})</small></span>`; }
function creatorLink(item) { const slug = item.creatorSlug || item.creator; return slug ? `#channel/${encodeURIComponent(slug)}` : ""; }
function cardMarkup(item, index) {
  const image = item.thumbnailUrl ? `<img class="title-poster" src="${escapeHTML(item.thumbnailUrl)}" alt="" loading="lazy">` : `<div class="poster-placeholder poster-tone-${index % 4}"><span>${escapeHTML(item.title.slice(0, 1).toUpperCase())}</span></div>`;
  const meta = [item.year, item.duration].filter(Boolean).map(escapeHTML).join(" · ");
  return `<article class="title-card" data-title-id="${escapeHTML(item.id)}"><a class="poster-wrap" href="#watch/${encodeURIComponent(item.id)}" aria-label="View ${escapeHTML(item.title)}">${image}<span class="type-pill ${item.live ? "is-live" : ""}">${escapeHTML(typeLabel(item))}</span>${item.live ? `<span class="live-indicator"><i></i> Live now</span>` : ``}<span class="poster-play" aria-hidden="true">▶</span></a><div class="title-card-body"><div class="title-card-heading"><h3 class="title-name">${escapeHTML(item.title)}</h3>${ratingMarkup(item)}</div>${item.creator ? `<a class="creator-name" href="${escapeHTML(creatorLink(item) || "#home")}">${escapeHTML(item.creator)}</a>` : ""}${meta ? `<p class="title-meta">${meta}</p>` : ""}${item.synopsis ? `<p class="title-synopsis">${escapeHTML(item.synopsis)}</p>` : ""}<div class="title-card-actions"><button class="text-action rate-title" type="button" data-rate-id="${escapeHTML(item.id)}">Rate title <span aria-hidden="true">★</span></button>${item.href ? `<a class="text-action watch-title" href="${escapeHTML(item.href)}">Watch ↗</a>` : ""}</div></div></article>`;
}
function filteredTitles() {
  let list = [...(state.query && Array.isArray(state.searchResults) ? state.searchResults : state.titles)];
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
function shuffle(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
function uniqueChannelsFromTitles() {
  const map = new Map();
  for (const title of state.titles) {
    const key = (title.creatorSlug || title.creator).trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, { slug: title.creatorSlug || key.replace(/\\s+/g, "-"), displayName: title.creator, bio: title.creator ? `Independent work from ${title.creator}.` : "", titleCount: 0, titles: [] });
    const channel = map.get(key); channel.titleCount++; channel.titles.push(title);
  }
  return [...map.values()];
}
function channelCardMarkup(channel) {
  const name = channel.displayName || channel.name || "Independent creator";
  const slug = channel.slug || channel.handle || name;
  const image = safeUrl(channel.avatarUrl || channel.avatar_url || channel.image || "");
  const count = Number(channel.titleCount ?? channel.title_count ?? channel.titles?.length ?? 0);
  return `<a class="channel-card" href="#channel/${encodeURIComponent(slug)}"><div class="channel-avatar-small">${image ? `<img src="${escapeHTML(image)}" alt="">` : escapeHTML(name.slice(0,1).toUpperCase())}</div><div class="channel-card-copy"><h3>${escapeHTML(name)}</h3><p>${escapeHTML(channel.bio || channel.description || "Independent animation creator")}</p><span>${count} ${count === 1 ? "title" : "titles"} published</span></div><span class="channel-card-arrow" aria-hidden="true">↗</span></a>`;
}
async function loadChannels() {
  let channels = [];
  if (apiRoot) {
    try { const payload = await request(config.endpoints.channelsDiscovery); channels = unwrapList(payload).map(channel => ({ ...channel, slug: channel.slug ?? channel.handle ?? channel.id, displayName: channel.displayName ?? channel.display_name ?? channel.name, titleCount: channel.titleCount ?? channel.title_count ?? channel.titles?.length ?? 0 })); }
    catch (error) { console.info("Channel discovery endpoint unavailable; deriving channels from titles.", error); }
  }
  state.channels = channels.length ? channels : uniqueChannelsFromTitles();
  renderDiscovery();
}
function renderDiscovery() {
  const randomSort = $("#random-sort")?.value || state.titleOrder;
  let picks = state.titleOrder === "shuffle" ? shuffle(state.titles) : [...state.titles];
  if (state.titleOrder === "newest") picks.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (state.titleOrder === "title") picks.sort((a,b) => a.title.localeCompare(b.title));
  picks = picks.slice(0, 8);
  $("#random-titles-grid").innerHTML = picks.map(cardMarkup).join("");
  $("#random-titles-note").textContent = picks.length ? `${picks.length} rotating picks from ${state.titles.length} available titles.` : "As creators publish, their work will appear in this rotating discovery lane.";
  let channels = state.channelOrder === "shuffle" ? shuffle(state.channels) : [...state.channels];
  if (state.channelOrder === "name") channels.sort((a,b) => String(a.displayName || a.name).localeCompare(String(b.displayName || b.name)));
  if (state.channelOrder === "titles") channels.sort((a,b) => Number(b.titleCount || b.title_count || b.titles?.length || 0) - Number(a.titleCount || a.title_count || a.titles?.length || 0));
  channels = channels.slice(0, 6);
  $("#random-channels-grid").innerHTML = channels.map(channelCardMarkup).join("");
  $("#random-channels-note").textContent = channels.length ? `${channels.length} channels selected from ${state.channels.length} discoverable creators.` : "Creator channels will appear here as creators publish work.";
  let rated = state.titles.filter(item => item.rating !== null && item.ratingCount > 0);
  const order = $("#rated-sort")?.value || "rating";
  if (order === "count") rated.sort((a,b) => b.ratingCount-a.ratingCount);
  else if (order === "newest") rated.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  else rated.sort((a,b) => b.rating-a.rating);
  $("#rated-grid").innerHTML = rated.slice(0, 4).map(cardMarkup).join("");
  $("#rated-note").textContent = rated.length ? "Only titles with actual ratings are included; unrated titles remain eligible for randomized discovery." : "No rated titles yet. All published work remains eligible for randomized discovery.";
  const titleSelect = $("#monetization-title");
  if (titleSelect) titleSelect.innerHTML = `<option value="">Select a title…</option>` + state.titles.map(item => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)}</option>`).join("");
  $("#studio-title-count").textContent = String(state.titles.length);
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
  renderCatalog(); renderHero(); renderDiscovery(); await loadChannels();
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
  state.channel = channel || { displayName: works[0]?.creator || decodeURIComponent(slug), slug, bio: "No bio set." };
  const name = state.channel.displayName ?? state.channel.name ?? state.channel.title ?? decodeURIComponent(slug);
  $("#channel-name").textContent = name; $("#channel-bio").textContent = state.channel.bio ?? state.channel.description ?? "Independent animation and ideas in motion.";
  $("#channel-avatar").textContent = name.slice(0, 1).toUpperCase(); $("#channel-banner").style.backgroundImage = safeUrl(state.channel.bannerUrl ?? state.channel.banner_url) ? `url("${safeUrl(state.channel.bannerUrl ?? state.channel.banner_url)}")` : "";
  $("#channel-stats").textContent = `${works.length} ${works.length === 1 ? "title" : "titles"} published`;
  $("#channel-grid").innerHTML = works.map(cardMarkup).join(""); $("#channel-empty").hidden = works.length > 0;
  $("#channel-follow").onclick = async () => { if (!apiRoot) return toast("Connect the follow endpoint to enable channel follows."); try { await request(config.endpoints.follow, { method: "POST", body: JSON.stringify({ channelSlug: slug }) }); toast("Channel followed."); } catch (e) { toast(e.message || "Sign in to follow this channel."); } };
  document.title = `${name} — Animocha`;
}
function setStudioPanel(panel) {
  $("#studio-overview").hidden = panel !== "overview";
  $("#studio-channel-panel").hidden = panel !== "channel";
  $("#studio-monetization-panel").hidden = panel !== "monetization";
  $("#studio-content-panel").hidden = panel !== "content";
}
async function renderStudio(panel = "overview") {
  showView("studio"); setStudioPanel(panel);
  $("#studio-channel-message").textContent = ""; $("#monetization-message").textContent = "";
  if (panel === "channel" && apiRoot) {
    try { const data = await request(config.endpoints.channelSettings); const c = data?.channel ?? data ?? {}; $("#studio-name").value = c.displayName ?? c.name ?? ""; $("#studio-slug").value = c.slug ?? ""; $("#studio-bio").value = c.bio ?? c.description ?? ""; $("#studio-banner").value = c.bannerUrl ?? c.banner_url ?? ""; }
    catch (e) { console.info("Studio channel settings not loaded.", e); }
  }
  if (panel === "content") $("#studio-titles-grid").innerHTML = state.titles.map(cardMarkup).join("");
  document.title = `${panel === "overview" ? "Studio" : panel[0].toUpperCase()+panel.slice(1)} — Animocha`;
}
function renderLegal(section = "tos") {
  showView("legal"); const guidelines = section === "guidelines";
  $("#legal-heading").textContent = guidelines ? "Community Guidelines" : "Terms of Service";
  $("#legal-subheading").textContent = guidelines ? "Keep Animocha welcoming, honest, and creatively generous." : "Clear expectations for creators, viewers, and independent work.";
  $("#legal-tos").hidden = guidelines; $("#legal-guidelines").hidden = !guidelines;
  document.title = `${$("#legal-heading").textContent} — Animocha`;
}
function accessConfig(item) {
  const raw = item?.access;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.options)) return raw.options;
    if (Array.isArray(raw.methods)) return raw.methods;
    if (raw.model || raw.type) return [raw];
  }
  return [];
}
function renderAccessOptions(item) {
  const container = $("#access-options");
  const options = accessConfig(item);
  if (!options.length) {
    container.innerHTML = `<div class="access-option"><strong>Free to watch</strong><p>Availability is determined by this title's creator.</p><button class="button button-primary access-action" data-access="free" type="button">Check availability</button></div><p class="legal-small">TODO: Connect the playback/access endpoint to return the title's available methods and current prices.</p>`;
    return;
  }
  const labels = { free_ads: ["Free with ads","Watch at no cost with creator-enabled ads."], free_no_ads: ["Free without ads","Watch this title for free, without ad breaks."], pay_per_view: ["Pay per view","Purchase a viewing entitlement for this title."], rental: ["Timed rental","Rent access for a limited viewing window."], purchase: ["Own a copy","Purchase a copy when the creator offers downloads."], free: ["Free to watch","Watch at no cost."] };
  container.innerHTML = options.map((option,index) => {
    const model = String(option.model ?? option.type ?? option.id ?? "free");
    const [label,desc] = labels[model] || [option.label || model.replaceAll("_"," "), option.description || "Creator-configured access option."];
    const price = option.price == null || model.startsWith("free") || model === "free" ? "Free" : `${escapeHTML(option.currency || "$")}${Number(option.price).toFixed(2)}`;
    const details = model === "rental" ? `${Number(option.durationHours ?? option.duration_hours ?? 48)}-hour rental` : model === "purchase" ? (option.download ? "Downloadable copy" : "Purchase access") : "";
    return `<div class="access-option"><div class="access-option-top"><strong>${escapeHTML(label)}</strong><span class="access-price">${price}</span></div><p>${escapeHTML(desc)}</p>${details ? `<small>${escapeHTML(details)}</small>` : ""}<button class="button ${index===0?"button-primary":"button-outline"} access-action" data-access="${escapeHTML(model)}" type="button"> ${model.startsWith("free") || model==="free" ? "Watch now" : model==="rental" ? "Rent title" : model==="purchase" ? "Buy a copy" : "Unlock viewing"} </button></div>`;
  }).join("");
}
async function renderWatch(id) {
  showView("watch");
  $("#player-loading").hidden = false; $("#video-player").hidden = true; $("#player-error").hidden = true;
  $("#watch-title").textContent = "Loading title…"; $("#watch-description").textContent = "";
  let item = state.titles.find(title => title.id === id) || null;
  if (apiRoot) {
    try { const data = await request(`${config.endpoints.titleDetail}/${encodeURIComponent(id)}`); item = normalizeTitle(data?.title ?? data?.item ?? data); }
    catch (error) { console.info("Title detail endpoint unavailable; using catalogue data.", error); }
  }
  if (!item) {
    $("#player-loading").hidden = true; $("#player-error").hidden = false;
    $("#player-error-message").textContent = apiRoot ? "This title wasn't found. It may have been unpublished or the title endpoint returned no record." : "This title isn't in the local catalogue. TODO: Connect the API or add it to js/content.js.";
    return;
  }
  state.watchTitle = item;
  $("#watch-title").textContent = item.title; $("#watch-type").textContent = `${typeLabel(item)}`;
  $("#watch-meta").textContent = [item.year, item.duration, item.rating === null ? "Not yet rated" : `★ ${item.rating.toFixed(1)} (${item.ratingCount} ratings)`].filter(Boolean).join(" · ");
  $("#watch-description").textContent = item.synopsis || "A work of independent animation.";
  $("#watch-creator").innerHTML = item.creator ? `<a class="watch-creator-link" href="${escapeHTML(creatorLink(item))}"><span class="channel-avatar-small">${escapeHTML(item.creator.slice(0,1).toUpperCase())}</span><span><strong>${escapeHTML(item.creator)}</strong><small></small></span><span class="button button-outline">Visit channel</span></a>` : "";
  $("#watch-rate").onclick = () => { state.ratingTarget = item; state.selectedRating = 0; $("#rating-title").textContent = `Rate "${item.title}"`; $("#rating-review").value = ""; updateRatingPicker(); $("#rating-dialog").showModal(); };
  renderAccessOptions(item);
  $("#watch-related-grid").innerHTML = shuffle(state.titles.filter(t => t.id !== item.id)).slice(0,4).map(cardMarkup).join("");
  const video = $("#video-player");
  video.pause(); video.removeAttribute("src"); video.load();
  let source = item.videoUrl;
  if (apiRoot) {
    try {
      const playback = await request(`${config.endpoints.playback}/${encodeURIComponent(id)}/playback`);
      source = safeUrl(playback?.url ?? playback?.videoUrl ?? playback?.video_url ?? playback?.streamUrl ?? playback?.stream_url) || source;
      const access = playback?.accessOptions ?? playback?.access_options ?? playback?.access;
      if (access) { item.access = access; renderAccessOptions(item); }
    } catch (error) { console.info("Playback manifest not available yet.", error); }
  }
  if (source) {
    video.src = source; video.hidden = false; $("#player-loading").hidden = true;
    video.onerror = () => { video.hidden = true; $("#player-error").hidden = false; $("#player-error-message").textContent = "The media URL could not be played. Check the backend's playback manifest, CORS, codecs, and entitlement checks."; };
    video.onloadedmetadata = () => { $("#player-loading").hidden = true; };
  } else {
    $("#player-loading").hidden = true; $("#player-error").hidden = false;
    $("#player-error-message").textContent = apiRoot ? "The API returned title details but no playable media URL. TODO: Implement the playback manifest endpoint after validating access rights." : "TODO: Connect the FastAPI playback endpoint to provide a media URL or HLS/DASH source.";
  }
  document.title = `${item.title} — Animocha`;
}
async function handleAccess(model) {
  const item = state.watchTitle; if (!item) return;
  if (!apiRoot) return toast("TODO: Connect the FastAPI checkout/access endpoint to validate this option.");
  try {
    const result = await request(config.endpoints.checkout, { method: "POST", body: JSON.stringify({ titleId: item.id, accessModel: model }) });
    if (result?.url) { location.href = safeUrl(result.url) || location.href; return; }
    if (result?.playbackUrl) { const video = $("#video-player"); video.src = safeUrl(result.playbackUrl); video.hidden = false; $("#player-error").hidden = true; return; }
    if (result?.message) toast(result.message); else toast("Access request accepted. Refresh playback when your entitlement is active.");
  } catch (e) { toast(e.message || "Could not confirm access. Sign in or check the title's availability."); }
}
function route() {
  const parts = decodeURIComponent(location.hash.slice(1) || "home").split("/");
  if (parts[0] === "account") return renderAccount(parts[1] || "login");
  if (parts[0] === "channel" && parts[1]) return renderChannel(parts[1]);
  if (parts[0] === "watch" && parts[1]) return renderWatch(parts[1]);
  if (parts[0] === "title" && parts[1]) return renderWatch(parts[1]);
  if (parts[0] === "studio") return renderStudio(parts[1] === "channel" ? "channel" : parts[1] === "monetization" ? "monetization" : parts[1] === "content" ? "content" : "overview");
  if (parts[0] === "legal") return renderLegal(parts[1] === "guidelines" ? "guidelines" : "tos");
  showView("home"); if (parts[0] === "catalog") $("#catalog").scrollIntoView({ behavior: "smooth" });
}

$("#search-form").addEventListener("submit", async event => { event.preventDefault(); state.query = $("#site-search").value.trim(); state.searchResults = null; if (apiRoot && state.query) { try { state.searchResults = unwrapList(await request(`${config.endpoints.search}?q=${encodeURIComponent(state.query)}`)).map(normalizeTitle); } catch (e) { console.warn("Using local search:", e); } } renderCatalog(); showView("home"); $("#catalog").scrollIntoView({ behavior: "smooth" }); });
$("#site-search").addEventListener("input", () => { if (!$("#site-search").value.trim() && state.query) { state.query = ""; state.searchResults = null; renderCatalog(); } });
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
$("#random-sort").addEventListener("change", event => { state.titleOrder = event.target.value; renderDiscovery(); });
$("#random-channel-sort").addEventListener("change", event => { state.channelOrder = event.target.value; renderDiscovery(); });
$("#rated-sort").addEventListener("change", renderDiscovery);
$("#reshuffle-titles").addEventListener("click", () => { state.titleOrder = "shuffle"; $("#random-sort").value = "shuffle"; renderDiscovery(); });
$("#reshuffle-channels").addEventListener("click", () => { state.channelOrder = "shuffle"; $("#random-channel-sort").value = "shuffle"; renderDiscovery(); });
$("#retry-player").addEventListener("click", () => { const id = location.hash.split("/")[1]; if (id) renderWatch(decodeURIComponent(id)); });
$("#access-options").addEventListener("click", event => { const button = event.target.closest("[data-access]"); if (button) handleAccess(button.dataset.access); });
$("#studio-channel-form").addEventListener("submit", async event => {
  event.preventDefault(); const message = $("#studio-channel-message"); message.textContent = "";
  if (!apiRoot) { message.textContent = "Set apiBaseUrl and implement POST /studio/channel to save channel settings."; return; }
  try { await request(config.endpoints.channelSettings, { method: "POST", body: JSON.stringify({ displayName: $("#studio-name").value.trim(), slug: $("#studio-slug").value.trim(), bio: $("#studio-bio").value.trim(), bannerUrl: $("#studio-banner").value.trim() }) }); message.textContent = "Channel profile saved."; toast(message.textContent); await loadChannels(); }
  catch (e) { message.textContent = e.message || "Could not save channel settings."; }
});
$("#monetization-form").addEventListener("submit", async event => {
  event.preventDefault(); const message = $("#monetization-message"); message.textContent = ""; const titleId = $("#monetization-title").value;
  if (!titleId) { message.textContent = "Choose a title first."; return; }
  const enabledOptions = $$(".monetization-option").filter(input => input.checked).map(input => input.value);
  if (!enabledOptions.length) { message.textContent = "Enable at least one access option."; return; }
  const payload = { titleId, enabledOptions, prices: { pay_per_view: Number($("#price-ppv").value || 0), rental: Number($("#price-rental").value || 0), purchase: Number($("#price-purchase").value || 0) }, rentalDurationHours: Number($("#monetization-rental-hours").value || 48), allowDownload: $("#monetization-download").checked };
  if (!apiRoot) { message.textContent = "TODO: Connect the FastAPI creator settings endpoint to persist monetization settings."; return; }
  try { await request(`${config.endpoints.monetization}/${encodeURIComponent(titleId)}/monetization`, { method: "PUT", body: JSON.stringify(payload) }); message.textContent = "Monetization settings saved."; toast(message.textContent); }
  catch (e) { message.textContent = e.message || "Could not save monetization settings."; }
});
window.addEventListener("hashchange", route);
loadContent().then(route);

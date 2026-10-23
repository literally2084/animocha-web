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
  $("#studio-title-count").textContent = String(state.titles.length);
  document.title = `${panel === "overview" ? "Studio" : panel[0].toUpperCase()+panel.slice(1)} — Animocha`;
}
function renderLegal(section = "tos") {
  showView("legal"); const guidelines = section === "guidelines";
  $("#legal-heading").textContent = guidelines ? "Community Guidelines" : "Terms of Service";
  $("#legal-subheading").textContent = guidelines ? "Keep Animocha welcoming, honest, and creatively generous." : "Clear expectations for creators, viewers, and independent work.";
  $("#legal-tos").hidden = guidelines; $("#legal-guidelines").hidden = !guidelines;
  document.title = `${$("#legal-heading").textContent} — Animocha`;
}
const utilityPages = {
  library: { eyebrow: "YOUR SPACE", title: "My library", intro: "Pick up where you left off, and keep the animation you love close.", action: "Sign in to sync your library", href: "#account/login", endpoint: "library", empty: "Your saved and recently watched titles will appear here when your account is connected." },
  purchases: { eyebrow: "YOUR COLLECTION", title: "Purchases & rentals", intro: "A clear home for purchases, active rentals, and downloadable copies.", action: "Sign in to view entitlements", href: "#account/login", endpoint: "purchases", empty: "Your purchases and active rentals will appear here." },
  notifications: { eyebrow: "WHAT'S NEW", title: "Notifications", intro: "Updates from channels you follow and important account activity.", action: "Sign in to see notifications", href: "#account/login", endpoint: "notifications", empty: "You're all caught up. New updates will appear here." },
  privacy: { eyebrow: "YOUR DATA", title: "Privacy center", intro: "Manage how your account, viewing activity, and creator data are handled.", body: `<div class="utility-card"><h2>Privacy principles</h2><ul><li>Collect only data needed to run and secure the service.</li><li>Keep payment details with a compliant payment provider; do not store raw card numbers.</li><li>Explain analytics, cookies, personalization, and retention in a final privacy policy.</li><li>Provide account export and deletion workflows as required by law.</li></ul><p class="legal-notice">This is a product checklist, not a published privacy policy. Have the final policy reviewed before launch.</p><a class="button button-outline" href="#help">Ask a privacy question</a></div>` },
  help: { eyebrow: "ANIMOCHA SUPPORT", title: "How can we help?", intro: "Find help with playback, accounts, creator publishing, or purchases.", body: `<div class="utility-card-grid"><article class="utility-card"><h2>Watching & playback</h2><p>Playback problems, video quality, captions, and supported devices.</p></article><article class="utility-card"><h2>Accounts & safety</h2><p>Sign-in, account security, privacy, and moderation concerns.</p></article><article class="utility-card"><h2>Payments & access</h2><p>Rentals, pay-per-view access, refunds, and downloadable copies.</p></article><article class="utility-card"><h2>Creator support</h2><p>Publishing, channel setup, monetization, analytics, and payouts.</p></article></div><form class="utility-form" id="help-form"><label>Your email<input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label><label>Topic<select name="topic"><option>Playback</option><option>Account</option><option>Purchase or rental</option><option>Creator studio</option><option>Privacy</option><option>Other</option></select></label><label>How can we help?<textarea name="message" rows="5" required maxlength="4000" placeholder="Describe what happened…"></textarea></label><button class="button button-primary" type="submit">Send support request</button><p class="form-message" role="status"></p></form>` },
  report: { eyebrow: "KEEP THE CAFE SAFE", title: "Report a concern", intro: "Report a title, review, channel, or behavior that may violate Animocha's policies.", body: `<div class="utility-card"><p>Reports should include enough detail for a moderator to review. For urgent threats or immediate danger, contact local emergency services.</p><a href="#legal/guidelines" class="text-action">Review community guidelines ↗</a></div><form class="utility-form" id="report-form"><label>What are you reporting?<select name="targetType"><option value="title">Animation / title</option><option value="channel">Creator channel</option><option value="review">Rating or review</option><option value="account">Account or behavior</option><option value="copyright">Copyright concern</option><option value="safety">Safety concern</option></select></label><label>Link or title ID<input name="target" required maxlength="500" placeholder="Paste a link or enter the title/channel name"></label><label>Details<textarea name="details" rows="5" required maxlength="4000" placeholder="Explain the concern and relevant context…"></textarea></label><label class="consent-line"><input type="checkbox" name="goodFaith" required> I am submitting this report in good faith.</label><button class="button button-primary" type="submit">Submit report</button><p class="form-message" role="status"></p></form>` },
  "privacy-policy": { eyebrow: "POLICIES", title: "Privacy policy", intro: "A readable outline of what Animocha should disclose about personal data.", body: `<article class="legal-document"><p class="legal-notice">Draft template only. TODO: add the real operator identity, contact details, legal bases, vendors, and effective date, etc..</p><h2>Information you provide</h2><p>Account details, channel information, uploaded content, ratings, reviews, support requests, and creator payment onboarding status.</p><h2>Service and device information</h2><p>Security logs, essential diagnostics, and limited usage events needed to provide playback, prevent abuse, measure reliability, and improve the service. Disclose any analytics or advertising technology actually used.</p><h2>Payments</h2><p>Payments should be handled by a qualified payment processor. Animocha should retain transaction identifiers and entitlement records, not raw payment card data.</p><h2>Your choices and rights</h2><p>Explain how users can access, correct, export, or delete personal information and how they can contact the privacy team. Rights vary by location.</p><h2>Retention and security</h2><p>Define retention periods by data category and document administrative, technical, and organizational safeguards. No system can promise absolute security.</p></article>` },
  refunds: { eyebrow: "BILLING POLICIES", title: "Refunds & digital purchases", intro: "Explain the rules for pay-per-view, timed rentals, and downloadable-copy purchases before checkout.", body: `<article class="legal-document"><p class="legal-notice">Draft policy: adapt to applicable consumer law, payment-provider rules, and the actual product behavior before launch.</p><h2>Before you pay</h2><p>Show the total price, currency, access model, rental window, download availability, and applicable license before a user confirms payment.</p><h2>Playback problems</h2><p>Provide a support path for failed playback, duplicate charges, unavailable titles, or a purchase that was not attached to the account.</p><h2>Refund decisions</h2><p>Define eligibility, request deadlines, processing times, and exceptions clearly. Never imply that a policy removes rights that cannot legally be waived.</p><h2>Creator earnings</h2><p>Explain chargebacks, refunds, platform fees, taxes, payout timing, and how reversals affect creator balances.</p><a class="button button-outline" href="#help">Contact support</a></article>` },
  accessibility: { eyebrow: "ACCESS FOR EVERYONE", title: "Accessibility", intro: "Independent animation should be easier to discover and enjoy for as many people as possible.", body: `<div class="utility-card-grid"><article class="utility-card"><h2>Captions & transcripts</h2><p>Support timed captions, subtitles, transcripts, and clear language selection where available.</p></article><article class="utility-card"><h2>Keyboard support</h2><p>Keep all navigation and player controls usable with a keyboard, with visible focus indicators.</p></article><article class="utility-card"><h2>Reduced motion</h2><p>Respect system reduced-motion preferences and provide controls for autoplaying previews or carousels.</p></article><article class="utility-card"><h2>Readable interfaces</h2><p>Maintain contrast, scalable text, meaningful alt text, semantic headings, and clear form errors.</p></article></div><p class="section-note">Set a target accessibility standard and test with assistive technology before launch.</p>` },
  copyright: { eyebrow: "CREATOR RIGHTS", title: "Copyright & takedowns", intro: "A clear path for rights holders and creators to raise copyright concerns.", body: `<article class="legal-document"><p class="legal-notice">The takedown process and designated contact must be reviewed for the jurisdictions where Animocha operates.</p><h2>Submitting a notice</h2><p>Ask the reporter to identify the protected work, the allegedly infringing URL, their authority to act, and required declarations. Collect only necessary information.</p><h2>Creator response</h2><p>Define how creators are notified, how counter-notices or appeals work where applicable, and how repeat infringement is handled.</p><h2>Preserving records</h2><p>Keep an auditable record of notices, actions, decisions, and deadlines while applying appropriate retention and privacy controls.</p><a class="button button-primary" href="#report">Report a copyright concern</a></article>` },
  settings: { eyebrow: "ACCOUNT", title: "Settings", intro: "Account preferences, accessibility, and security controls belong in one place.", body: `<div class="utility-card-grid"><article class="utility-card"><h2>Profile</h2><p>Manage display name, avatar, and public profile visibility.</p><a class="text-action" href="#channel/me">Open profile ↗</a></article><article class="utility-card"><h2>Security</h2><p>Change password, review active sessions, and configure two-factor authentication.</p><span class="section-note">Requires authenticated backend endpoints.</span></article><article class="utility-card"><h2>Playback & accessibility</h2><p>Set captions, autoplay, reduced motion, and preferred playback quality.</p><span class="section-note">Preferences can be saved to your account.</span></article><article class="utility-card"><h2>Privacy</h2><p>Review data practices and request a copy or deletion of your account data.</p><a class="text-action" href="#privacy">Open privacy center ↗</a></article></div>` },
  'studio-upload': { eyebrow: "PUBLISH YOUR WORK", title: "Upload a title", intro: "Create a draft, add artwork and metadata, then publish when everything is ready.", body: `<div class="utility-card"><p>Upload UI is somewhat of a placeholder currently as the backend is being developed. TODO: The backend must validate file type and size, store media privately, process transcoding, and return upload status before a title can be published.</p></div><form class="utility-form" id="upload-form"><label>Title<input name="title" required maxlength="140" placeholder="Animation title"></label><label>Format<select name="type"><option value="film">Film</option><option value="series">Series / episode</option><option value="short">Short</option><option value="loop">Loop</option></select></label><label>Synopsis<textarea name="synopsis" rows="4" maxlength="5000" placeholder="What is this animation about?"></textarea></label><label>Thumbnail URL<input name="thumbnailUrl" type="url" placeholder="https://…"></label><label>Banner URL<input name="bannerUrl" type="url" placeholder="https://…"></label><label>Video file<input name="file" type="file" accept="video/*" required></label><label class="consent-line"><input type="checkbox" name="rightsConfirmed" required> I have the rights and permissions needed to publish this work.</label><button class="button button-primary" type="submit">Create upload draft</button><p class="form-message" role="status"></p></form>` },
  'studio-analytics': { eyebrow: "CREATOR INSIGHTS", title: "Analytics", intro: "Understand reach, watch time, ratings, and revenue without hiding the numbers that matter.", endpoint: "analytics", body: `<div class="utility-stat-grid"><article class="studio-stat"><span>Views</span><strong data-metric="views">—</strong></article><article class="studio-stat"><span>Watch time</span><strong data-metric="watchTimeHours">—</strong></article><article class="studio-stat"><span>Average rating</span><strong data-metric="averageRating">—</strong></article><article class="studio-stat"><span>Estimated revenue</span><strong data-metric="estimatedRevenue">—</strong></article></div><div class="utility-card"><h2>Analytics should be transparent</h2><p>Define view qualification, reporting delay, refunds, ad revenue share, and timezone in the API contract. Do not treat client-side events as authoritative revenue records.</p></div>` },
  'studio-payouts': { eyebrow: "CREATOR EARNINGS", title: "Payouts", intro: "Track available balance, payout history, and setup requirements.", endpoint: "payouts", body: `<div class="utility-stat-grid"><article class="studio-stat"><span>Available balance</span><strong data-metric="availableBalance">—</strong></article><article class="studio-stat"><span>Pending balance</span><strong data-metric="pendingBalance">—</strong></article><article class="studio-stat"><span>Next payout</span><strong data-metric="nextPayoutDate">—</strong></article></div><div class="utility-card"><h2>Payout setup</h2><p>Connect a payment provider's hosted onboarding flow. Keep identity verification and bank details with the provider; never collect full bank credentials in a generic frontend form.</p><button class="button button-primary" type="button" data-action="payout-setup">Set up payouts</button></div><div id="payout-history" class="utility-card"><h2>Payout history</h2><p class="muted-copy">History will load from the creator payout endpoint.</p></div>` },
};
function renderUtility(routeKey) {
  showView("utility");
  const page = utilityPages[routeKey] || utilityPages.help;
  const endpointName = page.endpoint;
  const body = page.body || `<div class="utility-card"><div class="utility-empty-mark">✳</div><h2>Nothing here yet</h2><p>${escapeHTML(page.empty || "Connect the corresponding FastAPI endpoint to show this account data.")}</p><a class="button button-primary" href="${page.href || "#account/login"}">${escapeHTML(page.action || "Sign in")}</a></div>`;
  const studioNav = routeKey.startsWith("studio-") ? `<nav class="studio-nav" aria-label="Creator studio"><a href="#studio">Overview</a><a href="#studio/upload">Upload</a><a href="#studio/channel">Channel setup</a><a href="#studio/monetization">Monetization</a><a href="#studio/content">Your titles</a><a href="#studio/analytics">Analytics</a><a href="#studio/payouts">Payouts</a></nav>` : "";
  $("#utility-content").innerHTML = `<div class="page-intro"><p class="eyebrow">${escapeHTML(page.eyebrow)}</p><h1>${escapeHTML(page.title)}</h1><p>${escapeHTML(page.intro)}</p>${studioNav}</div><div class="utility-body">${body}</div>`;
  document.title = `${page.title} — Animocha`;
  if (endpointName && apiRoot && ["library", "purchases", "notifications", "analytics", "payouts"].includes(endpointName)) {
    request(config.endpoints[endpointName]).then(data => {
      const root = data?.data ?? data ?? {};
      if (endpointName === "analytics" || endpointName === "payouts") {
        for (const node of $$('[data-metric]', $("#utility-content"))) {
          const value = root[node.dataset.metric];
          if (value !== undefined && value !== null) node.textContent = typeof value === "number" && /revenue|balance/i.test(node.dataset.metric) ? new Intl.NumberFormat(undefined, { style: "currency", currency: root.currency || "USD" }).format(value) : String(value);
        }
        if (endpointName === "payouts" && Array.isArray(root.history)) $("#payout-history").innerHTML = `<h2>Payout history</h2>${root.history.length ? `<ul>${root.history.map(row => `<li>${escapeHTML(row.date || row.createdAt || "Pending date")} · ${escapeHTML(row.status || "Processing")} · ${escapeHTML(row.amount ?? "—")}</li>`).join("")}</ul>` : `<p class="muted-copy">No payout history returned yet.</p>`}`;
      } else {
        const items = unwrapList(root);
        const container = $("#utility-content .utility-card");
        if (items.length && container) container.innerHTML = `<h2>${escapeHTML(page.title)}</h2><div class="utility-list">${items.map(item => `<a href="${escapeHTML(item.href || (item.titleId ? `#watch/${encodeURIComponent(item.titleId)}` : item.slug ? `#channel/${encodeURIComponent(item.slug)}` : "#home"))}"><strong>${escapeHTML(item.title || item.displayName || item.message || item.name || "Animocha update")}</strong><span>${escapeHTML(item.subtitle || item.status || item.createdAt || "Open item")}</span></a>`).join("")}</div>`;
      }
    }).catch(error => console.info(`${endpointName} endpoint not available yet.`, error));
  }
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
    container.innerHTML = `<div class="access-option"><strong>Free to watch</strong><p>Availability is determined by this title's creator.</p><button class="button button-primary access-action" data-access="free" type="button">Check availability</button></div><p class="legal-small"></p>`;
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
  if (parts[0] === "studio" && ["upload", "analytics", "payouts"].includes(parts[1])) return renderUtility(`studio-${parts[1]}`);
  if (parts[0] === "studio") return renderStudio(parts[1] === "channel" ? "channel" : parts[1] === "monetization" ? "monetization" : parts[1] === "content" ? "content" : "overview");
  if (parts[0] === "legal") return renderLegal(parts[1] === "guidelines" ? "guidelines" : "tos");
  if (["library", "purchases", "notifications", "privacy", "privacy-policy", "refunds", "accessibility", "copyright", "help", "report", "settings"].includes(parts[0])) return renderUtility(parts[0]);
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
document.addEventListener("submit", async event => {
  const form = event.target;
  if (!form.matches("#help-form, #report-form, #upload-form")) return;
  event.preventDefault();
  const message = form.querySelector('.form-message');
  const data = new FormData(form);
  if (form.id === "upload-form") {
    const file = data.get("file");
    if (file && file.size > 2 * 1024 * 1024 * 1024) { message.textContent = "This file is over the 2 GB template limit. Adjust the limit to match your storage service."; return; }
    if (!apiRoot) { message.textContent = "Upload form ready. Configure the FastAPI upload flow and object storage before accepting media."; return; }
    message.textContent = "The upload endpoint must be implemented with a signed-upload or multipart workflow before media can be sent. See README.md.";
    return;
  }
  const endpoint = form.id === "report-form" ? config.endpoints.report : config.endpoints.help;
  if (!apiRoot) { message.textContent = "Form ready. Configure the matching FastAPI endpoint to submit this request."; return; }
  const payload = Object.fromEntries(data.entries());
  try { await request(endpoint, { method: "POST", body: JSON.stringify(payload) }); message.textContent = "Thank you. Your request has been submitted."; form.reset(); }
  catch (error) { message.textContent = error.message || "We couldn't submit this request."; }
});
document.addEventListener("click", async event => {
  const button = event.target.closest('[data-action="payout-setup"]');
  if (!button) return;
  if (!apiRoot) return toast("Connect the creator payout onboarding endpoint first.");
  try { const result = await request(`${config.endpoints.payouts}/onboarding`, { method: "POST", body: JSON.stringify({ returnUrl: `${location.origin}${location.pathname}#studio/payouts` }) }); if (result?.url) location.href = safeUrl(result.url) || location.href; else toast("Payout onboarding request accepted."); }
  catch (error) { toast(error.message || "Could not start payout setup."); }
});

window.addEventListener("hashchange", route);
loadContent().then(route);

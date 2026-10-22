import { config } from "./config.js";

/**
 * small backend adapter for Animocha.
 * the UI depends on these methods, not on a specific backend vendor.
 * TODO: Return JSON from the API and map its fields in normalizeLive/normalizeVideo.
 */
const apiRoot = config.apiBaseUrl.replace(/\/$/, "");

async function request(path, options = {}) {
    if (!apiRoot) {
        throw new Error("Animocha API is not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
        const response = await fetch(`${apiRoot}${path}`, {
            ...options,
            signal: options.signal ?? controller.signal,
            headers: {
                Accept: "application/json",
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...options.headers,
            },
            credentials: "include",
        });

        if (!response.ok) {
            throw new Error(`API request failed (${response.status}): ${path}`);
        }

        if (response.status === 204) return null;
        return response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function endpoint(name) {
    return config.endpoints[name];
}

export const api = {
    isConfigured: Boolean(apiRoot),

    getLiveStreams() {
        return request(endpoint("live"));
    },

    getVideos() {
        return request(endpoint("videos"));
    },

    getCommunities() {
        return request(endpoint("communities"));
    },

    getCurrentUser() {
        return request(endpoint("currentUser"));
    },

    getNotifications() {
        return request(endpoint("notifications"));
    },

    search(query) {
        const url = `${endpoint("search")}?q=${encodeURIComponent(query)}`;
        return request(url);
    },

    /** basic method for connecting new features without changing the UI adapter. */
    request,
};

export function unwrapList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
}

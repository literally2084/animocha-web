/** Configure a compatible API base URL here. Leave empty to run the frontend without a backend. */
export const config = Object.freeze({
  apiBaseUrl: "",
  requestTimeoutMs: 10000,
  endpoints: {
    titles: "/titles",
    live: "/streams?status=live",
    search: "/search",
    ratings: "/ratings",
    login: "/auth/login",
    signup: "/auth/signup",
    me: "/auth/me",
    channels: "/channels",
    follow: "/channels/follow",
  },
});

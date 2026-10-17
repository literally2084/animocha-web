const API_BASE_URL = "/api/v1";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function getCreators() {
  return request("/creators");
}

export function getChannel(username) {
  return request(
    `/channels/${encodeURIComponent(username)}`
  );
}

export function getMedia(mediaId) {
  return request(
    `/media/${encodeURIComponent(mediaId)}`
  );
}

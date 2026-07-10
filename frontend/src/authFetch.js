export function getToken() {
  return localStorage.getItem("taifa_token");
}

export function setToken(token) {
  localStorage.setItem("taifa_token", token);
}

export function clearToken() {
  localStorage.removeItem("taifa_token");
}

export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    clearToken();
    window.location.reload();
  }

  return response;
}

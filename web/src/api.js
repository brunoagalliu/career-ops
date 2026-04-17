export function getToken()        { return localStorage.getItem('token') }
export function setToken(token)   { localStorage.setItem('token', token) }
export function clearToken()      { localStorage.removeItem('token') }

export function authFetch(url, opts = {}) {
  const token = getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...opts.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

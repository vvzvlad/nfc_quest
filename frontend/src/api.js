// api.js — HTTP and WebSocket client for NFC Quest backend

// Base URL: in dev Vite proxies /api to localhost:5000,
// in production the backend serves both API and frontend.
const BASE = '';

// ─── localStorage helpers ─────────────────────────────────────────────────
const STORAGE_KEY = 'nfc_quest_player';

export function getLocalPlayer() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

export function setLocalPlayer(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearLocalPlayer() {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────
async function post(url, body) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function get(url) {
  const res = await fetch(BASE + url, { credentials: 'include' });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function del(url) {
  const res = await fetch(BASE + url, { method: 'DELETE', credentials: 'include' });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function put(url, body) {
  const res = await fetch(BASE + url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// ─── Game API ──────────────────────────────────────────────────────────────
export const api = {
  register: (player_id, nick) => post('/api/register', { player_id, nick }),
  scan: (tag_id, player_id) => post('/api/scan', { tag_id, player_id }),
  scoreboard: () => get('/api/scoreboard'),
  config: () => get('/api/config'),
};

// ─── Admin API ─────────────────────────────────────────────────────────────
export const adminApi = {
  login: (password) => post('/admin/api/login', { password }),
  logout: () => post('/admin/api/logout', {}),
  me: () => get('/admin/api/me'),

  getGame: () => get('/admin/api/game'),
  updateGame: (data) => put('/admin/api/game', data),
  startGame: () => post('/admin/api/game/start', {}),
  stopGame: () => post('/admin/api/game/stop', {}),

  getPlayers: (params = {}) => get('/admin/api/players?' + new URLSearchParams(params)),
  adjustPlayer: (id, delta) => post(`/admin/api/players/${id}/adjust`, { delta }),
  deletePlayer: (id) => del(`/admin/api/players/${id}`),
  deleteAllPlayers: () => del('/admin/api/players'),

  getTags: (params = {}) => get('/admin/api/tags?' + new URLSearchParams(params)),
  createTagsBatch: (data) => post('/admin/api/tags/batch', data),
  updateTag: (id, data) => put(`/admin/api/tags/${id}`, data),
  deleteTag: (id) => del(`/admin/api/tags/${id}`),
  resetTag: (id) => post(`/admin/api/tags/${id}/reset`, {}),
  deleteAllTags: () => del('/admin/api/tags'),

  getLog: (params = {}) => get('/admin/api/log?' + new URLSearchParams(params)),
  getStats: () => get('/admin/api/stats'),
  getStrategies: () => get('/admin/api/strategies'),
};

// ─── WebSocket (Socket.IO) ─────────────────────────────────────────────────
// Lazy-loaded: import socket.io-client only when first called.
let _socket = null;

export function connectSocket(onUpdate) {
  // Dynamically import socket.io-client to avoid bundling it at startup
  import('socket.io-client').then(({ io }) => {
    if (_socket) {
      _socket.off('scoreboard_update');
      _socket.disconnect();
    }
    _socket = io(BASE || window.location.origin, { withCredentials: true });
    _socket.on('scoreboard_update', onUpdate);
    _socket.on('connect', () => {
      // Server sends current scoreboard on connect
    });
  });
}

export function disconnectSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

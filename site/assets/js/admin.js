// Moderation page for rememberdonnie.com/admin. The key is checked by the API on every call.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const KEY_STORAGE = 'rememberdonnie:admin-key';

const state = { key: '', memories: [], view: 'pending' };

const keyStore = {
  get() { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem(KEY_STORAGE, v); } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(KEY_STORAGE); } catch { /* private mode */ } },
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) node.append(child);
  return node;
}

let toastTimer;
function toast(message) {
  const node = $('[data-toast]');
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 3000);
}

async function adminApi(method, body) {
  const res = await fetch('/api/admin/memories', {
    method,
    headers: { 'x-admin-key': state.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const REASONS = {
  photo: 'Has a photo',
  link: 'Contains a link',
  unverified: 'Not sent from the form',
  all: 'All memories are reviewed',
};

function card(memory) {
  const item = el('article', { class: `admin-item admin-item--${memory.status}` });
  if (memory.photoPreview) {
    item.append(el('a', { class: 'admin-item__photo', href: memory.photoPreview, target: '_blank', rel: 'noopener' },
      el('img', { src: memory.photoPreview, alt: `Photo from ${memory.name}`, loading: 'lazy' })));
  }
  const body = el('div', { class: 'admin-item__body' });
  const meta = el('p', { class: 'admin-item__meta' },
    el('strong', {}, memory.name),
    memory.relation ? ` · ${memory.relation}` : '',
    ` · ${dateTime.format(new Date(memory.createdAt))}`);
  const badges = el('p', { class: 'admin-item__badges' }, el('span', { class: `badge badge--${memory.status}` }, memory.status === 'approved' ? 'On the wall' : memory.status === 'pending' ? 'Waiting' : 'Hidden'));
  if (memory.status === 'pending' && memory.reviewReason) badges.append(el('span', { class: 'badge' }, REASONS[memory.reviewReason] || memory.reviewReason));
  body.append(meta, badges, el('p', { class: 'admin-item__message' }, memory.message));

  const actions = el('div', { class: 'admin-item__actions' });
  const action = (label, name, style) => {
    const button = el('button', { class: `btn btn--small ${style}`, type: 'button' }, label);
    button.addEventListener('click', () => act(memory, name, button));
    return button;
  };
  if (memory.status !== 'approved') actions.append(action('Approve', 'approve', 'btn--navy'));
  if (memory.status !== 'hidden') actions.append(action('Hide', 'hide', 'btn--ghost'));
  actions.append(action('Delete', 'delete', 'btn--ghost admin-danger'));
  body.append(actions);
  item.append(body);
  return item;
}

function render() {
  const counts = { pending: 0, approved: 0, hidden: 0 };
  for (const m of state.memories) counts[m.status] = (counts[m.status] || 0) + 1;
  for (const [key, value] of Object.entries(counts)) $(`[data-stat="${key}"]`).textContent = value;
  for (const button of $$('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));

  const list = state.view === 'all' ? state.memories : state.memories.filter((m) => m.status === state.view);
  $('[data-list]').replaceChildren(...list.map(card));
  $('[data-empty]').hidden = list.length > 0;
  $('[data-empty]').textContent = state.view === 'pending' ? 'Nothing is waiting for review.' : 'Nothing here.';
}

async function load() {
  const data = await adminApi('GET');
  state.memories = data.memories;
  $('[data-stat="candles"]').textContent = (data.candles || 0).toLocaleString('en-US');
  render();
}

async function act(memory, action, button) {
  if (action === 'delete' && !confirm(`Permanently delete the memory from ${memory.name}${memory.photoId ? ' and its photo' : ''}? This cannot be undone.`)) return;
  button.disabled = true;
  try {
    await adminApi('POST', { id: memory.id, action });
    toast(action === 'approve' ? 'Approved. It’s on the wall.' : action === 'hide' ? 'Hidden from the wall.' : 'Deleted.');
    await load();
  } catch (err) {
    toast(err.message);
    button.disabled = false;
  }
}

async function signIn(key) {
  state.key = key;
  try {
    await load();
  } catch (err) {
    state.key = '';
    if (err.status === 401) keyStore.clear();
    throw err;
  }
  keyStore.set(key);
  $('[data-login]').hidden = true;
  $('[data-dashboard]').hidden = false;
  $('[data-sign-out]').hidden = false;
}

$('[data-login]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('[data-login-error]');
  error.hidden = true;
  try {
    await signIn($('#admin-key').value.trim());
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

$('[data-sign-out]').addEventListener('click', () => {
  keyStore.clear();
  location.reload();
});

$('[data-refresh]').addEventListener('click', () => load().then(() => toast('Up to date.')).catch((err) => toast(err.message)));

for (const button of $$('[data-view]')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    render();
  });
}

const saved = keyStore.get();
if (saved) signIn(saved).catch(() => {});

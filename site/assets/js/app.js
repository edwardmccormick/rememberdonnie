// rememberdonnie.com — no framework, no build step. Built to last.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

document.documentElement.classList.add('js');

// ------------------------------------------------------------------ helpers

const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  },
};

/** createElement with attributes and text/children. Never sets innerHTML. */
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

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const error = new Error(data?.error || 'Something went wrong. Please try again in a moment.');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

let toastTimer;
function toast(message) {
  const node = $('[data-toast]');
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 3600);
}

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const formatDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? '' : dateFormat.format(d);
};

/** Deterministic 0..1 noise so candles keep their heights between renders. */
const noise = (i) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// ------------------------------------------------------------------ nav

function initNav() {
  const nav = $('[data-nav]');
  const hero = $('[data-hero]');
  new IntersectionObserver(([entry]) => nav.classList.toggle('is-visible', !entry.isIntersecting), {
    rootMargin: '-40% 0px 0px 0px',
  }).observe(hero);

  const links = new Map($$('[data-nav-link]').map((a) => [a.getAttribute('href').slice(1), a]));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const [id, link] of links) link.classList.toggle('is-active', id === entry.target.id);
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  for (const id of links.keys()) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }
}

// ------------------------------------------------------------------ reveal on scroll

function initReveal() {
  const items = $$('[data-reveal]');
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }
  // Stagger siblings that reveal together.
  for (const item of items) {
    const siblings = [...item.parentElement.children].filter((c) => c.hasAttribute('data-reveal'));
    const index = siblings.indexOf(item);
    if (index > 0) item.style.transitionDelay = `${index * 110}ms`;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  items.forEach((item) => observer.observe(item));
}

// ------------------------------------------------------------------ hero: drifting motes of light

function initMotes() {
  const canvas = $('[data-motes]');
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let particles = [];
  let running = false;
  let onScreen = true;
  let frame = 0;

  const spawn = (anywhere) => ({
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + 12,
    r: 0.6 + Math.random() * 2.1,
    vy: 0.1 + Math.random() * 0.28,
    sway: Math.random() * Math.PI * 2,
    swaySpeed: 0.002 + Math.random() * 0.006,
    alpha: 0.25 + Math.random() * 0.55,
    twinkle: Math.random() * Math.PI * 2,
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(64, Math.max(18, (width * height) / 20000)));
    particles = Array.from({ length: count }, () => spawn(true));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      if (running) {
        p.y -= p.vy;
        p.sway += p.swaySpeed;
        p.twinkle += 0.018;
        if (p.y < -12) Object.assign(p, spawn(false));
      }
      const x = p.x + Math.sin(p.sway) * 16;
      const a = p.alpha * (0.6 + 0.4 * Math.sin(p.twinkle));
      const glow = ctx.createRadialGradient(x, p.y, 0, x, p.y, p.r * 4);
      glow.addColorStop(0, `rgba(255, 249, 226, ${a})`);
      glow.addColorStop(0.35, `rgba(255, 236, 190, ${a * 0.45})`);
      glow.addColorStop(1, 'rgba(255, 236, 190, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, p.y, p.r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (running) frame = requestAnimationFrame(draw);
  }

  function update() {
    const shouldRun = onScreen && !document.hidden && !reducedMotion.matches;
    if (shouldRun && !running) {
      running = true;
      frame = requestAnimationFrame(draw);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(frame);
    }
  }

  resize();
  draw();
  new ResizeObserver(() => {
    resize();
    if (!running) draw();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    update();
  }).observe(canvas);
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener?.('change', update);
  update();
}

// ------------------------------------------------------------------ lightbox

function openLightbox(src, caption = '', alt = '') {
  const dialog = $('[data-lightbox-dialog]');
  const img = $('[data-lightbox-img]', dialog);
  img.src = src;
  img.alt = alt || caption;
  $('[data-lightbox-caption]', dialog).textContent = caption;
  dialog.showModal();
}

function initLightbox() {
  const dialog = $('[data-lightbox-dialog]');
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.classList.contains('lightbox__figure')) dialog.close();
  });
  for (const button of $$('[data-lightbox]')) {
    button.addEventListener('click', () => openLightbox(button.dataset.lightbox, button.dataset.lightboxCaption, button.dataset.lightboxAlt));
  }
}

// ------------------------------------------------------------------ memory wall

const PAGE_SIZE = 24;
const ROW_UNIT = 4;
const ROW_GAP = 24;

const wall = {
  memories: [],
  filter: 'all',
  shown: PAGE_SIZE,
  highlightId: null,
  layoutFrame: 0,
};

function wallNodes() {
  return {
    grid: $('[data-wall]'),
    toolbar: $('[data-wall-toolbar]'),
    count: $('[data-memory-count]'),
    empty: $('[data-wall-empty]'),
    error: $('[data-wall-error]'),
    more: $('[data-wall-more]'),
    filters: $$('[data-filter]'),
  };
}

function memoryCard(memory, isNew) {
  const card = el('article', { class: `memory${isNew ? ' is-new' : ''}`, 'data-id': memory.id });
  if (isNew) card.append(el('span', { class: 'memory__new-badge' }, 'Just shared'));

  if (memory.photo) {
    const label = `Photo shared by ${memory.name}`;
    const img = el('img', { src: memory.photo, alt: label, loading: 'lazy', decoding: 'async' });
    if (memory.photoWidth && memory.photoHeight) {
      img.width = memory.photoWidth;
      img.height = memory.photoHeight;
    }
    img.addEventListener('load', scheduleLayout);
    const button = el('button', { class: 'memory__photo', type: 'button', 'aria-label': `View the photo ${memory.name} shared` }, img);
    button.addEventListener('click', () => openLightbox(memory.photo, `Shared by ${memory.name}`, label));
    card.append(button);
  }

  const body = el('div', { class: 'memory__body' });
  body.append(el('span', { class: 'memory__mark', 'aria-hidden': 'true' }, '“'));
  body.append(el('p', { class: 'memory__message' }, memory.message));

  const by = el('footer', { class: 'memory__by' }, el('span', { class: 'memory__name' }, memory.name));
  if (memory.relation) by.append(el('span', { class: 'memory__relation' }, memory.relation));
  by.append(el('time', { class: 'memory__date', datetime: memory.createdAt }, formatDate(memory.createdAt)));
  body.append(by);
  card.append(body);
  return card;
}

/** Clamp long memories with a "Read more" toggle. Runs once per card. */
function clampLongMessages(grid) {
  for (const message of $$('.memory__message:not([data-checked])', grid)) {
    message.dataset.checked = '';
    if (message.textContent.length < 420) continue;
    message.classList.add('is-clamped');
    if (message.scrollHeight <= message.clientHeight + 2) {
      message.classList.remove('is-clamped');
      continue;
    }
    const toggle = el('button', { class: 'memory__more', type: 'button', 'aria-expanded': 'false' }, 'Read more');
    toggle.addEventListener('click', () => {
      const expanded = message.classList.toggle('is-clamped') === false;
      toggle.textContent = expanded ? 'Show less' : 'Read more';
      toggle.setAttribute('aria-expanded', String(expanded));
      scheduleLayout();
    });
    message.after(toggle);
  }
}

function layoutWall() {
  const { grid } = wallNodes();
  const cards = $$('.memory', grid);
  if (!cards.length) return;
  clampLongMessages(grid);
  grid.classList.add('is-laid-out');
  for (const card of cards) {
    const height = card.getBoundingClientRect().height;
    card.style.gridRowEnd = `span ${Math.ceil((height + ROW_GAP) / ROW_UNIT)}`;
  }
}

function scheduleLayout() {
  cancelAnimationFrame(wall.layoutFrame);
  wall.layoutFrame = requestAnimationFrame(layoutWall);
}

function renderWall() {
  const nodes = wallNodes();
  const total = wall.memories.length;
  const withPhotos = wall.memories.filter((m) => m.photo).length;
  const visible = wall.filter === 'photos' ? wall.memories.filter((m) => m.photo) : wall.memories;

  nodes.toolbar.hidden = total === 0;
  nodes.empty.hidden = total !== 0;
  nodes.count.textContent = total === 1 ? '1 memory shared' : `${total.toLocaleString('en-US')} memories shared`;
  $('.segmented', nodes.toolbar).hidden = withPhotos === 0;
  for (const button of nodes.filters) button.setAttribute('aria-pressed', String(button.dataset.filter === wall.filter));

  nodes.grid.classList.remove('is-laid-out');
  nodes.grid.replaceChildren(...visible.slice(0, wall.shown).map((m) => memoryCard(m, m.id === wall.highlightId)));
  nodes.more.hidden = visible.length <= wall.shown;
  scheduleLayout();
}

async function loadMemories() {
  const nodes = wallNodes();
  nodes.error.hidden = true;
  nodes.grid.setAttribute('aria-busy', 'true');
  try {
    const data = await api('/api/memories');
    wall.memories = data.memories || [];
    renderWall();
  } catch {
    nodes.grid.replaceChildren();
    nodes.toolbar.hidden = true;
    nodes.error.hidden = false;
  } finally {
    nodes.grid.setAttribute('aria-busy', 'false');
  }
}

function addMemoryToWall(memory) {
  wall.memories = [memory, ...wall.memories.filter((m) => m.id !== memory.id)];
  wall.filter = 'all';
  wall.highlightId = memory.id;
  renderWall();
}

function initWall() {
  const nodes = wallNodes();
  for (const button of nodes.filters) {
    button.addEventListener('click', () => {
      wall.filter = button.dataset.filter;
      wall.shown = PAGE_SIZE;
      renderWall();
    });
  }
  nodes.more.addEventListener('click', () => {
    wall.shown += PAGE_SIZE;
    renderWall();
  });
  $('[data-wall-retry]').addEventListener('click', loadMemories);

  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width !== lastWidth) {
      lastWidth = width;
      scheduleLayout();
    }
  }).observe(nodes.grid);
  document.fonts?.ready.then(scheduleLayout);

  loadMemories();
}

// ------------------------------------------------------------------ share a memory

const DRAFT_KEY = 'rememberdonnie:draft';
const MAX_PHOTO_EDGE = 1800;

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Resizes to a sensible size and re-encodes as JPEG, which also strips location metadata. */
async function preparePhoto(file) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error('That file doesn’t look like a photo. Please choose a JPEG or PNG.');
  }
  let source;
  try {
    source = await decodeImage(file);
  } catch {
    throw new Error('We couldn’t open that photo in this browser. Please try a JPEG or PNG.');
  }
  const srcWidth = source.width || source.naturalWidth;
  const srcHeight = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  source.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('We couldn’t prepare that photo. Please try another.');
  return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
}

function initShare() {
  const dialog = $('[data-share-dialog]');
  const form = $('[data-share-form]');
  const done = $('[data-share-done]');
  const nameInput = $('#m-name');
  const relationInput = $('#m-relation');
  const messageInput = $('#m-message');
  const honeypot = $('input[name="website"]', form);
  const charCount = $('[data-char-count]');
  const errorBox = $('[data-form-error]');
  const submit = $('[data-submit]');
  const photoInput = $('[data-photo-input]');
  const dropzone = $('[data-dropzone]');
  const preview = $('[data-photo-preview]');
  const previewImg = $('[data-photo-preview-img]');

  let startedAt = 0;
  let photo = null;
  let photoPending = null;
  let sharedMemoryId = null;

  const saveDraft = () => storage.set(DRAFT_KEY, { name: nameInput.value, relation: relationInput.value, message: messageInput.value });
  const updateCount = () => { charCount.textContent = messageInput.value.length.toLocaleString('en-US'); };

  function showError(message, field) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    } else {
      errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function clearError() {
    errorBox.hidden = true;
    for (const field of [nameInput, messageInput]) field.removeAttribute('aria-invalid');
  }

  function setBusy(busy, label = 'Share memory') {
    submit.disabled = busy;
    submit.replaceChildren(...(busy ? [el('span', { class: 'spinner', 'aria-hidden': 'true' }), label] : ['Share memory']));
  }

  function clearPhoto() {
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    photo = null;
    photoPending = null;
    photoInput.value = '';
    preview.hidden = true;
    dropzone.hidden = false;
  }

  async function choosePhoto(file) {
    if (!file) return;
    clearError();
    clearPhoto();
    dropzone.hidden = true;
    preview.hidden = false;
    previewImg.removeAttribute('src');
    photoPending = preparePhoto(file);
    try {
      photo = await photoPending;
      previewImg.src = photo.previewUrl;
    } catch (err) {
      clearPhoto();
      showError(err.message);
    } finally {
      photoPending = null;
    }
  }

  function open() {
    clearError();
    if (!done.hidden) {
      done.hidden = true;
      form.hidden = false;
    }
    const draft = storage.get(DRAFT_KEY);
    if (draft && !nameInput.value && !messageInput.value) {
      nameInput.value = draft.name || '';
      relationInput.value = draft.relation || '';
      messageInput.value = draft.message || '';
    }
    updateCount();
    startedAt = Date.now();
    sharedMemoryId = null;
    dialog.showModal();
    (nameInput.value ? messageInput : nameInput).focus();
  }

  for (const trigger of $$('[data-open-share]')) trigger.addEventListener('click', open);
  form.addEventListener('input', (event) => {
    if (event.target === messageInput) updateCount();
    if (event.target.getAttribute('aria-invalid')) event.target.removeAttribute('aria-invalid');
    if (event.target !== honeypot && event.target !== photoInput) saveDraft();
  });

  photoInput.addEventListener('change', () => choosePhoto(photoInput.files[0]));
  $('[data-photo-remove]').addEventListener('click', clearPhoto);
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    choosePhoto(event.dataTransfer.files[0]);
  });

  dialog.addEventListener('close', () => {
    if (sharedMemoryId) {
      const card = $(`.memory[data-id="${CSS.escape(sharedMemoryId)}"]`);
      card?.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
      sharedMemoryId = null;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const name = nameInput.value.trim();
    const message = messageInput.value.trim();
    if (!name) return showError('Please add your name.', nameInput);
    if (!message) return showError('Please write a memory to share.', messageInput);

    try {
      if (photoPending) {
        setBusy(true, 'Preparing photo…');
        await photoPending;
      }
      let photoFields = {};
      if (photo) {
        setBusy(true, 'Uploading photo…');
        const ticket = await api('/api/photos', { method: 'POST', body: { contentType: 'image/jpeg', size: photo.blob.size } });
        const upload = new FormData();
        for (const [key, value] of Object.entries(ticket.upload.fields)) upload.append(key, value);
        upload.append('file', photo.blob, 'photo.jpg');
        const uploaded = await fetch(ticket.upload.url, { method: 'POST', body: upload });
        if (!uploaded.ok) throw new Error('Your photo didn’t upload. Please try again, or share your memory without it.');
        photoFields = { photoId: ticket.photoId, photoWidth: photo.width, photoHeight: photo.height };
      }

      setBusy(true, 'Sharing…');
      const result = await api('/api/memories', {
        method: 'POST',
        body: { name, relation: relationInput.value.trim(), message, website: honeypot.value, startedAt, ...photoFields },
      });

      storage.remove(DRAFT_KEY);
      form.reset();
      clearPhoto();
      updateCount();

      const live = result.status === 'approved' && result.memory;
      $('[data-done-message]').textContent = live
        ? 'Your memory of DJ is on the wall now. Thank you for helping keep him close.'
        : 'Your memory has been received. It will appear on the wall once it’s been reviewed. Thank you for helping keep him close.';
      form.hidden = true;
      done.hidden = false;
      $('[data-done-title]').focus();
      if (live) {
        addMemoryToWall(result.memory);
        sharedMemoryId = result.memory.id;
      }
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  });
}

// ------------------------------------------------------------------ candles

const MAX_CANDLES_SHOWN = 60;
const CANDLES_KEY = 'rememberdonnie:candles-lit';

function initCandles() {
  const field = $('[data-candle-field]');
  const status = $('[data-candle-status]');
  const button = $('[data-light-candle]');
  let count = 0;
  let mine = Number(storage.get(CANDLES_KEY)) || 0;

  const candle = (index, { yours = false, isNew = false } = {}) => {
    const node = el('span', { class: `candle${yours ? ' is-yours' : ''}${isNew ? ' is-new' : ''}` },
      el('span', { class: 'candle__flame' }),
      el('span', { class: 'candle__body' }));
    node.style.setProperty('--h', (0.5 + noise(index) * 0.7).toFixed(2));
    node.style.setProperty('--f', `${(1.3 + noise(index + 99) * 1.5).toFixed(2)}s`);
    node.style.setProperty('--fd', `${(-noise(index + 7) * 2).toFixed(2)}s`);
    return node;
  };

  const summary = () => {
    if (count === 0) return 'Be the first to light a candle for DJ.';
    return count === 1 ? '1 candle is burning for DJ.' : `${count.toLocaleString('en-US')} candles are burning for DJ.`;
  };

  function render() {
    const shown = Math.min(count, MAX_CANDLES_SHOWN);
    const yours = Math.min(mine, shown);
    const nodes = Array.from({ length: shown }, (_, i) => candle(i, { yours: i >= shown - yours }));
    if (count > MAX_CANDLES_SHOWN) nodes.push(el('span', { class: 'candles__more' }, `and ${(count - MAX_CANDLES_SHOWN).toLocaleString('en-US')} more`));
    field.replaceChildren(...nodes);
    status.textContent = summary();
  }

  api('/api/candles')
    .then((data) => {
      count = data.count || 0;
      render();
    })
    .catch(() => { status.textContent = ''; });

  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const data = await api('/api/candles', { method: 'POST' });
      count = data.count;
      mine += 1;
      storage.set(CANDLES_KEY, mine);
      if (count <= MAX_CANDLES_SHOWN) {
        field.append(candle(count - 1, { yours: true, isNew: true }));
      } else {
        render();
      }
      status.textContent = `Thank you. Your candle is lit. ${summary()}`;
      button.textContent = 'Light another candle';
    } catch (err) {
      if (err.status === 429) {
        status.textContent = 'Your candles are burning bright for DJ. Thank you.';
      } else {
        toast('Your candle couldn’t be lit just now. Please try again.');
      }
    } finally {
      button.disabled = false;
    }
  });
}

function initStars() {
  const sky = $('[data-stars]');
  if (!sky) return;
  const stars = Array.from({ length: 110 }, (_, i) => {
    const star = el('span', { class: 'star' });
    star.style.left = `${(noise(i * 3) * 100).toFixed(2)}%`;
    star.style.top = `${(Math.pow(noise(i * 3 + 1), 1.6) * 100).toFixed(2)}%`;
    star.style.setProperty('--size', `${(1 + noise(i * 5) * 1.8).toFixed(1)}px`);
    star.style.setProperty('--o', (0.25 + noise(i * 7) * 0.65).toFixed(2));
    star.style.setProperty('--t', `${(3 + noise(i * 11) * 5).toFixed(1)}s`);
    star.style.setProperty('--d', `${(-noise(i * 13) * 6).toFixed(1)}s`);
    return star;
  });
  sky.replaceChildren(...stars);
}

// ------------------------------------------------------------------ dialogs and sharing

function initDialogs() {
  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close-dialog]');
    if (closer) closer.closest('dialog')?.close();
  });
}

function initSharePage() {
  for (const button of $$('[data-share-page]')) {
    button.addEventListener('click', async () => {
      const data = {
        title: 'Remembering Donnie “DJ” McNeal Jr.',
        text: 'Great Engineer. Better person. Share a memory of DJ or light a candle.',
        url: `${location.origin}/`,
      };
      if (navigator.share) {
        try { await navigator.share(data); } catch { /* dismissed */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
        toast('Link copied. Thank you for sharing.');
      } catch {
        toast(data.url);
      }
    });
  }
}

// ------------------------------------------------------------------ go

for (const init of [initNav, initReveal, initMotes, initLightbox, initDialogs, initWall, initShare, initCandles, initStars, initSharePage]) {
  try {
    init();
  } catch (err) {
    console.error(`${init.name} failed`, err);
  }
}

console.log('%cGreat engineer. Better person.', 'font: italic 600 22px Georgia, serif; color: #c9a24a; padding: 6px 0;');
console.log('%cRest easy, DJ. — https://github.com/edwardmccormick/rememberdonnie', 'font: 13px Georgia, serif; color: #6b7390;');

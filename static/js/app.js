/**
 * LUMEN Cinema — app.js
 * Pure vanilla JavaScript. No external libraries.
 * All API calls use relative same-origin URLs.
 */

'use strict';

// ─────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────

/** Demo user ID. There is no auth API; this is the hardcoded demo customer. */
const DEMO_USER_ID = 1;

/** Maximum seats per booking as enforced by the backend. */
const MAX_SEATS = 8;

// ─────────────────────────────────────────────────────
// CURRENCY / DATE HELPERS
// ─────────────────────────────────────────────────────

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatINR(amount) {
  const num = parseFloat(amount);
  if (isNaN(num)) return '₹—';
  return inrFormatter.format(num);
}

/**
 * Parse a "YYYY-MM-DD HH:MM:SS" string (no timezone suffix) as local time.
 * Returns a Date object. If input is falsy, returns null.
 */
function parseLocalDatetime(str) {
  if (!str) return null;
  // "2026-10-25 18:00:00"  →  "2026-10-25T18:00:00"
  const iso = String(str).replace(' ', 'T');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00'); // treat as local midnight
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(datetimeStr) {
  const d = parseLocalDatetime(datetimeStr);
  if (!d) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateTimeFull(datetimeStr) {
  const d = parseLocalDatetime(datetimeStr);
  if (!d) return '—';
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function isPast(datetimeStr) {
  const d = parseLocalDatetime(datetimeStr);
  if (!d) return false;
  return d <= new Date();
}

// ─────────────────────────────────────────────────────
// SAFE DOM HELPERS
// ─────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

function show(id) { const n = el(id); if (n) n.hidden = false; }
function hide(id) { const n = el(id); if (n) n.hidden = true; }

/** Create an element with optional className and textContent. */
function mkEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Safely clear all children of an element. */
function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ─────────────────────────────────────────────────────
// FETCH HELPER
// ─────────────────────────────────────────────────────

/**
 * Fetch wrapper that:
 * - Always checks response.ok before resolving
 * - Safely parses JSON (returns {} on parse failure)
 * - Rejects with an Error carrying .status and .body
 */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  let body = {};
  try {
    body = await res.json();
  } catch (_) {
    // non-JSON body, leave body = {}
  }
  if (!res.ok) {
    const msg = body.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ─────────────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────────────

const state = {
  movies: [],          // raw /api/movies response
  showtimes: [],       // raw /api/showtimes response
  loaded: false,

  searchQuery: '',

  // Seat selection
  currentShowtime: null,  // showtime object being viewed
  seats: [],              // seat objects for current showtime
  selectedSeatIds: new Set(),

  // Booking/payment
  pendingBooking: null,   // { booking_id, payment_id, total_amount, hold_expires_at, showtime_id, seat_ids }

  // Demo session (client-side only — no server auth)
  demoRole: null,     // 'CUSTOMER' | 'OWNER' | 'ADMIN' | null
  demoEmail: '',
};

// ─────────────────────────────────────────────────────
// HEALTH CHECK (footer indicator)
// ─────────────────────────────────────────────────────

async function checkHealth() {
  try {
    const data = await apiFetch('/api/health');
    const node = el('healthStatus');
    if (node) node.textContent = `⬤ ${data.application || 'LUMEN'} API — ${data.status || 'ok'}`;
  } catch (_) {
    const node = el('healthStatus');
    if (node) node.textContent = '⬤ API — unreachable';
  }
}

// ─────────────────────────────────────────────────────
// LOAD MOVIES + SHOWTIMES
// ─────────────────────────────────────────────────────

async function loadData() {
  show('moviesLoading');
  hide('globalError');
  hide('now-showing');
  hide('coming-soon');
  hide('searchSection');

  try {
    const [moviesData, showtimesData] = await Promise.all([
      apiFetch('/api/movies'),
      apiFetch('/api/showtimes'),
    ]);

    state.movies = moviesData.movies || [];
    state.showtimes = showtimesData.showtimes || [];
    state.loaded = true;

    hide('moviesLoading');
    show('searchSection');
    renderPosterRail();
    renderAll();
  } catch (err) {
    hide('moviesLoading');
    showGlobalError(err.message || 'Could not load data. Please check your connection.');
  }
}

function showGlobalError(msg) {
  const msgEl = el('globalErrorMsg');
  if (msgEl) msgEl.textContent = msg;
  show('globalError');
}

// ─────────────────────────────────────────────────────
// RENDER ALL (TWO COMPLETE SECTIONS: NOW SHOWING & COMING SOON)
// ─────────────────────────────────────────────────────

function renderAll() {
  const query = (state.searchQuery || '').toLowerCase().trim();

  // All active movies categorized strictly by release_status
  const nowShowingMovies = state.movies.filter(m =>
    m.release_status === 'NOW_SHOWING' && (!query || m.title.toLowerCase().includes(query))
  );
  const comingSoonMovies = state.movies.filter(m =>
    m.release_status === 'UPCOMING' && (!query || m.title.toLowerCase().includes(query))
  );

  const nowSec      = el('now-showing');
  const soonSec     = el('coming-soon');
  const nowGrid     = el('nowShowingGrid');
  const soonGrid    = el('comingSoonGrid');
  const nowCount    = el('nowShowingCount');
  const soonCount   = el('comingSoonCount');
  const nowEmpty    = el('nowShowingEmpty');
  const soonEmpty   = el('comingSoonEmpty');
  const globalEmpty = el('globalSearchEmpty');

  // Populate Now Showing
  if (nowGrid) {
    clearChildren(nowGrid);
    if (nowCount) {
      nowCount.textContent = nowShowingMovies.length > 0
        ? `${nowShowingMovies.length} film${nowShowingMovies.length !== 1 ? 's' : ''}`
        : '';
    }

    if (nowShowingMovies.length === 0) {
      if (query && comingSoonMovies.length > 0 && nowSec) {
        nowSec.hidden = true;
      } else {
        if (nowSec) nowSec.hidden = false;
        if (nowEmpty) nowEmpty.hidden = false;
      }
    } else {
      if (nowSec) nowSec.hidden = false;
      if (nowEmpty) nowEmpty.hidden = true;
      nowShowingMovies.forEach((m, idx) => {
        nowGrid.appendChild(buildMovieCard(m, idx, nowShowingMovies.length));
      });
    }
  }

  // Populate Coming Soon
  if (soonGrid) {
    clearChildren(soonGrid);
    if (soonCount) {
      soonCount.textContent = comingSoonMovies.length > 0
        ? `${comingSoonMovies.length} film${comingSoonMovies.length !== 1 ? 's' : ''}`
        : '';
    }

    if (comingSoonMovies.length === 0) {
      if (query && nowShowingMovies.length > 0 && soonSec) {
        soonSec.hidden = true;
      } else {
        if (soonSec) soonSec.hidden = false;
        if (soonEmpty) soonEmpty.hidden = false;
      }
    } else {
      if (soonSec) soonSec.hidden = false;
      if (soonEmpty) soonEmpty.hidden = true;
      comingSoonMovies.forEach((m, idx) => {
        soonGrid.appendChild(buildMovieCard(m, idx, comingSoonMovies.length));
      });
    }
  }

  // Global empty when search yields 0 results across both sections
  if (globalEmpty) {
    const totalMatches = nowShowingMovies.length + comingSoonMovies.length;
    if (query && totalMatches === 0) {
      globalEmpty.hidden = false;
      const title = el('globalSearchEmptyTitle');
      if (title) title.textContent = `No films found matching "${state.searchQuery}"`;
      if (nowSec) nowSec.hidden = true;
      if (soonSec) soonSec.hidden = true;
    } else {
      globalEmpty.hidden = true;
    }
  }

  refreshScrollSpy();
}

// ─────────────────────────────────────────────────────
// DISCOVERY POSTER RAIL / FEATURED FILMS CAROUSEL
// ─────────────────────────────────────────────────────

let carouselTimer = null;

/**
 * Find active movies with at least one future scheduled showtime at an active cinema.
 * Evaluates dynamically based on the current time and current showtimes data.
 * Matches the reference SQL criteria:
 * - Movie is active (GET /api/movies returns active movies)
 * - Showtime status is SCHEDULED
 * - Showtime start_time parses successfully and is in the future (> current time)
 * - Distinct per movie (each movie appears once)
 */
function getFeaturedMovies() {
  if (!state.movies || !state.movies.length || !state.showtimes) return [];

  const now = new Date();
  const eligibleMovieIds = new Set();

  state.showtimes.forEach(st => {
    const isScheduled = (st.showtime_status === 'SCHEDULED');
    const startTime = parseLocalDatetime(st.start_time);
    const isFuture = (startTime !== null && startTime > now);

    if (isScheduled && isFuture) {
      eligibleMovieIds.add(st.movie_id);
    }
  });

  return state.movies.filter(m => eligibleMovieIds.has(m.movie_id));
}

function renderPosterRail() {
  const rail    = el('posterRail');
  const wrapper = el('posterRailWrapper');
  const prevBtn = el('carouselPrev');
  const nextBtn = el('carouselNext');

  if (!rail || !wrapper) return;
  clearChildren(rail);

  const featured = getFeaturedMovies();

  if (featured.length === 0) {
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = '';

  featured.forEach(movie => {
    const isNow = movie.release_status === 'NOW_SHOWING';
    const allMovieShowtimes = state.showtimes.filter(st => st.movie_id === movie.movie_id);

    const item = mkEl('article', 'poster-rail-item');
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'group');
    item.setAttribute('aria-label', `${movie.title} (Featured Film)`);

    // Poster media container (strict 2:3 aspect-ratio)
    const imgWrap = mkEl('div', 'poster-rail-item__media');
    if (movie.poster_url) {
      const img = mkEl('img');
      img.src = movie.poster_url;
      img.alt = `${movie.title} poster`;
      img.loading = 'lazy';
      img.onerror = () => {
        img.remove();
        imgWrap.appendChild(buildPosterFallback());
      };
      imgWrap.appendChild(img);
    } else {
      imgWrap.appendChild(buildPosterFallback());
    }

    const badge = mkEl('span', `poster-rail-item__badge ${isNow ? 'badge--now' : 'badge--soon'}`);
    badge.textContent = isNow ? 'Now Showing' : 'Coming Soon';
    imgWrap.appendChild(badge);

    // Caption container
    const caption = mkEl('div', 'poster-rail-item__caption');
    const titleEl = mkEl('h3', 'poster-rail-item__title', movie.title);
    caption.appendChild(titleEl);

    if (movie.genre) {
      const genreEl = mkEl('div', 'poster-rail-item__genre', movie.genre);
      caption.appendChild(genreEl);
    }

    const ctaBtn = mkEl('button', 'btn btn--primary poster-rail-item__cta', 'Select Showtimes →');
    ctaBtn.type = 'button';
    ctaBtn.setAttribute('aria-label', `Select showtimes for ${movie.title}`);
    ctaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openShowtimeModal(movie, allMovieShowtimes);
    });
    caption.appendChild(ctaBtn);

    item.appendChild(imgWrap);
    item.appendChild(caption);

    const handleSelect = () => {
      openShowtimeModal(movie, allMovieShowtimes);
    };

    item.addEventListener('click', handleSelect);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect();
      }
    });

    rail.appendChild(item);
  });

  const getStep = () => {
    const firstItem = rail.querySelector('.poster-rail-item');
    if (!firstItem) return wrapper.clientWidth;
    const style = window.getComputedStyle(rail);
    const gap = parseFloat(style.gap) || 24;
    return firstItem.offsetWidth + gap;
  };

  if (prevBtn) {
    prevBtn.onclick = () => {
      const step = getStep();
      const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
      if (wrapper.scrollLeft <= 15) {
        wrapper.scrollTo({ left: maxScroll, behavior: 'smooth' });
      } else {
        wrapper.scrollBy({ left: -step, behavior: 'smooth' });
      }
    };
  }

  if (nextBtn) {
    nextBtn.onclick = () => {
      const step = getStep();
      const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
      if (wrapper.scrollLeft >= maxScroll - 15) {
        wrapper.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        wrapper.scrollBy({ left: step, behavior: 'smooth' });
      }
    };
  }

  wrapper.onkeydown = (e) => {
    const step = getStep();
    if (e.key === 'ArrowLeft') {
      wrapper.scrollBy({ left: -step, behavior: 'smooth' });
    } else if (e.key === 'ArrowRight') {
      wrapper.scrollBy({ left: step, behavior: 'smooth' });
    }
  };

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }

  function startAuto() {
    if (prefersReduced || carouselTimer) return;
    carouselTimer = setInterval(() => {
      if (!wrapper || wrapper.hidden) return;
      const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
      if (maxScroll <= 15) return; // All items fit visible area, no auto-advance needed
      const step = getStep();
      if (wrapper.scrollLeft >= maxScroll - 15) {
        wrapper.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        wrapper.scrollBy({ left: step, behavior: 'smooth' });
      }
    }, 4000);
  }

  function stopAuto() {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
  }

  if (!prefersReduced) {
    startAuto();
    wrapper.addEventListener('mouseenter', stopAuto);
    wrapper.addEventListener('mouseleave', startAuto);
    wrapper.addEventListener('focusin', stopAuto);
    wrapper.addEventListener('focusout', startAuto);
  }
}

// ─────────────────────────────────────────────────────
// MOVIE CARD BUILDER (SIMPLIFIED)
// ─────────────────────────────────────────────────────

function buildMovieCard(movie, index = 0, count = 3) {
  const { movie_id, title, poster_url, release_status, genre, duration_minutes, language, country_of_origin, description } = movie;
  const isNow = release_status === 'NOW_SHOWING';
  const movieShowtimes = state.showtimes.filter(st => st.movie_id === movie_id);
  const hasBookableShowtime = movieShowtimes.some(st => !isPast(st.start_time));

  // Determine column position:
  // If it's the 3rd card in a 3-col desktop layout (index % 3 === 2), position flyout to the LEFT
  // so it stays inside viewport. Otherwise position to the RIGHT.
  const isRightEdge = (index % 3 === 2);
  const flyoutSideClass = isRightEdge ? 'flyout--left' : 'flyout--right';

  const card = mkEl('article', `movie-card ${flyoutSideClass} ${isNow ? 'movie-card--now' : 'movie-card--soon'}`);
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', title);

  // ── Poster Frame (standard 2:3 aspect-ratio) ──
  const posterWrap = mkEl('div', 'movie-card__poster');

  const statusBadge = mkEl('span', `movie-card__status-badge ${isNow ? 'badge--now' : 'badge--soon'}`);
  statusBadge.textContent = isNow ? 'Now Showing' : 'Coming Soon';
  posterWrap.appendChild(statusBadge);

  if (poster_url) {
    const img = mkEl('img');
    img.alt = `${title} poster`;
    img.loading = 'lazy';
    img.src = poster_url;
    img.onerror = () => {
      img.remove();
      posterWrap.appendChild(buildPosterFallback());
    };
    posterWrap.appendChild(img);
  } else {
    posterWrap.appendChild(buildPosterFallback());
  }
  card.appendChild(posterWrap);

  // ── Minimal Card Body (Title + Genre) ──
  const body = mkEl('div', 'movie-card__body');
  const titleEl = mkEl('h3', 'movie-card__title', title);
  body.appendChild(titleEl);
  if (genre) {
    const genreEl = mkEl('span', 'movie-card__genre-tag', genre);
    body.appendChild(genreEl);
  }
  card.appendChild(body);

  // ── Flyout Details (Appears BESIDE the poster on hover / focus) ──
  const flyout = mkEl('aside', 'movie-card__flyout');
  flyout.setAttribute('aria-label', `${title} details`);

  const flyoutHeader = mkEl('div', 'flyout__header');
  const flyoutBadge = mkEl('span', `flyout__badge ${isNow ? 'badge--now' : 'badge--soon'}`, isNow ? 'Now Showing' : 'Coming Soon');
  flyoutHeader.appendChild(flyoutBadge);
  if (genre) {
    const flyoutGenre = mkEl('span', 'flyout__genre', genre);
    flyoutHeader.appendChild(flyoutGenre);
  }
  flyout.appendChild(flyoutHeader);

  const flyoutTitle = mkEl('h4', 'flyout__title', title);
  flyout.appendChild(flyoutTitle);

  // Meta chips (duration, language, country)
  const meta = mkEl('div', 'flyout__meta');
  if (duration_minutes) {
    const dSpan = mkEl('span', null, `${duration_minutes}m`);
    meta.appendChild(dSpan);
  }
  if (language) {
    const lSpan = mkEl('span', null, language);
    meta.appendChild(lSpan);
  }
  if (country_of_origin) {
    const cSpan = mkEl('span', null, country_of_origin);
    meta.appendChild(cSpan);
  }
  if (meta.children.length > 0) {
    flyout.appendChild(meta);
  }

  if (description) {
    const desc = mkEl('p', 'flyout__desc', description.length > 130 ? description.slice(0, 128) + '…' : description);
    flyout.appendChild(desc);
  }

  const flyoutAction = mkEl('div', 'flyout__action');
  if (isNow && hasBookableShowtime) {
    const btn = mkEl('button', 'btn btn--primary flyout__btn', 'Select Showtimes →');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Select showtimes for ${title}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openShowtimeModal(movie, movieShowtimes);
    });
    flyoutAction.appendChild(btn);
  } else if (isNow) {
    const btn = mkEl('button', 'btn btn--secondary flyout__btn', 'No Showtimes');
    btn.type = 'button';
    btn.disabled = true;
    flyoutAction.appendChild(btn);
  } else {
    const btn = mkEl('button', 'btn btn--secondary flyout__btn', 'Coming Soon');
    btn.type = 'button';
    btn.disabled = true;
    flyoutAction.appendChild(btn);
  }
  flyout.appendChild(flyoutAction);
  card.appendChild(flyout);

  // Dynamic viewport check on hover/focus to guarantee flyout stays on screen
  function adjustFlyoutPosition() {
    const rect = card.getBoundingClientRect();
    const spaceOnRight = window.innerWidth - rect.right;
    if (spaceOnRight < 310) {
      card.classList.remove('flyout--right');
      card.classList.add('flyout--left');
    } else if (rect.left < 310) {
      card.classList.remove('flyout--left');
      card.classList.add('flyout--right');
    }
  }

  card.addEventListener('mouseenter', adjustFlyoutPosition);
  card.addEventListener('focusin', adjustFlyoutPosition);

  // Mobile / touch support: toggle touch-active class
  card.addEventListener('touchstart', (e) => {
    if (e.target.closest('.flyout__btn')) return;
    if (!card.classList.contains('touch-active')) {
      document.querySelectorAll('.movie-card.touch-active').forEach(c => c.classList.remove('touch-active'));
      card.classList.add('touch-active');
      adjustFlyoutPosition();
    }
  }, { passive: true });

  // Card click → open showtimes (if now showing with showtimes)
  if (isNow && movieShowtimes.length > 0) {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.flyout__btn')) return;
      openShowtimeModal(movie, movieShowtimes);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openShowtimeModal(movie, movieShowtimes);
      }
    });
  }

  return card;
}

function buildPosterFallback() {
  const fb = mkEl('div', 'poster-fallback');
  const icon = mkEl('div', 'poster-fallback__icon', '◈');
  fb.appendChild(icon);
  return fb;
}

// ─────────────────────────────────────────────────────
// SHOWTIME MODAL
// ─────────────────────────────────────────────────────

function openShowtimeModal(movie, showtimes) {
  const modal    = el('showtimeModal');
  const backdrop = el('showtimeBackdrop');
  const body     = el('showtimeModalBody');
  const title    = el('showtimeModalTitle');

  if (!modal) return;
  if (title) title.textContent = `Showtimes — ${movie.title}`;
  clearChildren(body);

  if (showtimes.length === 0) {
    const p = mkEl('p', null, 'No showtimes found for this film.');
    p.style.color = 'var(--clr-text-muted)';
    p.style.padding = 'var(--space-8)';
    body.appendChild(p);
  } else {
    showtimes.forEach(st => {
      body.appendChild(buildShowtimeCard(st, movie));
    });
  }

  backdrop.classList.add('active');
  backdrop.setAttribute('aria-hidden', 'false');
  modal.showModal();
  document.body.style.overflow = 'hidden';
}

function closeShowtimeModal() {
  const modal    = el('showtimeModal');
  const backdrop = el('showtimeBackdrop');
  if (!modal) return;
  modal.close();
  backdrop.classList.remove('active');
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function buildShowtimeCard(showtime, movie) {
  const past = isPast(showtime.start_time);
  const card = mkEl('div', `showtime-card${past ? ' showtime-card--past' : ''}`);

  // Row 1: time + price
  const row1 = mkEl('div', 'showtime-card__row');
  const timeEl = mkEl('div', 'showtime-card__time', formatTime(showtime.start_time));
  const priceEl = mkEl('div', 'showtime-card__price', formatINR(showtime.ticket_price));
  row1.appendChild(timeEl);
  row1.appendChild(priceEl);
  card.appendChild(row1);

  // Meta
  const meta = mkEl('div', 'showtime-card__meta');
  const pieces = [
    showtime.cinema_name,
    showtime.city,
    showtime.screen_name,
    showtime.auditorium_tier ? `${showtime.auditorium_tier} Tier` : null,
    showtime.end_time ? `Ends ${formatTime(showtime.end_time)}` : null,
  ].filter(Boolean);
  pieces.forEach(p => {
    const s = mkEl('span', null, p);
    meta.appendChild(s);
  });
  card.appendChild(meta);

  // Row 2: ended badge OR book button
  const row2 = mkEl('div', 'showtime-card__row');
  row2.style.justifyContent = 'flex-end';
  if (past) {
    const badge = mkEl('span', 'showtime-card__ended-badge', '⏱ Ended');
    row2.appendChild(badge);
  } else {
    const btn = mkEl('button', 'btn btn--primary showtime-card__book-btn', 'Select Seats →');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Select seats for ${movie.title} at ${formatTime(showtime.start_time)}`);
    btn.addEventListener('click', () => {
      closeShowtimeModal();
      openSeatModal(showtime, movie);
    });
    row2.appendChild(btn);
  }
  card.appendChild(row2);

  return card;
}

// ─────────────────────────────────────────────────────
// SEAT MODAL
// ─────────────────────────────────────────────────────

function openSeatModal(showtime, movie) {
  const modal    = el('seatModal');
  const backdrop = el('modalBackdrop');
  if (!modal) return;

  state.currentShowtime = showtime;
  state.selectedSeatIds = new Set();
  state.pendingBooking = null;

  // Reset panels
  show('seatLoading');
  hide('seatError');
  hide('seatMapContainer');
  hide('checkoutPanel');
  hide('resultPanel');

  // Header
  setText('seatModalTitle', movie.title);
  const subtitle = [
    showtime.cinema_name,
    formatTime(showtime.start_time),
    showtime.screen_name,
  ].filter(Boolean).join(' · ');
  setText('seatModalSubtitle', subtitle);

  if (showtime.screen_name || showtime.auditorium_tier) {
    const label = [showtime.screen_name, showtime.auditorium_tier ? `(${showtime.auditorium_tier})` : ''].filter(Boolean).join(' ');
    setText('screenLabel', `▲ ${label} ▲`);
  }

  backdrop.classList.add('active');
  backdrop.setAttribute('aria-hidden', 'false');
  modal.showModal();
  document.body.style.overflow = 'hidden';

  fetchSeats(showtime.showtime_id);
}

function closeSeatModal() {
  const modal    = el('seatModal');
  const backdrop = el('modalBackdrop');
  if (!modal) return;
  modal.close();
  backdrop.classList.remove('active');
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  state.currentShowtime = null;
  state.seats = [];
  state.selectedSeatIds = new Set();
  state.pendingBooking = null;
}

// ─────────────────────────────────────────────────────
// FETCH SEATS
// ─────────────────────────────────────────────────────

async function fetchSeats(showtimeId) {
  show('seatLoading');
  hide('seatError');
  hide('seatMapContainer');

  try {
    const data = await apiFetch(`/api/showtimes/${showtimeId}/seats`);
    state.seats = data.seats || [];
    hide('seatLoading');
    renderSeatMap();
    show('seatMapContainer');
  } catch (err) {
    hide('seatLoading');
    const msgEl = el('seatErrorMsg');
    if (msgEl) msgEl.textContent = err.message || 'Could not load seats. Please try again.';
    show('seatError');
  }
}

// ─────────────────────────────────────────────────────
// SEAT MAP RENDERER
// ─────────────────────────────────────────────────────

/**
 * Parse seat_number into { row: 'A', num: 1 }.
 * Handles formats like "A1", "B12", "C4".
 */
function parseSeatNumber(seatNumber) {
  const m = String(seatNumber).match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return { row: seatNumber, num: 0 };
  return { row: m[1].toUpperCase(), num: parseInt(m[2], 10) };
}

function renderSeatMap() {
  const mapEl = el('seatMap');
  if (!mapEl) return;
  clearChildren(mapEl);

  // Group seats by row letter
  const rowMap = new Map(); // rowLetter -> seat[]
  state.seats.forEach(seat => {
    const { row } = parseSeatNumber(seat.seat_number);
    if (!rowMap.has(row)) rowMap.set(row, []);
    rowMap.get(row).push(seat);
  });

  // Sort rows alphabetically, seats within row numerically
  const sortedRows = [...rowMap.keys()].sort();
  sortedRows.forEach(rowLetter => {
    const seats = rowMap.get(rowLetter).slice().sort((a, b) => {
      const an = parseSeatNumber(a.seat_number).num;
      const bn = parseSeatNumber(b.seat_number).num;
      return an - bn;
    });

    const rowEl = mkEl('div', 'seat-row');
    const rowLabel = mkEl('span', 'seat-row__label', rowLetter);
    rowEl.appendChild(rowLabel);

    seats.forEach(seat => {
      rowEl.appendChild(buildSeatBtn(seat));
    });

    mapEl.appendChild(rowEl);
  });

  updateBookingBar();
}

function buildSeatBtn(seat) {
  const { seat_id, seat_number, seat_type, status } = seat;
  const isPremium = seat_type === 'PREMIUM';
  const isSelected = state.selectedSeatIds.has(seat_id);

  let statusClass = '';
  switch (status) {
    case 'AVAILABLE': statusClass = 'seat-btn--available'; break;
    case 'HELD':      statusClass = 'seat-btn--held';      break;
    case 'BOOKED':    statusClass = 'seat-btn--booked';    break;
    default:          statusClass = 'seat-btn--booked';    break;
  }

  const premiumClass = isPremium ? ' seat-btn--premium' : '';
  const selectedClass = isSelected ? ' seat-btn--selected' : '';

  const btn = mkEl('button', `seat-btn ${statusClass}${premiumClass}${selectedClass}`);
  btn.textContent = seat_number;
  btn.type = 'button';

  const isAvailable = status === 'AVAILABLE';
  btn.disabled = !isAvailable;
  btn.setAttribute('aria-label',
    `Seat ${seat_number}, ${isPremium ? 'Premium' : 'Regular'}, ${status.toLowerCase()}, ${formatINR(seat.ticket_price)}`
  );
  if (isSelected) btn.setAttribute('aria-pressed', 'true');

  if (isAvailable) {
    btn.addEventListener('click', () => toggleSeat(seat_id));
  }

  return btn;
}

function toggleSeat(seatId) {
  if (state.selectedSeatIds.has(seatId)) {
    state.selectedSeatIds.delete(seatId);
  } else {
    if (state.selectedSeatIds.size >= MAX_SEATS) {
      flashBarMessage(`Maximum ${MAX_SEATS} seats per booking`);
      return;
    }
    state.selectedSeatIds.add(seatId);
  }
  // Re-render just the map (fast path: rebuild rather than diff)
  renderSeatMap();
}

function flashBarMessage(msg) {
  const bar = el('bookingBar');
  if (!bar) return;
  const old = el('flashMsg');
  if (old) old.remove();
  const span = mkEl('span', null, msg);
  span.id = 'flashMsg';
  span.style.cssText = 'color:var(--clr-danger);font-size:0.8rem;font-weight:600;';
  bar.prepend(span);
  setTimeout(() => { if (span.parentNode) span.remove(); }, 2500);
}

function updateBookingBar() {
  const selected = [...state.selectedSeatIds];
  const labelsEl = el('selectedSeatLabels');
  const totalEl  = el('selectedTotal');
  const holdBtn  = el('holdBtn');

  if (selected.length === 0) {
    if (labelsEl) labelsEl.textContent = '—';
    if (totalEl)  totalEl.textContent  = '₹0';
    if (holdBtn)  holdBtn.disabled = true;
    return;
  }

  // Compute total from actual returned seat ticket_price values
  let total = 0;
  const labels = [];
  selected.forEach(id => {
    const seat = state.seats.find(s => s.seat_id === id);
    if (seat) {
      labels.push(seat.seat_number);
      total += parseFloat(seat.ticket_price) || 0;
    }
  });

  if (labelsEl) labelsEl.textContent = labels.join(', ');
  if (totalEl)  totalEl.textContent  = formatINR(total);
  if (holdBtn)  holdBtn.disabled = selected.length === 0;
}

// ─────────────────────────────────────────────────────
// HOLD SEATS (POST /api/bookings/hold)
// ─────────────────────────────────────────────────────

async function holdSeats() {
  const holdBtn = el('holdBtn');
  if (!holdBtn || !state.currentShowtime) return;

  const seatIds = [...state.selectedSeatIds];
  if (seatIds.length === 0) return;

  holdBtn.disabled = true;
  holdBtn.textContent = 'Holding…';

  const payload = {
    user_id: DEMO_USER_ID,
    showtime_id: state.currentShowtime.showtime_id,
    seat_ids: seatIds,
  };

  try {
    const data = await apiFetch('/api/bookings/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    state.pendingBooking = {
      booking_id:     data.booking_id,
      payment_id:     data.payment_id,
      total_amount:   data.total_amount,
      hold_expires_at: data.hold_expires_at,
      showtime_id:    data.showtime_id,
      seat_ids:       data.seat_ids,
    };

    showCheckoutPanel(data);
  } catch (err) {
    holdBtn.disabled = false;
    holdBtn.textContent = 'Hold Seats';

    if (err.status === 409) {
      // Seats no longer available — refresh map
      flashBarMessage('Some seats are no longer available. Map refreshed.');
      state.selectedSeatIds = new Set();
      fetchSeats(state.currentShowtime.showtime_id);
    } else {
      flashBarMessage(err.message || 'Could not hold seats. Try again.');
    }
  }
}

// ─────────────────────────────────────────────────────
// CHECKOUT PANEL
// ─────────────────────────────────────────────────────

function showCheckoutPanel(holdData) {
  hide('seatMapContainer');
  hide('seatLoading');
  hide('seatError');
  hide('resultPanel');
  show('checkoutPanel');

  const detailsEl = el('checkoutDetails');
  if (!detailsEl) return;
  clearChildren(detailsEl);

  const st = state.currentShowtime;

  function addRow(label, value, isTotalRow = false) {
    const row = mkEl('div', `checkout-row${isTotalRow ? ' checkout-row--total' : ''}`);
    const lbl = mkEl('span', 'checkout-row__label', label);
    const val = mkEl('span', 'checkout-row__val', value);
    row.appendChild(lbl);
    row.appendChild(val);
    detailsEl.appendChild(row);
  }

  addRow('Film', st ? st.movie_title : '—');
  addRow('Cinema', st ? `${st.cinema_name}, ${st.city}` : '—');
  addRow('Screen', st ? `${st.screen_name}${st.auditorium_tier ? ` (${st.auditorium_tier})` : ''}` : '—');
  addRow('Showtime', st ? formatDateTimeFull(st.start_time) : '—');

  // Seats
  const seatLabels = [];
  holdData.seat_ids.forEach(id => {
    const seat = state.seats.find(s => s.seat_id === id);
    if (seat) seatLabels.push(seat.seat_number);
  });
  addRow('Seats', seatLabels.join(', ') || `${holdData.seat_ids.length} seat(s)`);
  addRow('Booking ID', `#${holdData.booking_id}`);

  // Hold expiry
  if (holdData.hold_expires_at) {
    addRow('Hold Expires', formatDateTimeFull(holdData.hold_expires_at));
  }

  addRow('Total', formatINR(holdData.total_amount), true);

  // Re-enable payment buttons
  const paySuccess = el('paySuccessBtn');
  const payFail    = el('payFailBtn');
  if (paySuccess) { paySuccess.disabled = false; }
  if (payFail)    { payFail.disabled = false; }
}

// ─────────────────────────────────────────────────────
// PAYMENT SIMULATION
// ─────────────────────────────────────────────────────

async function simulatePayment(result) {
  if (!state.pendingBooking) return;

  const paySuccess = el('paySuccessBtn');
  const payFail    = el('payFailBtn');
  const back       = el('checkoutBack');

  // Disable all controls during request
  if (paySuccess) paySuccess.disabled = true;
  if (payFail)    payFail.disabled = true;
  if (back)       back.disabled = true;

  const { booking_id } = state.pendingBooking;

  try {
    const data = await apiFetch(`/api/bookings/${booking_id}/payment-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    });

    showResultPanel(result === 'SUCCESS' ? 'success' : 'fail', data, booking_id);
  } catch (err) {
    if (back) back.disabled = false;

    if (err.status === 409) {
      // Hold expired
      showResultPanel('expired', null, booking_id);
    } else {
      if (paySuccess) paySuccess.disabled = false;
      if (payFail)    payFail.disabled = false;
      // Show error inline
      const detailsEl = el('checkoutDetails');
      if (detailsEl) {
        const existing = detailsEl.querySelector('.payment-error-note');
        if (existing) existing.remove();
        const note = mkEl('p', 'payment-error-note', `⚠ ${err.message || 'Payment request failed. Try again.'}`);
        note.style.cssText = 'color:var(--clr-danger);font-size:0.82rem;margin-top:0.5rem;';
        detailsEl.appendChild(note);
      }
    }
  }

  // Always refresh seats after payment attempt
  if (state.currentShowtime) {
    try {
      const seatData = await apiFetch(`/api/showtimes/${state.currentShowtime.showtime_id}/seats`);
      state.seats = seatData.seats || [];
    } catch (_) { /* non-fatal */ }
  }
}

// ─────────────────────────────────────────────────────
// RESULT PANEL
// ─────────────────────────────────────────────────────

function showResultPanel(type, data, bookingId) {
  hide('checkoutPanel');
  hide('seatMapContainer');
  show('resultPanel');

  const inner    = el('resultPanelInner');
  const closeBtn = el('resultClose');
  const newBook  = el('resultNewBooking');

  if (!inner) return;
  clearChildren(inner);

  if (type === 'success') {
    const icon  = mkEl('div', 'result-icon', '🎟️');
    const title = mkEl('h3', 'result-title result-title--success', 'Booking Confirmed!');
    const body  = mkEl('p', 'result-body',
      'Your seats have been confirmed. This was a simulated demo — no real payment was processed.'
    );
    inner.append(icon, title, body);

    if (data) {
      const box = mkEl('div', 'result-detail-box');
      [
        ['Booking ID',      `#${data.booking_id || bookingId}`],
        ['Booking Status',  data.booking_status || 'CONFIRMED'],
        ['Payment Status',  data.payment_status || 'SUCCESS'],
      ].forEach(([k, v]) => {
        const row = mkEl('div', 'checkout-row');
        row.appendChild(mkEl('span', 'checkout-row__label', k));
        row.appendChild(mkEl('span', 'checkout-row__val', v));
        box.appendChild(row);
      });
      inner.appendChild(box);
    }

    if (newBook) { newBook.hidden = false; }
    if (closeBtn) { closeBtn.textContent = 'Done'; }

  } else if (type === 'fail') {
    const icon  = mkEl('div', 'result-icon', '❌');
    const title = mkEl('h3', 'result-title result-title--fail', 'Payment Failed');
    const body  = mkEl('p', 'result-body',
      'The simulated payment was declined. Your seats have been released back to the pool. You may try selecting them again.'
    );
    inner.append(icon, title, body);
    if (newBook) { newBook.hidden = false; }
    if (closeBtn) { closeBtn.textContent = 'Close'; }

  } else { // expired
    const icon  = mkEl('div', 'result-icon', '⏱');
    const title = mkEl('h3', 'result-title result-title--expired', 'Hold Expired');
    const body  = mkEl('p', 'result-body',
      'Your seat hold is no longer valid (it may have expired after 10 minutes). Please select available seats again.'
    );
    inner.append(icon, title, body);
    if (newBook) { newBook.hidden = false; }
    if (closeBtn) { closeBtn.textContent = 'Close'; }
  }
}

// ─────────────────────────────────────────────────────
// SEARCH & FILTER
// ─────────────────────────────────────────────────────

function initSearchAndFilter() {
  const input    = el('searchInput');
  const clearBtn = el('searchClear');

  if (input) {
    input.addEventListener('input', () => {
      state.searchQuery = input.value;
      if (clearBtn) clearBtn.hidden = !input.value;
      if (state.loaded) renderAll();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (input) input.value = '';
      state.searchQuery = '';
      clearBtn.hidden = true;
      if (state.loaded) renderAll();
      if (input) input.focus();
    });
  }
}

// ─────────────────────────────────────────────────────
// NAV SMOOTH SCROLLING
// ─────────────────────────────────────────────────────

function initNavScrolling() {
  const navLinks = document.querySelectorAll('.site-nav a, .mobile-nav a, #customerLogoLink');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return;
      const targetId = href.substring(1);

      e.preventDefault();

      if (targetId === 'home') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const targetSection = el(targetId);
        if (targetSection) {
          // If a search query was hiding this section, clear search so user sees it
          if (targetSection.hidden && state.searchQuery) {
            state.searchQuery = '';
            const input = el('searchInput');
            if (input) input.value = '';
            const clearBtn = el('searchClear');
            if (clearBtn) clearBtn.hidden = true;
            if (state.loaded) renderAll();
          }

          const bannerH = 38;
          const headerH = 64;
          const totalOffset = bannerH + headerH + 16;
          const rect = targetSection.getBoundingClientRect();
          const targetTop = window.pageYOffset + rect.top - totalOffset;
          window.scrollTo({
            top: Math.max(0, targetTop),
            behavior: 'smooth'
          });
        }
      }

      // Close mobile nav if open
      const mobileNav = el('mobileNav');
      const toggle = el('navToggle');
      if (mobileNav && mobileNav.classList.contains('open')) {
        mobileNav.classList.remove('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
      }

      // Update URL hash without jumping
      if (history.pushState) {
        history.pushState(null, '', href);
      }
    });
  });
}

// ─────────────────────────────────────────────────────
// MOBILE NAV
// ─────────────────────────────────────────────────────

function initMobileNav() {
  const toggle = el('navToggle');
  const nav    = el('mobileNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    nav.setAttribute('aria-hidden', String(!open));
  });
}

// ─────────────────────────────────────────────────────
// MODAL WIRING
// ─────────────────────────────────────────────────────

function initModals() {
  // ── Seat modal ──
  const seatModalClose = el('seatModalClose');
  const backdrop       = el('modalBackdrop');
  const holdBtn        = el('holdBtn');
  const checkoutBack   = el('checkoutBack');
  const paySuccessBtn  = el('paySuccessBtn');
  const payFailBtn     = el('payFailBtn');
  const resultClose    = el('resultClose');
  const resultNewBook  = el('resultNewBooking');

  if (seatModalClose) seatModalClose.addEventListener('click', closeSeatModal);
  if (backdrop)       backdrop.addEventListener('click', closeSeatModal);
  if (holdBtn) {
    holdBtn.addEventListener('click', () => {
      holdBtn.textContent = 'Hold Seats'; // reset label in case
      holdSeats();
    });
  }
  if (checkoutBack) {
    checkoutBack.addEventListener('click', () => {
      hide('checkoutPanel');
      show('seatMapContainer');
      // re-enable hold button
      const hb = el('holdBtn');
      if (hb) { hb.disabled = false; hb.textContent = 'Hold Seats'; }
    });
  }
  if (paySuccessBtn) paySuccessBtn.addEventListener('click', () => simulatePayment('SUCCESS'));
  if (payFailBtn)    payFailBtn.addEventListener('click',    () => simulatePayment('FAILED'));
  if (resultClose) {
    resultClose.addEventListener('click', () => {
      closeSeatModal();
    });
  }
  if (resultNewBook) {
    resultNewBook.addEventListener('click', () => {
      // Go back to seat map with fresh data
      state.pendingBooking = null;
      state.selectedSeatIds = new Set();
      hide('resultPanel');
      hide('checkoutPanel');
      show('seatLoading');
      hide('seatMapContainer');
      if (state.currentShowtime) {
        fetchSeats(state.currentShowtime.showtime_id).then(() => {
          const hb = el('holdBtn');
          if (hb) { hb.disabled = true; hb.textContent = 'Hold Seats'; }
          const nb = el('resultNewBooking');
          if (nb) nb.hidden = true;
        });
      }
    });
  }

  // Seat retry
  const seatRetry = el('seatRetry');
  if (seatRetry) {
    seatRetry.addEventListener('click', () => {
      if (state.currentShowtime) fetchSeats(state.currentShowtime.showtime_id);
    });
  }

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const seatModal     = el('seatModal');
      const showtimeModal = el('showtimeModal');
      if (seatModal     && seatModal.open)     closeSeatModal();
      if (showtimeModal && showtimeModal.open) closeShowtimeModal();
    }
  });

  // ── Showtime modal ──
  const showtimeModalClose = el('showtimeModalClose');
  const showtimeBackdrop   = el('showtimeBackdrop');
  if (showtimeModalClose) showtimeModalClose.addEventListener('click', closeShowtimeModal);
  if (showtimeBackdrop)   showtimeBackdrop.addEventListener('click',   closeShowtimeModal);
}

// ─────────────────────────────────────────────────────
// GLOBAL ERROR RETRY
// ─────────────────────────────────────────────────────

function initGlobalErrorRetry() {
  const btn = el('globalErrorRetry');
  if (btn) btn.addEventListener('click', loadData);
}

// ─────────────────────────────────────────────────────
// NAV SCROLL HIGHLIGHT
// ─────────────────────────────────────────────────────

let _scrollSpyObserver = null;

function initScrollSpy() {
  const navHome = el('nav-home');
  const navNow  = el('nav-now');
  const navSoon = el('nav-soon');

  const onScroll = () => {
    const scrollPos = window.scrollY || window.pageYOffset;
    const nowSec  = el('now-showing');
    const soonSec = el('coming-soon');

    const nowTop  = nowSec  ? (nowSec.offsetTop - 160)  : 999999;
    const soonTop = soonSec ? (soonSec.offsetTop - 160) : 999999;

    if (soonSec && !soonSec.hidden && scrollPos >= soonTop) {
      if (navSoon) navSoon.classList.add('active');
      if (navNow)  navNow.classList.remove('active');
      if (navHome) navHome.classList.remove('active');
    } else if (nowSec && !nowSec.hidden && scrollPos >= nowTop) {
      if (navNow)  navNow.classList.add('active');
      if (navSoon) navSoon.classList.remove('active');
      if (navHome) navHome.classList.remove('active');
    } else {
      if (navHome) navHome.classList.add('active');
      if (navNow)  navNow.classList.remove('active');
      if (navSoon) navSoon.classList.remove('active');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Re-run scroll spy after sections become visible post data-load
function refreshScrollSpy() {
  initScrollSpy();
}

// ─────────────────────────────────────────────────────
// DEMO LOGIN + ROLE SWITCHING
// ─────────────────────────────────────────────────────

/**
 * Show a view by ID, hide all others.
 * Views: 'loginScreen', 'customerView', 'ownerView', 'adminView'
 */
function showView(viewId) {
  ['loginScreen', 'customerView', 'ownerView', 'adminView'].forEach(id => {
    const node = el(id);
    if (!node) return;
    node.hidden = (id !== viewId);
  });
  // Scroll to top
  window.scrollTo(0, 0);
}

function logoutToLogin() {
  state.demoRole  = null;
  state.demoEmail = '';
  showView('loginScreen');
  // Reset login form
  const form = el('loginForm');
  if (form) form.reset();
  const emailErr = el('loginEmailError');
  const pwErr    = el('loginPasswordError');
  if (emailErr) emailErr.hidden = true;
  if (pwErr)    pwErr.hidden    = true;
}

function updateRoleSwitchButtons(role) {
  document.querySelectorAll('.role-switch-btn').forEach(btn => {
    const btnRole = btn.getAttribute('data-switch-role');
    btn.classList.toggle('active', btnRole === role);
  });
}

function switchRole(role, email) {
  const currentEmail = email || state.demoEmail;
  switch (role) {
    case 'OWNER': enterOwnerView(currentEmail || 'owner@example.com'); break;
    case 'ADMIN': enterAdminView(currentEmail || 'admin@example.com'); break;
    default:      enterCustomerView(currentEmail || 'demo@example.com'); break;
  }
}

function enterCustomerView(email) {
  state.demoRole  = 'CUSTOMER';
  state.demoEmail = email || 'demo@example.com';
  showView('customerView');
  setText('customerDemoUser', state.demoEmail);
  updateRoleSwitchButtons('CUSTOMER');
  // Load data if not already loaded
  if (!state.loaded) {
    checkHealth();
    loadData();
  }
}

function enterOwnerView(email) {
  state.demoRole  = 'OWNER';
  state.demoEmail = email || 'owner@example.com';
  showView('ownerView');
  setText('ownerDemoUser', state.demoEmail);
  updateRoleSwitchButtons('OWNER');
  populateOwnerDashboard();
}

function enterAdminView(email) {
  state.demoRole  = 'ADMIN';
  state.demoEmail = email || 'admin@example.com';
  showView('adminView');
  setText('adminDemoUser', state.demoEmail);
  updateRoleSwitchButtons('ADMIN');
  populateAdminDashboard();
}

function initLogin() {
  const form      = el('loginForm');
  const pwToggle  = el('pwToggle');
  const pwInput   = el('loginPassword');
  const roleSelect = el('roleSelect');

  // Password show/hide toggle
  if (pwToggle && pwInput) {
    pwToggle.addEventListener('click', () => {
      const isText = pwInput.type === 'text';
      pwInput.type = isText ? 'password' : 'text';
      pwToggle.setAttribute('aria-label', isText ? 'Show password' : 'Hide password');
    });
  }

  // Role choice cards on minimal role-entry screen
  document.querySelectorAll('[data-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.getAttribute('data-role');
      switchRole(role);
    });
  });

  // Quick Role Launch buttons on login screen (if present)
  document.querySelectorAll('[data-quick-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.getAttribute('data-quick-role');
      switchRole(role);
    });
  });

  // Role switcher buttons in demo banners
  document.querySelectorAll('[data-switch-role]').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.getAttribute('data-switch-role');
      switchRole(role);
    });
  });

  // Form submit — purely client-side demo
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = (el('loginEmail') ? el('loginEmail').value.trim() : '') || 'demo@example.com';
      const role  = roleSelect ? roleSelect.value : 'CUSTOMER';
      switchRole(role, email);
    });
  }

  // Logout buttons
  ['customerLogout', 'ownerLogout', 'ownerLogout2', 'adminLogout', 'adminLogout2'].forEach(id => {
    const btn = el(id);
    if (btn) btn.addEventListener('click', logoutToLogin);
  });

  // Show login screen initially
  showView('loginScreen');
}

// ─────────────────────────────────────────────────────
// OWNER DASHBOARD POPULATION
// ─────────────────────────────────────────────────────

function populateOwnerDashboard() {
  // Show loading state
  show('ownerScheduleLoading');
  hide('ownerScheduleError');
  hide('ownerScheduleTable');

  // Fetch fresh data if needed, otherwise use cached
  const doPopulate = () => {
    const showtimes = state.showtimes;
    const now = new Date();

    // Stats
    const total  = showtimes.length;
    const future = showtimes.filter(st => new Date(String(st.start_time).replace(' ', 'T')) > now).length;
    const past   = total - future;

    setText('ownerStatTotal',  String(total));
    setText('ownerStatFuture', String(future));
    setText('ownerStatPast',   String(past));

    // Cinema details (from first showtime)
    if (showtimes.length > 0) {
      setText('ownerCinemaName', showtimes[0].cinema_name || '—');
      setText('ownerCinemaCity', showtimes[0].city        || '—');
    }

    // Schedule table
    const tbody = el('ownerScheduleBody');
    if (tbody) {
      clearChildren(tbody);
      if (showtimes.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.textContent = 'No showtimes available.';
        td.style.textAlign = 'center';
        td.style.color = 'var(--clr-text-faint)';
        td.style.padding = '2rem';
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        showtimes.forEach(st => {
          const isPastSt = new Date(String(st.start_time).replace(' ', 'T')) <= now;
          const tr = document.createElement('tr');
          const startD = parseLocalDatetime(st.start_time);
          const dateStr = startD ? startD.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
          [
            st.movie_title || '—',
            st.screen_name || '—',
            dateStr,
            formatTime(st.start_time),
            formatTime(st.end_time),
            formatINR(st.ticket_price),
            '', // status chip cell
          ].forEach((text, i) => {
            const td = document.createElement('td');
            if (i === 6) {
              const chip = document.createElement('span');
              chip.className = `status-chip ${isPastSt ? 'status-chip--past' : 'status-chip--scheduled'}`;
              chip.textContent = isPastSt ? 'Ended' : 'Scheduled';
              td.appendChild(chip);
            } else {
              td.textContent = text;
            }
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
      }
    }

    // Screens table (derived from showtime data)
    const screensTbody = el('ownerScreensBody');
    if (screensTbody) {
      clearChildren(screensTbody);
      const screenMap = new Map();
      showtimes.forEach(st => {
        if (st.screen_id && !screenMap.has(st.screen_id)) {
          screenMap.set(st.screen_id, {
            name: st.screen_name || '—',
            tier: st.auditorium_tier || '—',
            ratio: st.screen_aspect_ratio || '—',
          });
        }
      });
      if (screenMap.size === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.textContent = 'No screen data available.';
        td.style.textAlign = 'center';
        td.style.color = 'var(--clr-text-faint)';
        td.style.padding = '1.5rem';
        tr.appendChild(td);
        screensTbody.appendChild(tr);
      } else {
        screenMap.forEach(screen => {
          const tr = document.createElement('tr');
          [screen.name, screen.tier, screen.ratio].forEach(text => {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
          });
          screensTbody.appendChild(tr);
        });
      }
    }

    hide('ownerScheduleLoading');
    hide('ownerScheduleError');
    show('ownerScheduleTable');
  };

  if (state.loaded) {
    doPopulate();
  } else {
    // Load data first, then populate
    Promise.all([
      apiFetch('/api/movies'),
      apiFetch('/api/showtimes'),
    ]).then(([moviesData, showtimesData]) => {
      state.movies    = moviesData.movies    || [];
      state.showtimes = showtimesData.showtimes || [];
      state.loaded    = true;
      doPopulate();
    }).catch(err => {
      hide('ownerScheduleLoading');
      setText('ownerScheduleErrorMsg', err.message || 'Could not load showtimes.');
      show('ownerScheduleError');
    });
  }
}

function initOwnerTabs() {
  const tabs = document.querySelectorAll('[data-owner-tab]');
  tabs.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = link.getAttribute('data-owner-tab');

      // Update nav active state
      tabs.forEach(l => { l.classList.remove('active'); l.removeAttribute('aria-current'); });
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');

      // Show/hide tab panels
      ['schedule', 'cinema', 'screens', 'occupancy'].forEach(id => {
        const panel = el(`ownerTab-${id}`);
        if (panel) panel.hidden = (id !== tabId);
      });
    });
  });

  // Refresh button
  const refreshBtn = el('ownerRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      state.loaded = false;
      populateOwnerDashboard();
    });
  }

  // Retry
  const retryBtn = el('ownerScheduleRetry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => populateOwnerDashboard());
  }
}

// ─────────────────────────────────────────────────────
// ADMIN DASHBOARD POPULATION
// ─────────────────────────────────────────────────────

function populateAdminDashboard() {
  const doPopulate = () => {
    const movies    = state.movies;
    const showtimes = state.showtimes;
    const now       = new Date();

    // Overview stats
    const nowShowing = movies.filter(m => m.release_status === 'NOW_SHOWING').length;
    const upcoming   = movies.filter(m => m.release_status === 'UPCOMING').length;

    setText('adminStatMovies',    String(movies.length));
    setText('adminStatShowtimes', String(showtimes.length));
    setText('adminStatNow',       String(nowShowing));
    setText('adminStatSoon',      String(upcoming));

    // API health for admin overview
    apiFetch('/api/health').then(h => {
      setText('adminHealthVal', `${h.status || 'ok'} — ${h.application || 'LUMEN'}`);
    }).catch(() => setText('adminHealthVal', 'unreachable'));

    // Movies table
    const moviesTbody = el('adminMoviesBody');
    if (moviesTbody) {
      clearChildren(moviesTbody);
      movies.forEach(m => {
        const tr = document.createElement('tr');
        const relChip = document.createElement('span');
        relChip.className = `status-chip ${m.release_status === 'NOW_SHOWING' ? 'status-chip--now' : 'status-chip--soon'}`;
        relChip.textContent = m.release_status === 'NOW_SHOWING' ? 'Now Showing' : 'Coming Soon';
        [
          String(m.movie_id),
          m.title || '—',
          m.genre || '—',
          m.language || '—',
          m.duration_minutes ? `${m.duration_minutes} min` : '—',
          '', // status chip
          m.release_date ? formatDate(m.release_date) : '—',
        ].forEach((text, i) => {
          const td = document.createElement('td');
          if (i === 5) {
            td.appendChild(relChip);
          } else {
            td.textContent = text;
          }
          tr.appendChild(td);
        });
        moviesTbody.appendChild(tr);
      });
    }

    // Cinemas table (derived)
    const cinemasTbody = el('adminCinemasBody');
    if (cinemasTbody) {
      clearChildren(cinemasTbody);
      const cinemaMap = new Map();
      showtimes.forEach(st => {
        if (!st.cinema_id) return;
        if (!cinemaMap.has(st.cinema_id)) {
          cinemaMap.set(st.cinema_id, { name: st.cinema_name, city: st.city, count: 0 });
        }
        cinemaMap.get(st.cinema_id).count += 1;
      });
      if (cinemaMap.size === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.textContent = 'No cinema data in showtime API.';
        td.style.textAlign = 'center';
        td.style.color = 'var(--clr-text-faint)';
        td.style.padding = '1.5rem';
        tr.appendChild(td);
        cinemasTbody.appendChild(tr);
      } else {
        cinemaMap.forEach(c => {
          const tr = document.createElement('tr');
          [c.name || '—', c.city || '—', String(c.count)].forEach(text => {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
          });
          cinemasTbody.appendChild(tr);
        });
      }
    }

    // Showtimes table
    const showsTbody = el('adminShowtimesBody');
    if (showsTbody) {
      clearChildren(showsTbody);
      showtimes.forEach(st => {
        const isPastSt = new Date(String(st.start_time).replace(' ', 'T')) <= now;
        const tr = document.createElement('tr');
        const chip = document.createElement('span');
        chip.className = `status-chip ${isPastSt ? 'status-chip--past' : 'status-chip--scheduled'}`;
        chip.textContent = isPastSt ? 'Ended' : 'Scheduled';
        [
          String(st.showtime_id),
          st.movie_title || '—',
          st.cinema_name || '—',
          st.screen_name || '—',
          formatDateTimeFull(st.start_time),
          formatTime(st.end_time),
          formatINR(st.ticket_price),
          '', // status chip
        ].forEach((text, i) => {
          const td = document.createElement('td');
          if (i === 7) {
            td.appendChild(chip);
          } else {
            td.textContent = text;
          }
          tr.appendChild(td);
        });
        showsTbody.appendChild(tr);
      });
    }
  };

  if (state.loaded) {
    doPopulate();
  } else {
    Promise.all([
      apiFetch('/api/movies'),
      apiFetch('/api/showtimes'),
    ]).then(([moviesData, showtimesData]) => {
      state.movies    = moviesData.movies    || [];
      state.showtimes = showtimesData.showtimes || [];
      state.loaded    = true;
      doPopulate();
    }).catch(() => {
      setText('adminHealthVal', 'Could not load data — check server.');
    });
  }
}

function initAdminTabs() {
  const tabs = document.querySelectorAll('[data-admin-tab]');
  tabs.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = link.getAttribute('data-admin-tab');

      tabs.forEach(l => { l.classList.remove('active'); l.removeAttribute('aria-current'); });
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');

      ['overview', 'movies', 'cinemas', 'showtimes', 'users', 'bookings', 'payments', 'settings'].forEach(id => {
        const panel = el(`adminTab-${id}`);
        if (panel) panel.hidden = (id !== tabId);
      });
    });
  });
}

// ─────────────────────────────────────────────────────
// THEME TOGGLE (DARK / LIGHT)
// ─────────────────────────────────────────────────────

function initThemeToggle() {
  function getSavedTheme() {
    try {
      const saved = localStorage.getItem('lumen_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (_) {}
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('lumen_theme', theme);
    } catch (_) {}

    const isLight = theme === 'light';
    const nextLabel = isLight ? 'Dark' : 'Light';

    // Header toggle text
    setText('themeToggleVal', nextLabel);

    // Other theme toggle buttons
    ['themeToggleCustomer', 'themeToggleOwner', 'themeToggleAdmin'].forEach(id => {
      const btn = el(id);
      if (btn) {
        btn.setAttribute('aria-label', `Switch to ${nextLabel} theme`);
        const txt = btn.querySelector('.theme-toggle__text');
        if (txt) txt.textContent = `Theme: ${isLight ? 'Light' : 'Dark'}`;
      }
    });

    const headerBtn = el('themeToggle');
    if (headerBtn) {
      headerBtn.setAttribute('aria-label', `Switch to ${nextLabel} theme`);
    }
  }

  const initial = document.documentElement.getAttribute('data-theme') || getSavedTheme();
  applyTheme(initial);

  // Wire all .theme-toggle buttons
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      applyTheme(next);
    });
  });
}

// ─────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initLogin();
  initOwnerTabs();
  initAdminTabs();
  initMobileNav();
  initNavScrolling();
  initSearchAndFilter();
  initModals();
  initGlobalErrorRetry();
  initScrollSpy();
  // Note: checkHealth() and loadData() are called from enterCustomerView()
  // or populateOwnerDashboard() / populateAdminDashboard() on login.
});

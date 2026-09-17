'use strict';
/* global anvil */

// ---------------------------------------------------------------- State ---
const state = {
  view: 'play',
  instances: [],
  selectedId: null,
  settings: null,
  account: null,
  browseSource: 'modrinth',
  browse: { query: '', cursor: 0, total: Infinity, loading: false },
  variant: 'dev',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 139, g: 92, b: 246 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function lighten({ r, g, b }, amount = 0.22) {
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Apply theme / accent color / rounded-UI setting to the document. */
/** In the public build, there's no path to Admin at all - the nav item, the unlock panel, and the admin-key field aren't even in the shipped HTML, not just hidden by CSS. Guarded with `?.` since this same script also runs against the dev build's markup, which does have them. */
function applyVariant() {
  const isPublic = state.variant === 'public';
  const navAdmin = $('#nav-admin');
  if (navAdmin) navAdmin.hidden = isPublic || !state.settings?.adminUnlocked;
  const adminPanel = $('#admin-access-panel');
  if (adminPanel) adminPanel.hidden = isPublic;
  const backendKeyRow = $('#backend-admin-key-row');
  if (backendKeyRow) backendKeyRow.hidden = isPublic;
}

function applyAppearance(settings) {
  if (!settings) return;
  document.documentElement.dataset.theme = settings.theme || 'dark';
  document.documentElement.dataset.rounded = settings.roundedUI === false ? 'false' : 'true';
  const accent = settings.accentColor || '#8b5cf6';
  const rgb = hexToRgb(accent);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-bright', lighten(rgb));
  document.documentElement.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  document.documentElement.dataset.nightsky = settings.nightSky ? 'true' : 'false';
  document.documentElement.dataset.sidebar = settings.sidebarPosition === 'right' ? 'right' : 'left';
  document.documentElement.dataset.density = settings.uiDensity === 'compact' ? 'compact' : 'comfortable';
  const sky = document.getElementById('night-sky');
  if (sky) sky.classList.toggle('active', !!settings.nightSky);

  const navAdminEl = $('#nav-admin');
  if (navAdminEl) navAdminEl.hidden = !settings.adminUnlocked;
  const showGolden = !!state.account?.premium;
  $('#account-name').classList.toggle('golden-name', showGolden);
  $('#account-panel-name').classList.toggle('golden-name', showGolden);
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function selectedInstance() {
  return state.instances.find((i) => i.id === state.selectedId) || null;
}

// ------------------------------------------------------------ Navigation --
// Cached once - these elements never change, so re-querying the DOM on every
// single tab click (as the old code did) was pointless work on the hot path.
const navItemEls = $$('.nav-item');
const viewEls = $$('.view');

function switchView(view) {
  if (view === 'admin' && state.variant === 'public') view = 'play'; // no path to admin in the public build, period
  state.view = view;
  navItemEls.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  viewEls.forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'mods') loadMods();
  if (view === 'browse') renderBrowseHeader();
  if (view === 'performance') loadPerformanceView();
  if (view === 'accounts') refreshAccountUI();
  if (view === 'premium') loadPremiumView();
  if (view === 'admin') loadAdminView();
}

$$('.nav-item, .btn-link[data-view]').forEach((btn) => {
  // Skin Editor lives in its own window now, not an in-app view - opening it
  // shouldn't also flip the sidebar's active-view highlight.
  if (btn.dataset.view === 'skin-editor') {
    btn.addEventListener('click', () => anvil.app.openSkinEditor());
  } else {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  }
});

// -------------------------------------------------------------- Instances -
async function loadInstances() {
  state.instances = await anvil.instances.list();
  if (!state.selectedId || !selectedInstance()) {
    state.selectedId = state.instances[0]?.id || null;
  }
  renderInstanceList();
  renderPlayHeader();
  await refreshPlaySelectors();
}

function renderInstanceList() {
  const list = $('#instance-list');
  list.innerHTML = '';
  for (const inst of state.instances) {
    const tile = document.createElement('div');
    tile.className = 'instance-tile' + (inst.id === state.selectedId ? ' selected' : '');
    tile.innerHTML = `
      <button class="instance-tile-delete" data-delete="${escapeAttr(inst.id)}" title="Delete instance">&times;</button>
      <div class="instance-tile-name">${escapeHtml(inst.name)}</div>
      <div class="instance-tile-meta">
        <span class="loader-badge ${inst.loader}">${inst.loader}</span>
        <span>${escapeHtml(inst.mcVersion)}</span>
      </div>`;
    tile.addEventListener('click', () => {
      state.selectedId = inst.id;
      renderInstanceList();
      renderPlayHeader();
      refreshPlaySelectors();
      if (state.view === 'mods') loadMods();
    });
    tile.querySelector('[data-delete]').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (launching && inst.id === state.selectedId) {
        toast("Can't delete an instance while it's running", true);
        return;
      }
      if (!confirm(`Delete "${inst.name}"? This removes its mods, saves, and worlds permanently.`)) return;
      await anvil.instances.remove(inst.id);
      if (state.selectedId === inst.id) state.selectedId = null;
      await loadInstances();
      toast(`Deleted "${inst.name}"`);
    });
    list.appendChild(tile);
  }
}

function renderPlayHeader() {
  const inst = selectedInstance();
  $('#mods-instance-name').textContent = inst ? inst.name : '—';
  $('#browse-instance-name').textContent = inst ? inst.name : '—';
  if (!inst) return;
  $('#play-instance-name').textContent = inst.name;
  $('#play-loader-tag').textContent = inst.loader.toUpperCase();
  $('#play-instance-sub').textContent = `Minecraft ${inst.mcVersion}`;
}

// Populate the Play view's inline version/loader quick-switchers, mirroring
// Pick your version right on the play screen, no separate profile switcher.
async function refreshPlaySelectors() {
  const inst = selectedInstance();
  if (!inst) return;

  const versionSel = $('#play-version-select');
  const loaderSel = $('#play-loader-select');
  const loaderVerSel = $('#play-loader-version-select');

  if (!versionSel.dataset.loaded) {
    const versions = await anvil.versions.vanilla({ includeSnapshots: state.settings?.showSnapshots });
    versionSel.innerHTML = versions.map((v) => `<option value="${v.id}">${v.id}</option>`).join('');
    versionSel.dataset.loaded = '1';
  }
  versionSel.value = inst.mcVersion;
  loaderSel.value = inst.loader;
  await populateLoaderVersions(loaderVerSel, inst.loader, inst.mcVersion, inst.loaderVersion);
}

async function populateLoaderVersions(selectEl, loader, mcVersion, current) {
  if (loader === 'vanilla') {
    selectEl.innerHTML = '<option value="latest">—</option>';
    selectEl.disabled = true;
    return;
  }
  selectEl.disabled = false;
  selectEl.innerHTML = '<option>Loading…</option>';
  try {
    let opts = [];
    if (loader === 'fabric') opts = (await anvil.versions.fabricLoaders(mcVersion)).map((v) => v.loaderVersion);
    else if (loader === 'quilt') opts = (await anvil.versions.quiltLoaders(mcVersion)).map((v) => v.loaderVersion);
    else if (loader === 'forge') opts = await anvil.versions.forgeBuilds(mcVersion);
    if (!opts.length) throw new Error('none');
    selectEl.innerHTML = ['latest', ...opts].map((v) => `<option value="${v}">${v}</option>`).join('');
    selectEl.value = opts.includes(current) ? current : 'latest';
  } catch {
    selectEl.innerHTML = '<option value="latest">latest</option>';
  }
}

async function applyPlaySelectorChange() {
  const inst = selectedInstance();
  if (!inst) return;
  const mcVersion = $('#play-version-select').value;
  const loader = $('#play-loader-select').value;
  await populateLoaderVersions($('#play-loader-version-select'), loader, mcVersion, 'latest');
  const loaderVersion = $('#play-loader-version-select').value;
  const updated = await anvil.instances.update(inst.id, { mcVersion, loader, loaderVersion });
  state.instances = state.instances.map((i) => (i.id === updated.id ? updated : i));
  renderInstanceList();
  renderPlayHeader();
}

$('#play-version-select').addEventListener('change', applyPlaySelectorChange);
$('#play-loader-select').addEventListener('change', applyPlaySelectorChange);
$('#play-loader-version-select').addEventListener('change', async () => {
  const inst = selectedInstance();
  if (!inst) return;
  const loaderVersion = $('#play-loader-version-select').value;
  const updated = await anvil.instances.update(inst.id, { loaderVersion });
  state.instances = state.instances.map((i) => (i.id === updated.id ? updated : i));
});

// -------------------------------------------------------- New instance modal
const modal = $('#modal-backdrop');
$('#btn-new-instance').addEventListener('click', async () => {
  modal.hidden = false;
  const versions = await anvil.versions.vanilla({ includeSnapshots: state.settings?.showSnapshots });
  const versionSel = $('#new-version');
  versionSel.innerHTML = versions.map((v) => `<option value="${v.id}">${v.id}</option>`).join('');
  await populateLoaderVersions($('#new-loader-version'), $('#new-loader').value, versionSel.value, 'latest');
});
$('#btn-cancel-new').addEventListener('click', () => { modal.hidden = true; });
$('#new-version').addEventListener('change', () =>
  populateLoaderVersions($('#new-loader-version'), $('#new-loader').value, $('#new-version').value, 'latest'));
$('#new-loader').addEventListener('change', () =>
  populateLoaderVersions($('#new-loader-version'), $('#new-loader').value, $('#new-version').value, 'latest'));

$('#btn-create-new').addEventListener('click', async () => {
  const name = $('#new-name').value.trim() || $('#new-version').value;
  const mcVersion = $('#new-version').value;
  const loader = $('#new-loader').value;
  const loaderVersion = $('#new-loader-version').value || 'latest';
  const inst = await anvil.instances.create({ name, mcVersion, loader, loaderVersion });
  modal.hidden = true;
  $('#new-name').value = '';
  state.selectedId = inst.id;
  await loadInstances();
  toast(`Created "${inst.name}"`);
});

// -------------------------------------------------------------------- Play
let launching = false;

async function startLaunch(joinServer = null) {
  const inst = selectedInstance();
  if (!inst || launching) return;
  if (!state.account) { toast('Sign in first — Account tab', true); switchView('accounts'); return; }

  switchView('play');
  launching = true;
  $('#btn-play').disabled = true;
  $('#play-button-label').textContent = joinServer ? 'CONNECTING…' : 'STARTING…';
  $('#progress-block').hidden = false;
  setProgress(0, 'Preparing…');

  try {
    await anvil.launch.start(inst.id, joinServer);
  } catch (err) {
    toast(err.message || String(err), true);
    resetPlayButton();
  }
}

$('#btn-play').addEventListener('click', () => startLaunch());

function resetPlayButton() {
  launching = false;
  $('#btn-play').disabled = false;
  $('#play-button-label').textContent = 'PLAY';
}

function setProgress(pct, label) {
  $('#progress-fill').style.width = `${Math.min(100, Math.max(0, pct))}%`;
  $('#progress-pct').textContent = `${Math.round(pct)}%`;
  if (label) $('#progress-label').textContent = label;
}

function logLine(text) {
  const el = $('#launch-console');
  el.textContent += text.endsWith('\n') ? text : text + '\n';
  el.scrollTop = el.scrollHeight;
}

$('#btn-clear-log').addEventListener('click', () => { $('#launch-console').textContent = ''; });

anvil.launch.onProgress(({ progress, size, element }) => {
  const pct = size ? (progress / size) * 100 : 0;
  setProgress(pct, `Downloading ${element || ''}`.trim());
});
anvil.launch.onCheck(({ progress, size, element }) => {
  const pct = size ? (progress / size) * 100 : 0;
  setProgress(pct, `Verifying ${element || ''}`.trim());
});
anvil.launch.onExtract((name) => setProgress(100, `Extracting ${name || ''}`.trim()));
anvil.launch.onEstimated((seconds) => {
  if (seconds > 0) $('#progress-label').textContent += ` (~${Math.ceil(seconds)}s left)`;
});
anvil.launch.onLog((line) => { logLine(line); $('#play-button-label').textContent = 'RUNNING'; });
anvil.launch.onClosed((code) => {
  logLine(`--- process exited (${code}) ---`);
  resetPlayButton();
});
anvil.launch.onError((message) => {
  toast(message, true);
  logLine(`ERROR: ${message}`);
  resetPlayButton();
});

// -------------------------------------------------------------------- Mods
async function loadMods() {
  const inst = selectedInstance();
  const sel = $('#mods-instance-select');
  sel.innerHTML = state.instances.map((i) => `<option value="${i.id}" ${i.id === state.selectedId ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('');
  if (!inst) return;
  const list = await anvil.mods.list(inst.id);
  renderModList(list);
}

$('#mods-instance-select').addEventListener('change', (e) => {
  state.selectedId = e.target.value;
  renderInstanceList();
  renderPlayHeader();
  refreshPlaySelectors();
  loadMods();
});

function renderModList(mods) {
  const el = $('#installed-mod-list');
  if (!mods.length) {
    el.innerHTML = '<p class="muted small">No mods installed yet. Drag some in above, or use Browse Mods.</p>';
    return;
  }
  el.innerHTML = '';
  for (const mod of mods) {
    const row = document.createElement('div');
    row.className = 'mod-row' + (mod.enabled ? '' : ' disabled');
    row.innerHTML = `
      <div class="toggle ${mod.enabled ? 'on' : ''}" data-filename="${escapeAttr(mod.filename)}"></div>
      <div class="mod-row-name">${escapeHtml(mod.displayName)}</div>
      ${mod.dependencyOf ? '<span class="mod-row-dep-tag">dependency</span>' : ''}
      <div class="mod-row-meta">${fmtBytes(mod.sizeBytes)}</div>
      <button class="btn btn-small btn-danger" data-remove="${escapeAttr(mod.filename)}">Remove</button>`;
    el.appendChild(row);
  }
  el.querySelectorAll('.toggle').forEach((t) => t.addEventListener('click', async () => {
    const inst = selectedInstance();
    await anvil.mods.toggle(inst.id, t.dataset.filename, !t.classList.contains('on'));
    loadMods();
  }));
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const inst = selectedInstance();
    await anvil.mods.remove(inst.id, b.dataset.remove);
    loadMods();
  }));
}

$('#btn-open-mods-folder').addEventListener('click', () => {
  const inst = selectedInstance();
  if (inst) anvil.mods.openFolder(inst.id);
});
$('#btn-goto-browse').addEventListener('click', () => switchView('browse'));

// Drag and drop
const dropzone = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
}));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
}));
dropzone.addEventListener('drop', async (e) => {
  const inst = selectedInstance();
  if (!inst) return;
  const files = Array.from(e.dataTransfer.files);
  await installDroppedFiles(inst.id, files);
});
dropzone.addEventListener('click', () => $('#dropzone-input').click());
$('#dropzone-input').addEventListener('change', async (e) => {
  const inst = selectedInstance();
  if (!inst) return;
  await installDroppedFiles(inst.id, Array.from(e.target.files));
  e.target.value = '';
});

async function installDroppedFiles(instanceId, files) {
  let ok = 0;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.jar')) continue;
    try {
      const filePath = anvil.getPathForFile(file);
      await anvil.mods.installLocalPath(instanceId, filePath);
      ok++;
    } catch (err) {
      toast(`${file.name}: ${err.message || err}`, true);
    }
  }
  if (ok) toast(`Installed ${ok} mod${ok > 1 ? 's' : ''}`);
  loadMods();
}

// ------------------------------------------------------------------ Browse
function renderBrowseHeader() {
  const inst = selectedInstance();
  $('#browse-instance-name').textContent = inst ? inst.name : '—';
  $('#curseforge-hint').hidden = state.browseSource !== 'curseforge' || !!state.settings?.curseforgeApiKey;
  $('#modpacks-hint').hidden = state.browseSource !== 'modpacks';
}

$$('.segmented-btn[data-source]').forEach((btn) => btn.addEventListener('click', () => {
  $$('.segmented-btn[data-source]').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.browseSource = btn.dataset.source;
  renderBrowseHeader();
  runBrowseSearch();
}));

$('#btn-browse-search').addEventListener('click', runBrowseSearch);
$('#browse-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') runBrowseSearch(); });

async function runBrowseSearch() {
  const inst = selectedInstance();
  if (!inst) return;
  state.browse.query = $('#browse-query').value.trim();
  state.browse.cursor = 0;
  state.browse.total = Infinity;
  state.browse.loading = false;
  $('#browse-results').innerHTML = '<p class="muted small">Searching…</p>';
  await loadMoreBrowseResults(true);
}

/** Fetch the next page of results for the current query/source and append them (or replace, for a fresh search). */
async function loadMoreBrowseResults(isFirstPage = false) {
  const inst = selectedInstance();
  if (!inst || state.browse.loading) return;
  if (!isFirstPage && state.browse.cursor >= state.browse.total) return;

  state.browse.loading = true;
  $('#browse-loading-more').hidden = isFirstPage;
  try {
    const loader = inst.loader === 'vanilla' ? null : inst.loader;
    let page;
    if (state.browseSource === 'modrinth') {
      page = await anvil.browse.modrinthSearch(state.browse.query, { loader, mcVersion: inst.mcVersion, offset: state.browse.cursor });
    } else if (state.browseSource === 'curseforge') {
      page = await anvil.browse.curseforgeSearch(state.browse.query, { loader, mcVersion: inst.mcVersion, index: state.browse.cursor });
    } else {
      page = await anvil.modpacks.search(state.browse.query, { offset: state.browse.cursor });
    }
    const hits = page.hits || [];
    state.browse.total = page.totalHits ?? (state.browse.cursor + hits.length);
    state.browse.cursor += hits.length;
    if (isFirstPage && !hits.length) {
      $('#browse-results').innerHTML = '<p class="muted small">No results.</p>';
    } else {
      renderBrowseResults(hits, isFirstPage);
    }
  } catch (err) {
    if (isFirstPage) $('#browse-results').innerHTML = `<p class="muted small">${escapeHtml(err.message || String(err))}</p>`;
    else toast('Could not load more results', true);
  } finally {
    state.browse.loading = false;
    $('#browse-loading-more').hidden = true;
  }
}

// Infinite scroll: the Browse view itself is the scrolling container.
$('#view-browse').addEventListener('scroll', () => {
  const el = $('#view-browse');
  if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) {
    loadMoreBrowseResults(false);
  }
});

function renderBrowseResults(mods, replace) {
  const el = $('#browse-results');
  if (replace) el.innerHTML = '';
  for (const mod of mods) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    card.innerHTML = `
      <div class="mod-card-icon" style="background-image:url('${mod.iconUrl || ''}')"></div>
      <div class="mod-card-body">
        <div class="mod-card-title">${escapeHtml(mod.title)}</div>
        <div class="mod-card-author">${escapeHtml(mod.author || '')}</div>
        <div class="mod-card-desc">${escapeHtml(mod.description || '')}</div>
        <div class="mod-card-foot">
          <span class="mod-card-downloads">${formatDownloads(mod.downloads)} installs</span>
          <button class="btn btn-small btn-accent" data-install>Install</button>
        </div>
      </div>`;
    card.querySelector('[data-install]').addEventListener('click', async (e) => {
      const isModpack = state.browseSource === 'modpacks';
      e.target.textContent = 'Installing…';
      e.target.disabled = true;
      const inst = selectedInstance();
      try {
        if (isModpack) {
          modpackInstallEl = e.target;
          const result = await anvil.modpacks.install(mod.id, mod.title);
          e.target.textContent = 'Installed';
          state.selectedId = result.instance.id;
          await loadInstances();
          toast(`Installed "${result.instance.name}" as a new instance (${result.fileCount} files)`);
        } else {
          const result = mod.source === 'modrinth'
            ? await anvil.mods.installFromModrinth(inst.id, mod.id)
            : await anvil.mods.installFromCurseforge(inst.id, mod.id);
          e.target.textContent = 'Installed';
          if (result?.alreadyInstalled) {
            toast(`${mod.title} is already installed`);
          } else {
            const depCount = result?.dependenciesInstalled?.length || 0;
            toast(depCount ? `Installed ${mod.title} (+${depCount} dependenc${depCount === 1 ? 'y' : 'ies'})` : `Installed ${mod.title}`);
          }
        }
      } catch (err) {
        e.target.textContent = 'Install';
        e.target.disabled = false;
        toast(err.message || String(err), true);
      } finally {
        modpackInstallEl = null;
      }
    });
    el.appendChild(card);
  }
}

let modpackInstallEl = null;
anvil.modpacks.onProgress(({ done, total }) => {
  if (modpackInstallEl && total) modpackInstallEl.textContent = `Installing… ${Math.round((done / total) * 100)}%`;
});

function formatDownloads(n) {
  if (!n) return '0';
  if (n > 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n > 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// ----------------------------------------------------------------- Account
async function refreshAccountUI() {
  state.account = await anvil.auth.current();
  const accounts = await anvil.auth.list();
  const signedIn = !!state.account;

  $('#account-name').textContent = signedIn ? state.account.name : 'Not signed in';
  $('#account-panel-name').textContent = signedIn ? state.account.name : 'Not signed in';
  $('#account-panel-sub').textContent = signedIn
    ? 'Active account — used to launch the game.'
    : 'Add the Microsoft account that owns Minecraft.';
  const showGolden = !!state.account?.premium;
  $('#account-name').classList.toggle('golden-name', showGolden);
  $('#account-panel-name').classList.toggle('golden-name', showGolden);

  const uuid = state.account?.uuid;
  $('#account-avatar').style.backgroundImage = '';
  $('#account-avatar-large').style.backgroundImage = '';
  if (uuid) {
    anvil.auth.faceIcon(uuid).then((dataUrl) => {
      if (!dataUrl || state.account?.uuid !== uuid) return; // avoid a race if the user switched accounts meanwhile
      $('#account-avatar').style.backgroundImage = `url('${dataUrl}')`;
      $('#account-avatar-large').style.backgroundImage = `url('${dataUrl}')`;
    }).catch(() => {});
  }

  renderAccountList(accounts);
}

function renderAccountList(accounts) {
  const el = $('#account-list');
  if (!accounts.length) {
    el.innerHTML = '<p class="muted small">No accounts added yet.</p>';
    return;
  }
  el.innerHTML = '';
  for (const acc of accounts) {
    const row = document.createElement('div');
    row.className = 'account-row' + (acc.uuid === state.account?.uuid ? ' active' : '');
    row.innerHTML = `
      <div class="account-row-avatar" data-avatar="${escapeAttr(acc.uuid)}"></div>
      <div class="account-row-name${acc.premium ? ' golden-name' : ''}">${escapeHtml(acc.name)}</div>
      ${acc.premium ? '<span class="mod-row-dep-tag">premium</span>' : ''}
      ${acc.uuid === state.account?.uuid ? '<span class="account-row-badge">Active</span>' : ''}
      <button class="btn btn-small btn-danger" data-remove-account="${escapeAttr(acc.uuid)}">Remove</button>`;
    row.addEventListener('click', async (e) => {
      if (e.target.closest('[data-remove-account]')) return;
      if (acc.uuid === state.account?.uuid) return;
      await anvil.auth.switch(acc.uuid);
      await refreshAccountUI();
      toast(`Switched to ${acc.name}`);
    });
    row.querySelector('[data-remove-account]').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove "${acc.name}"? You'll need to sign in again to use it.`)) return;
      await anvil.auth.remove(acc.uuid);
      await refreshAccountUI();
      toast(`Removed ${acc.name}`);
    });
    el.appendChild(row);

    anvil.auth.faceIcon(acc.uuid).then((dataUrl) => {
      if (dataUrl) row.querySelector('[data-avatar]').style.backgroundImage = `url('${dataUrl}')`;
    }).catch(() => {});
  }
}

$('#btn-add-account').addEventListener('click', async () => {
  $('#btn-add-account').disabled = true;
  $('#btn-add-account').textContent = 'Waiting for sign-in…';
  try {
    await anvil.auth.signIn();
    toast('Account added');
  } catch (err) {
    toast(err.message || String(err), true);
  } finally {
    $('#btn-add-account').disabled = false;
    $('#btn-add-account').textContent = 'Add account';
    refreshAccountUI();
  }
});

// ---------------------------------------------------------------- Settings
async function loadSettings() {
  state.settings = await anvil.settings.get();
  $('#mem-min').value = state.settings.memoryMinGb;
  $('#mem-max').value = state.settings.memoryMaxGb;
  $('#mem-min-label').textContent = `${state.settings.memoryMinGb} GB`;
  $('#mem-max-label').textContent = `${state.settings.memoryMaxGb} GB`;
  $('#win-width').value = state.settings.windowWidth;
  $('#win-height').value = state.settings.windowHeight;
  $('#win-fullscreen').checked = state.settings.fullscreen;
  $('#java-path').value = state.settings.javaPath || '';
  $('#curseforge-key').value = state.settings.curseforgeApiKey || '';
  $('#show-snapshots').checked = state.settings.showSnapshots;
  $('#close-on-launch').checked = state.settings.closeOnLaunch;
  $('#backend-url-input').value = state.settings.backendUrl || '';
  const backendAdminKeyInput = $('#backend-admin-key-input');
  if (backendAdminKeyInput) backendAdminKeyInput.value = state.settings.backendAdminKey || '';
  const adminBadge = $('#admin-unlocked-badge');
  if (adminBadge) adminBadge.hidden = !state.settings.adminUnlocked;
  $('#admin-premium-toggle')?.classList.toggle('on', !!state.account?.premium);
  applyVariant();
  applyAppearance(state.settings);
  renderCustomisationUI();
  anvil.dev.debugInfo().then((info) => {
    $('#about-version').textContent = info.split('\n')[0];
  }).catch(() => {});
}

function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  anvil.settings.set(patch);
}

$('#mem-min').addEventListener('input', (e) => {
  $('#mem-min-label').textContent = `${e.target.value} GB`;
  saveSettings({ memoryMinGb: Number(e.target.value) });
});
$('#mem-max').addEventListener('input', (e) => {
  $('#mem-max-label').textContent = `${e.target.value} GB`;
  saveSettings({ memoryMaxGb: Number(e.target.value) });
});
$('#win-width').addEventListener('change', (e) => saveSettings({ windowWidth: Number(e.target.value) }));
$('#win-height').addEventListener('change', (e) => saveSettings({ windowHeight: Number(e.target.value) }));
$('#win-fullscreen').addEventListener('change', (e) => saveSettings({ fullscreen: e.target.checked }));
$('#show-snapshots').addEventListener('change', (e) => saveSettings({ showSnapshots: e.target.checked }));
$('#close-on-launch').addEventListener('change', (e) => saveSettings({ closeOnLaunch: e.target.checked }));
$('#curseforge-key').addEventListener('change', (e) => {
  saveSettings({ curseforgeApiKey: e.target.value.trim() });
  renderBrowseHeader();
});
$('#backend-url-input').addEventListener('change', (e) => {
  saveSettings({ backendUrl: e.target.value.trim() });
});
$('#backend-admin-key-input')?.addEventListener('change', (e) => {
  saveSettings({ backendAdminKey: e.target.value.trim() });
});
$('#btn-choose-java').addEventListener('click', async () => {
  const picked = await anvil.settings.chooseJava();
  if (picked) {
    $('#java-path').value = picked;
    saveSettings({ javaPath: picked });
  }
});

// ---------------------------------------------------------------- Admin
// Local-only unlock, not real access control - the code lives in this file,
// so it's really just a fun toggle rather than anything security-sensitive.
// None of this markup even exists in the public build (stripped at build
// time), so every lookup here is optional-chained: this same script also
// runs unmodified against the dev build's HTML, which does have it.
const ADMIN_CODE = '10101';

$('#btn-admin-unlock')?.addEventListener('click', async () => {
  const entered = $('#admin-code-input').value.trim();
  if (entered === ADMIN_CODE) {
    saveSettings({ adminUnlocked: true });
    applyAppearance(state.settings);
    $('#admin-unlocked-badge').hidden = false;
    $('#admin-code-input').value = '';
    if (state.account) await anvil.auth.tagActive({ adminUnlocked: true });
    toast('Admin unlocked');
  } else {
    toast('Incorrect code', true);
  }
});

$('#admin-premium-toggle')?.addEventListener('click', async () => {
  if (!state.account) {
    toast('Sign in first — Premium is saved to your account', true);
    return;
  }
  const next = !$('#admin-premium-toggle').classList.contains('on');
  state.account = await anvil.auth.tagActive({ premium: next });
  applyAppearance(state.settings);
  $('#admin-premium-toggle').classList.toggle('on', next);
  toast(next ? `Premium granted to ${state.account.name}` : `Premium revoked from ${state.account.name}`);
  if (state.view === 'premium') loadPremiumView();
  if (state.view === 'admin') loadAdminView();
});

// ------------------------------------------------------------ Customisation
function renderCustomisationUI() {
  const s = state.settings || {};
  $$('#theme-segmented .segmented-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === (s.theme || 'dark')));
  const accent = (s.accentColor || '#8b5cf6').toLowerCase();
  $$('#accent-swatches .swatch').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === accent));
  $('#accent-custom').value = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#8b5cf6';
  $('#rounded-toggle').classList.toggle('on', s.roundedUI !== false);
  $('#night-sky-toggle').classList.toggle('on', !!s.nightSky);
  $$('#sidebar-position-segmented .segmented-btn').forEach((b) => b.classList.toggle('active', b.dataset.sidebarPosition === (s.sidebarPosition || 'left')));
  $$('#density-segmented .segmented-btn').forEach((b) => b.classList.toggle('active', b.dataset.density === (s.uiDensity || 'comfortable')));
  $('#star-density').value = s.starDensity ?? 40;
  $('#star-density-value').textContent = s.starDensity ?? 40;
  $('#shooting-star-count').value = s.shootingStarCount ?? 7;
  $('#shooting-star-count-value').textContent = s.shootingStarCount ?? 7;
  $('#shooting-star-speed').value = s.shootingStarSpeed ?? 1;
  $('#shooting-star-speed-value').textContent = `${(s.shootingStarSpeed ?? 1).toFixed(1)}x`;
  $$('#startup-animation-segmented .segmented-btn').forEach((b) => b.classList.toggle('active', b.dataset.startup === (s.startupAnimation || 'full')));
}

$$('#theme-segmented .segmented-btn').forEach((btn) => btn.addEventListener('click', () => {
  saveSettings({ theme: btn.dataset.theme });
  applyAppearance(state.settings);
  renderCustomisationUI();
}));

$$('#sidebar-position-segmented .segmented-btn').forEach((btn) => btn.addEventListener('click', () => {
  saveSettings({ sidebarPosition: btn.dataset.sidebarPosition });
  applyAppearance(state.settings);
  renderCustomisationUI();
}));

$$('#density-segmented .segmented-btn').forEach((btn) => btn.addEventListener('click', () => {
  saveSettings({ uiDensity: btn.dataset.density });
  applyAppearance(state.settings);
  renderCustomisationUI();
}));

$$('#accent-swatches .swatch').forEach((btn) => btn.addEventListener('click', () => {
  saveSettings({ accentColor: btn.dataset.color });
  applyAppearance(state.settings);
  renderCustomisationUI();
}));

$('#accent-custom').addEventListener('input', (e) => {
  saveSettings({ accentColor: e.target.value });
  applyAppearance(state.settings);
  renderCustomisationUI();
});

$('#rounded-toggle').addEventListener('click', () => {
  const next = !$('#rounded-toggle').classList.contains('on');
  saveSettings({ roundedUI: next });
  applyAppearance(state.settings);
  renderCustomisationUI();
});

$('#night-sky-toggle').addEventListener('click', () => {
  const next = !$('#night-sky-toggle').classList.contains('on');
  saveSettings({ nightSky: next });
  applyAppearance(state.settings);
  renderCustomisationUI();
});

$('#star-density').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  $('#star-density-value').textContent = value;
  saveSettings({ starDensity: value });
  spawnStarDots(value);
});

$('#shooting-star-count').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  $('#shooting-star-count-value').textContent = value;
  saveSettings({ shootingStarCount: value });
  spawnShootingStars(value, state.settings.shootingStarSpeed ?? 1);
});

$('#shooting-star-speed').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  $('#shooting-star-speed-value').textContent = `${value.toFixed(1)}x`;
  saveSettings({ shootingStarSpeed: value });
  spawnShootingStars(state.settings.shootingStarCount ?? 7, value);
});

// ------------------------------------------------------------- Performance
async function loadPerformanceView() {
  const inst = selectedInstance();
  $('#perf-instance-name').textContent = inst ? inst.name : '—';
  $('#specs-grid').innerHTML = '<p class="muted small">Scanning…</p>';
  $('#perf-recommendations').innerHTML = '';

  const { specs, recommendations } = await anvil.system.perfRecommendations();

  const stat = (label, value, sub) => `
    <div class="spec-stat">
      <div class="spec-stat-label">${escapeHtml(label)}</div>
      <div class="spec-stat-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="spec-stat-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;

  const cpuSub = specs.cpu ? `${specs.cpu.physicalCores || specs.cpu.cores} cores · ${specs.cpu.speedGhz ? specs.cpu.speedGhz + ' GHz' : 'unknown speed'}` : '';
  const gpuValue = specs.gpus?.length ? specs.gpus.map((g) => g.model).filter(Boolean).join(', ') || 'Unknown' : 'Unknown';
  const gpuSub = specs.gpus?.[0]?.vramGb ? `${specs.gpus[0].vramGb} GB VRAM` : '';
  const osValue = specs.os?.platform || 'Unknown';
  const osSub = specs.os?.arch || '';

  $('#specs-grid').innerHTML =
    stat('CPU', specs.cpu?.brand || 'Unknown', cpuSub) +
    stat('Memory', specs.memTotalGb ? `${specs.memTotalGb} GB` : 'Unknown') +
    stat('Graphics', gpuValue, gpuSub) +
    stat('System', osValue, osSub);

  if (!inst || inst.loader === 'vanilla') {
    $('#perf-recommendations').innerHTML = '<p class="muted small" style="margin-top:18px;">Performance mods need a Fabric or Quilt instance selected on the Play tab.</p>';
    return;
  }

  const container = $('#perf-recommendations');
  for (const group of recommendations) {
    const section = document.createElement('div');
    section.className = 'perf-group';
    section.innerHTML = `<div class="perf-group-title">${escapeHtml(group.reason)}</div><div class="mod-list"></div>`;
    const list = section.querySelector('.mod-list');
    for (const mod of group.mods) {
      const row = document.createElement('div');
      row.className = 'mod-row';
      row.innerHTML = `
        <div class="mod-row-name"><strong>${escapeHtml(mod.title)}</strong> — ${escapeHtml(mod.blurb)}</div>
        <button class="btn btn-small btn-accent" data-install-perf="${escapeAttr(mod.slug)}">Install</button>`;
      row.querySelector('[data-install-perf]').addEventListener('click', async (e) => {
        e.target.textContent = 'Installing…';
        e.target.disabled = true;
        try {
          const result = await anvil.mods.installFromModrinth(inst.id, mod.slug);
          e.target.textContent = 'Installed';
          if (result?.alreadyInstalled) toast(`${mod.title} is already installed`);
          else toast(`Installed ${mod.title}`);
        } catch (err) {
          e.target.textContent = 'Install';
          e.target.disabled = false;
          toast(err.message || String(err), true);
        }
      });
      list.appendChild(row);
    }
    container.appendChild(section);
  }
}

$('#btn-rescan-specs').addEventListener('click', loadPerformanceView);

// -------------------------------------------------------------- Premium
async function loadPremiumView() {
  const locked = !state.account?.premium;
  $('#premium-locked').hidden = !locked;
  $('#premium-content').hidden = locked;
  if (locked) return;

  const inst = selectedInstance();
  const [deep, { specs, recommendations }, stats] = await Promise.all([
    anvil.system.deepSpecs(),
    anvil.system.premiumRecommendations(),
    anvil.dev.launchStats(),
  ]);

  const stat = (label, value, sub) => `
    <div class="spec-stat">
      <div class="spec-stat-label">${escapeHtml(label)}</div>
      <div class="spec-stat-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="spec-stat-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;

  $('#premium-stats-grid').innerHTML =
    stat('Instances', String(stats.instanceCount)) +
    stat('Mods installed', String(stats.totalMods)) +
    stat('Total launches', String(stats.totalPlays)) +
    stat('Accounts added', String(stats.accountCount));

  $('#premium-jvm-args').value = state.settings.customJvmArgs || '';

  anvil.system.recommendMemory().then(({ minGb, maxGb }) => {
    $('#premium-memory-suggestion').textContent = `Based on your system: ${minGb}GB minimum, ${maxGb}GB maximum (currently set to ${state.settings.memoryMinGb}GB / ${state.settings.memoryMaxGb}GB).`;
    $('#btn-apply-recommended-memory').dataset.min = minGb;
    $('#btn-apply-recommended-memory').dataset.max = maxGb;
  }).catch(() => {
    $('#premium-memory-suggestion').textContent = 'Could not read system memory.';
  });

  const cacheLine = deep.cpuCache
    ? `L1 ${Math.round((deep.cpuCache.l1d || 0) / 1024)}KB · L2 ${Math.round((deep.cpuCache.l2 || 0) / 1024)}KB · L3 ${Math.round((deep.cpuCache.l3 || 0) / 1024 / 1024)}MB`
    : 'Unknown';
  const memSlotsLine = deep.memSlots?.length
    ? deep.memSlots.map((m) => `${m.sizeGb || '?'}GB${m.type ? ' ' + m.type : ''}`).join(', ')
    : 'Unknown';
  const diskLine = deep.disks?.length
    ? deep.disks.map((d) => `${d.name || d.type || 'Disk'}${d.sizeGb ? ` (${d.sizeGb}GB)` : ''}`).join(', ')
    : 'Unknown';

  $('#premium-specs-grid').innerHTML =
    stat('CPU cache', cacheLine) +
    stat('Memory slots', memSlotsLine) +
    stat('Storage', diskLine);

  const container = $('#premium-recommendations');
  container.innerHTML = '';
  if (!inst || inst.loader === 'vanilla') {
    container.innerHTML = '<p class="muted small" style="margin-top:18px;">Performance mods need a Fabric or Quilt instance selected on the Play tab.</p>';
    return;
  }
  for (const group of recommendations) {
    const section = document.createElement('div');
    section.className = 'perf-group';
    section.innerHTML = `<div class="perf-group-title">${escapeHtml(group.reason)}</div><div class="mod-list"></div>`;
    const list = section.querySelector('.mod-list');
    for (const mod of group.mods) {
      const row = document.createElement('div');
      row.className = 'mod-row';
      row.innerHTML = `
        <div class="mod-row-name"><strong>${escapeHtml(mod.title)}</strong> — ${escapeHtml(mod.blurb)}</div>
        <button class="btn btn-small btn-accent" data-install-premium="${escapeAttr(mod.slug)}">Install</button>`;
      row.querySelector('[data-install-premium]').addEventListener('click', async (e) => {
        e.target.textContent = 'Installing…';
        e.target.disabled = true;
        try {
          const result = await anvil.mods.installFromModrinth(inst.id, mod.slug);
          e.target.textContent = 'Installed';
          if (result?.alreadyInstalled) toast(`${mod.title} is already installed`);
          else toast(`Installed ${mod.title}`);
        } catch (err) {
          e.target.textContent = 'Install';
          e.target.disabled = false;
          toast(err.message || String(err), true);
        }
      });
      list.appendChild(row);
    }
    container.appendChild(section);
  }
}

$('#premium-jvm-args').addEventListener('change', (e) => {
  saveSettings({ customJvmArgs: e.target.value.trim() });
});

$('#btn-apply-recommended-memory').addEventListener('click', (e) => {
  const minGb = Number(e.target.dataset.min);
  const maxGb = Number(e.target.dataset.max);
  saveSettings({ memoryMinGb: minGb, memoryMaxGb: maxGb });
  $('#mem-min').value = minGb;
  $('#mem-max').value = maxGb;
  $('#mem-min-label').textContent = `${minGb} GB`;
  $('#mem-max-label').textContent = `${maxGb} GB`;
  toast(`Memory set to ${minGb}GB / ${maxGb}GB`);
  loadPremiumView();
});

$('#btn-backup-instance').addEventListener('click', async () => {
  const inst = selectedInstance();
  if (!inst) { toast('Select an instance on the Play tab first', true); return; }
  try {
    const result = await anvil.instances.backup(inst.id);
    if (!result.canceled) toast(`Backed up "${inst.name}"`);
  } catch (err) {
    toast(err.message || String(err), true);
  }
});

$('#btn-restore-instance').addEventListener('click', async () => {
  try {
    const result = await anvil.instances.restore();
    if (!result.canceled) {
      await loadInstances();
      state.selectedId = result.instance.id;
      renderInstanceList();
      toast(`Restored "${result.instance.name}"`);
    }
  } catch (err) {
    toast(err.message || String(err), true);
  }
});

// ---------------------------------------------------------------- Admin
async function loadAdminView() {
  if (state.variant === 'public') return; // unreachable in this build anyway - defensive only
  $('#admin-premium-toggle').classList.toggle('on', !!state.account?.premium);
  anvil.dev.rawSettings().then((json) => { $('#admin-raw-settings').textContent = json; }).catch(() => {});
  loadRemoteAccounts();
  const accounts = await anvil.auth.list();
  const sorted = [...accounts].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const el = $('#admin-join-log');
  if (!sorted.length) {
    el.innerHTML = '<p class="muted small">No accounts added yet.</p>';
  } else {
    el.innerHTML = sorted.map((acc) => {
      const when = acc.joinedAt ? new Date(acc.joinedAt).toLocaleString() : 'Unknown date';
      const badges = [
        acc.adminUnlocked ? '<span class="mod-row-dep-tag">admin</span>' : '',
        acc.premium ? '<span class="mod-row-dep-tag">premium</span>' : '',
      ].join('');
      return `
        <div class="mod-row">
          <div class="mod-row-name">${escapeHtml(acc.name)}${badges}</div>
          <div class="mod-row-meta" style="width:auto;">${escapeHtml(when)}</div>
        </div>`;
    }).join('');
  }
}

async function loadRemoteAccounts() {
  const el = $('#remote-accounts-list');
  el.innerHTML = '<p class="muted small">Loading…</p>';
  try {
    const accounts = await anvil.admin.remoteAccounts();
    if (!accounts.length) {
      el.innerHTML = '<p class="muted small">No accounts have checked in yet.</p>';
      return;
    }
    el.innerHTML = '';
    for (const acc of accounts) {
      const row = document.createElement('div');
      row.className = 'mod-row';
      const when = acc.lastSeen ? new Date(acc.lastSeen).toLocaleString() : 'Unknown';
      row.innerHTML = `
        <div class="mod-row-name">
          <strong>${escapeHtml(acc.name)}</strong>
          ${acc.premium ? '<span class="mod-row-dep-tag">premium</span>' : ''}
          ${acc.banned ? '<span class="mod-row-dep-tag">banned</span>' : ''}
        </div>
        <div class="mod-row-meta" style="width:auto;">Last seen ${escapeHtml(when)}</div>
        <button class="btn btn-small" data-toggle-premium>${acc.premium ? 'Revoke' : 'Grant'} Premium</button>
        <button class="btn btn-small btn-danger" data-toggle-ban>${acc.banned ? 'Unban' : 'Ban'}</button>`;
      row.querySelector('[data-toggle-premium]').addEventListener('click', async () => {
        try {
          await anvil.admin.setRemotePremium(acc.uuid, !acc.premium);
          toast(`${acc.premium ? 'Revoked' : 'Granted'} Premium for ${acc.name}`);
          loadRemoteAccounts();
        } catch (err) {
          toast(err.message || String(err), true);
        }
      });
      row.querySelector('[data-toggle-ban]').addEventListener('click', async () => {
        try {
          await anvil.admin.setRemoteBan(acc.uuid, !acc.banned);
          toast(`${acc.banned ? 'Unbanned' : 'Banned'} ${acc.name}`);
          loadRemoteAccounts();
        } catch (err) {
          toast(err.message || String(err), true);
        }
      });
      el.appendChild(row);
    }
  } catch (err) {
    el.innerHTML = `<p class="muted small">${escapeHtml(err.message || String(err))}</p>`;
  }
}

$('#btn-refresh-remote-accounts')?.addEventListener('click', loadRemoteAccounts);

$('#btn-refresh-premium').addEventListener('click', async () => {
  const account = await anvil.auth.syncPremium();
  if (account) state.account = account;
  applyAppearance(state.settings);
  toast(account?.premium ? 'Premium is active!' : 'No Premium found for this account yet');
  loadPremiumView();
});

$('#btn-open-data-folder')?.addEventListener('click', () => anvil.dev.openDataFolder());
$('#btn-open-logs-folder')?.addEventListener('click', () => anvil.dev.openLogsFolder());

$('#btn-open-instance-folder')?.addEventListener('click', () => {
  const inst = selectedInstance();
  if (!inst) { toast('Select an instance on the Play tab first', true); return; }
  anvil.dev.openInstanceFolder(inst.id);
});

$('#btn-clear-mod-manifest')?.addEventListener('click', async () => {
  const inst = selectedInstance();
  if (!inst) { toast('Select an instance on the Play tab first', true); return; }
  if (!confirm(`Clear the dependency-tracking manifest for "${inst.name}"? This doesn't remove any mod files, just forgets which ones were auto-installed as dependencies.`)) return;
  await anvil.dev.clearModManifest(inst.id);
  toast('Mod manifest cleared');
  if (state.view === 'mods') loadMods();
});

$('#btn-copy-debug-info')?.addEventListener('click', async () => {
  const info = await anvil.dev.debugInfo();
  try {
    await navigator.clipboard.writeText(info);
    toast('Debug info copied');
  } catch {
    toast('Could not copy to clipboard', true);
  }
});

$('#btn-reset-settings')?.addEventListener('click', async () => {
  if (!confirm('Reset all settings to their defaults? This includes theme, accent color, memory, and everything in Customisation.')) return;
  state.settings = await anvil.dev.resetSettings();
  applyAppearance(state.settings);
  renderCustomisationUI();
  toast('Settings reset');
});

// ------------------------------------------------------------------ Utils
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

// ------------------------------------------------------------ Night sky
/**
 * Small fixed twinkling stars - count controlled by the "Star density" setting.
 */
function spawnStarDots(density) {
  const sky = document.getElementById('night-sky');
  if (!sky) return;
  sky.querySelectorAll('.star-dot').forEach((el) => el.remove());
  for (let i = 0; i < density; i++) {
    const dot = document.createElement('span');
    dot.className = 'star-dot';
    const size = Math.random() < 0.5 ? 1 : 1.5;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.top = `${Math.random() * 100}%`;
    dot.style.left = `${Math.random() * 100}%`;
    dot.style.opacity = (0.4 + Math.random() * 0.6).toFixed(2);
    sky.appendChild(dot);
  }
}

/**
 * Shooting stars - count and speed controlled by settings. Each one spawns
 * just off-screen from either the left edge (random height, steep 40-80deg
 * diagonal) or the left portion of the top edge (random x, a shallower
 * 30-55deg so it reads as heading further right rather than straight down),
 * at a speed scaled by `speedMultiplier` (higher = faster), with a random
 * stagger so they don't all fire in sync.
 */
function spawnShootingStars(count, speedMultiplier = 1) {
  const sky = document.getElementById('night-sky');
  if (!sky) return;
  sky.querySelectorAll('.shooting-star').forEach((el) => el.remove());
  for (let i = 0; i < count; i++) {
    const star = document.createElement('span');
    star.className = 'shooting-star';
    const dist = 260 + Math.random() * 220;
    const baseDuration = 6 + Math.random() * 7;
    const duration = baseDuration / speedMultiplier;
    const delay = Math.random() * 12;
    let angle;
    if (Math.random() < 0.5) {
      // from the left edge, any height - a clear steep diagonal
      angle = 40 + Math.random() * 40; // 40-80deg
      star.style.left = '-6%';
      star.style.top = `${5 + Math.random() * 75}%`;
    } else {
      // from the left portion of the top edge - shallower, so it heads further right
      angle = 30 + Math.random() * 25; // 30-55deg
      star.style.top = '-6%';
      star.style.left = `${10 + Math.random() * 45}%`;
    }
    star.style.setProperty('--angle', `${angle.toFixed(1)}deg`);
    star.style.setProperty('--dist', `${dist.toFixed(0)}px`);
    star.style.animationDuration = `${duration.toFixed(1)}s`;
    star.style.animationDelay = `${delay.toFixed(1)}s`;
    sky.appendChild(star);
  }
}

function regenerateNightSky() {
  const s = state.settings || {};
  spawnStarDots(s.starDensity ?? 40);
  spawnShootingStars(s.shootingStarCount ?? 7, s.shootingStarSpeed ?? 1);
}

// --------------------------------------------------------- Startup intro
/**
 * Meteor-hits-moon startup sequence. 'full' plays the whole thing (fly-in,
 * impact flash/shockwave/particles, wordmark, then the app slides in behind
 * it); 'quick' is the same sequence compressed to a fraction of the time;
 * 'off' skips straight to the app with no overlay at all. Clicking the
 * overlay or the Skip button jumps straight to the reveal from wherever the
 * sequence currently is.
 */
/** Scatters small twinkling stars across the full intro overlay, reusing the same .star-dot look as the main app's night sky. */
function spawnIntroStars() {
  const wrap = $('#intro-stars');
  if (!wrap || wrap.childElementCount) return; // only needs generating once per launch
  const count = 140;
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('span');
    dot.className = 'star-dot';
    const size = Math.random() < 0.6 ? 1 : Math.random() < 0.85 ? 1.5 : 2;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.top = `${Math.random() * 100}%`;
    dot.style.left = `${Math.random() * 100}%`;
    const baseOpacity = (0.35 + Math.random() * 0.65).toFixed(2);
    dot.style.setProperty('--base-opacity', baseOpacity);
    dot.style.opacity = baseOpacity;
    dot.style.animationDelay = `${(Math.random() * 2.6).toFixed(2)}s`;
    wrap.appendChild(dot);
  }
}

function playIntroAnimation(mode) {
  const overlay = $('#intro-overlay');
  const appEl = $('#app');
  if (!overlay || !appEl) return;

  if (mode === 'off') {
    overlay.hidden = true;
    return;
  }

  spawnIntroStars();

  const quick = mode === 'quick';
  const flyDur = quick ? 450 : 1400;
  const impactDur = quick ? 260 : 700;
  const revealDur = quick ? 250 : 600;
  overlay.style.setProperty('--intro-fly-dur', `${flyDur}ms`);
  overlay.style.setProperty('--intro-impact-dur', `${impactDur}ms`);
  overlay.style.setProperty('--intro-reveal-dur', `${revealDur}ms`);

  const meteor = $('#intro-meteor');
  const moon = $('#intro-moon');
  const flash = $('#intro-flash');
  const shockwave = $('#intro-shockwave');
  const shockwave2 = $('#intro-shockwave-2');
  const screenFlash = $('#intro-screen-flash');
  const wordmark = $('#intro-wordmark');
  const particlesWrap = $('#intro-particles');

  let done = false;
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function spawnParticles() {
    if (!particlesWrap) return;
    const count = quick ? 9 : 20;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'intro-particle';
      if (Math.random() < 0.4) p.classList.add('bright');
      const angle = Math.random() * 360;
      const dist = 70 + Math.random() * 130;
      p.style.setProperty('--angle', `${angle.toFixed(1)}deg`);
      p.style.setProperty('--dist', `${dist.toFixed(0)}px`);
      p.style.animationDelay = `${(Math.random() * 60).toFixed(0)}ms`;
      particlesWrap.appendChild(p);
    }
  }

  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    overlay.classList.add('hide');
    appEl.classList.add('intro-entering');
    later(() => {
      overlay.hidden = true;
      appEl.classList.remove('intro-entering');
    }, revealDur + 50);
  }

  overlay.addEventListener('click', finish, { once: true });
  $('#intro-skip')?.addEventListener('click', finish, { once: true });

  // Fly in, then impact, then reveal.
  meteor?.classList.add('flying');
  later(() => {
    moon?.classList.add('shake');
    flash?.classList.add('impact');
    shockwave?.classList.add('impact');
    shockwave2?.classList.add('impact');
    screenFlash?.classList.add('impact');
    spawnParticles();
    wordmark?.classList.add('show');
  }, flyDur);
  later(() => wordmark?.classList.add('collapse'), flyDur + impactDur + 250);
  later(finish, flyDur + impactDur + (quick ? 350 : 550));
}

$$('#startup-animation-segmented .segmented-btn').forEach((btn) => btn.addEventListener('click', () => {
  saveSettings({ startupAnimation: btn.dataset.startup });
  renderCustomisationUI();
}));

// ------------------------------------------------------------------ Updater
function setUpdateStatusText(text) {
  const el = $('#update-status');
  if (el) el.textContent = text;
}

anvil.updater.onStatus((status) => {
  const banner = $('#update-banner');
  switch (status.state) {
    case 'checking':
      setUpdateStatusText('Checking for updates…');
      break;
    case 'available':
      setUpdateStatusText(`Update v${status.version} found — downloading…`);
      break;
    case 'not-available':
      setUpdateStatusText('You\u2019re up to date.');
      break;
    case 'downloading':
      setUpdateStatusText(`Downloading update… ${status.percent}%`);
      break;
    case 'downloaded':
      setUpdateStatusText(`Version ${status.version} downloaded — installs automatically on next restart.`);
      if (banner) {
        $('#update-banner-text').textContent = `Version ${status.version} is downloaded and will install itself next time Nyx Client restarts — no action needed. Or restart now:`;
        banner.hidden = false;
      }
      break;
    case 'error':
      setUpdateStatusText('Couldn\u2019t check for updates.');
      break;
    default:
      break;
  }
});

$('#btn-check-updates')?.addEventListener('click', () => anvil.updater.check());
$('#btn-restart-update')?.addEventListener('click', () => anvil.updater.install());

// ------------------------------------------------------------------- Boot
(async function init() {
  state.variant = await anvil.app.variant();
  await loadSettings();
  playIntroAnimation(state.settings.startupAnimation || 'full');
  regenerateNightSky();
  await refreshAccountUI();
  anvil.auth.syncPremium().then((account) => {
    if (account) { state.account = account; applyAppearance(state.settings); refreshAccountUI(); }
  }).catch(() => {});
  await loadInstances();
})();

/**
 * Premium institution selector for public web student login.
 * Keeps #login-tenant as the single source of truth for tenant ID.
 * Client-side search only — no Auth, Firestore, or session writes.
 */
(function () {
  'use strict';

  var MOBILE_MQ = '(max-width: 720px)';
  var PLACEHOLDER = 'Kurum seçin';
  var LOADING_TEXT = 'Kurumlar yükleniyor…';
  var BODY_SHEET_CLASS = 'tenant-select-sheet-open';
  var NO_MATCH_TEXT = 'Eşleşen kurum bulunamadı.';

  var root = null;
  var selectEl = null;
  var trigger = null;
  var triggerLabel = null;
  var popover = null;
  var desktopList = null;
  var backdrop = null;
  var sheet = null;
  var sheetList = null;
  var sheetClose = null;
  var statusEl = null;
  var searchDesktop = null;
  var searchMobile = null;
  var clearDesktop = null;
  var clearMobile = null;
  var searchStatusEl = null;

  var open = false;
  var activeIndex = -1;
  var optionIds = [];
  var searchQuery = '';
  var initialized = false;
  var lockedScrollY = 0;
  var mediaQuery = null;
  var lastAnnouncedStatus = '';

  function isMobile() {
    return mediaQuery ? mediaQuery.matches : window.matchMedia(MOBILE_MQ).matches;
  }

  function normalizeTr(value) {
    return String(value || '').trim().toLocaleLowerCase('tr-TR');
  }

  function getTenantOptions() {
    if (!selectEl) return [];
    var out = [];
    var opts = selectEl.options;
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      if (!opt || !opt.value) continue;
      out.push({ id: opt.value, label: (opt.textContent || '').trim() || opt.value });
    }
    return out;
  }

  function matchesInstitution(label, queryRaw) {
    var q = normalizeTr(queryRaw);
    if (!q) return true;
    var name = normalizeTr(label);
    if (!name) return false;
    if (name.indexOf(q) === 0) return true;
    var words = name.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i] && words[i].indexOf(q) === 0) return true;
    }
    return name.indexOf(q) !== -1;
  }

  function getFilteredTenants() {
    var all = getTenantOptions();
    if (!searchQuery) return all;
    return all.filter(function (t) {
      return matchesInstitution(t.label, searchQuery);
    });
  }

  function selectedLabel() {
    if (!selectEl || !selectEl.value) return '';
    var opt = selectEl.options[selectEl.selectedIndex];
    return opt ? (opt.textContent || '').trim() : '';
  }

  function isLoading() {
    return !!(selectEl && selectEl.dataset && selectEl.dataset.loading === '1');
  }

  function hasErrorOrEmptyStatus() {
    if (!statusEl) return false;
    var text = (statusEl.textContent || '').trim();
    if (!text) return false;
    return statusEl.classList.contains('tenant-load-status-error') || text.length > 0;
  }

  function canOpen() {
    if (!selectEl || selectEl.disabled || isLoading()) return false;
    return getTenantOptions().length > 0;
  }

  function updateTriggerText() {
    if (!triggerLabel) return;
    if (isLoading()) {
      triggerLabel.textContent = LOADING_TEXT;
      return;
    }
    var label = selectedLabel();
    if (label) {
      triggerLabel.textContent = label;
      return;
    }
    if (!canOpen() && hasErrorOrEmptyStatus()) {
      triggerLabel.textContent = PLACEHOLDER;
      return;
    }
    triggerLabel.textContent = PLACEHOLDER;
  }

  function syncTriggerEnabled() {
    if (!trigger) return;
    var enable = canOpen();
    trigger.disabled = !enable;
    trigger.setAttribute('aria-disabled', enable ? 'false' : 'true');
  }

  function syncSearchEnabled() {
    var enable = canOpen();
    [searchDesktop, searchMobile].forEach(function (input) {
      if (!input) return;
      input.disabled = !enable;
    });
    if (!enable) {
      setSearchQuery('', { render: false, announce: false });
    }
  }

  function setExpanded(expanded) {
    if (!trigger) return;
    trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function syncSearchUi() {
    var q = searchQuery;
    [searchDesktop, searchMobile].forEach(function (input) {
      if (!input) return;
      if (input.value !== q) input.value = q;
    });
    var showClear = !!q;
    [clearDesktop, clearMobile].forEach(function (btn) {
      if (!btn) return;
      btn.hidden = !showClear;
    });
  }

  function announceSearchStatus(filteredCount, hasQuery, hasSource) {
    if (!searchStatusEl) return;
    var text = '';
    if (!hasSource) {
      text = '';
    } else if (hasQuery && filteredCount === 0) {
      text = NO_MATCH_TEXT;
    } else if (hasQuery) {
      text = filteredCount + ' kurum bulundu';
    } else {
      text = '';
    }
    if (text === lastAnnouncedStatus) return;
    lastAnnouncedStatus = text;
    searchStatusEl.textContent = text;
  }

  function buildEmptyMessage() {
    var el = document.createElement('p');
    el.className = 'tenant-select__empty';
    el.setAttribute('role', 'status');
    el.textContent = NO_MATCH_TEXT;
    return el;
  }

  function buildOptionButton(tenant, index, listOwner) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tenant-select__option';
    btn.setAttribute('role', 'option');
    btn.setAttribute('data-tenant-id', tenant.id);
    btn.setAttribute('data-option-index', String(index));
    btn.id = listOwner + '-opt-' + index;
    var selected = !!(selectEl && selectEl.value === tenant.id);
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    if (selected) btn.classList.add('is-selected');

    var name = document.createElement('span');
    name.className = 'tenant-select__option-name';
    name.textContent = tenant.label;

    var mark = document.createElement('span');
    mark.className = 'tenant-select__option-mark';
    mark.setAttribute('aria-hidden', 'true');

    btn.appendChild(name);
    btn.appendChild(mark);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      chooseTenant(tenant.id);
    });
    return btn;
  }

  function fillList(listEl, listOwner, tenants, hasSource, hasQuery) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!hasSource) return;
    if (hasQuery && tenants.length === 0) {
      listEl.appendChild(buildEmptyMessage());
      return;
    }
    tenants.forEach(function (t, i) {
      listEl.appendChild(buildOptionButton(t, i, listOwner));
    });
  }

  function renderLists() {
    var all = getTenantOptions();
    var hasSource = all.length > 0;
    var hasQuery = !!normalizeTr(searchQuery);
    var tenants = hasQuery ? getFilteredTenants() : all;
    optionIds = tenants.map(function (t) { return t.id; });

    fillList(desktopList, 'tenant-select-listbox', tenants, hasSource, hasQuery);
    fillList(sheetList, 'tenant-select-sheet-listbox', tenants, hasSource, hasQuery);
    announceSearchStatus(tenants.length, hasQuery, hasSource);
  }

  function setSearchQuery(next, opts) {
    opts = opts || {};
    searchQuery = String(next || '');
    syncSearchUi();
    if (opts.render !== false) {
      renderLists();
      activeIndex = -1;
    }
    if (opts.announce === false && searchStatusEl && !normalizeTr(searchQuery)) {
      lastAnnouncedStatus = '';
      searchStatusEl.textContent = '';
    }
  }

  function clearSearch(focusInput) {
    setSearchQuery('');
    if (focusInput) {
      var input = isMobile() ? searchMobile : searchDesktop;
      if (input && !input.disabled) {
        try { input.focus(); } catch (_) { /* ignore */ }
      }
    }
  }

  function activeListEl() {
    return isMobile() ? sheetList : desktopList;
  }

  function getOptionButtons() {
    var list = activeListEl();
    if (!list) return [];
    return Array.prototype.slice.call(list.querySelectorAll('.tenant-select__option'));
  }

  function setActiveIndex(next, doFocus) {
    var buttons = getOptionButtons();
    if (!buttons.length) {
      activeIndex = -1;
      return;
    }
    if (next < 0) next = 0;
    if (next >= buttons.length) next = buttons.length - 1;
    activeIndex = next;
    buttons.forEach(function (btn, i) {
      var on = i === activeIndex;
      btn.classList.toggle('is-active', on);
      if (on && doFocus !== false) {
        btn.focus({ preventScroll: false });
        try {
          btn.scrollIntoView({ block: 'nearest' });
        } catch (_) { /* ignore */ }
      }
    });
  }

  function chooseTenant(tenantId) {
    if (!selectEl || !tenantId) return;
    selectEl.value = tenantId;
    try {
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
      var ev = document.createEvent('Event');
      ev.initEvent('change', true, false);
      selectEl.dispatchEvent(ev);
    }
    updateTriggerText();
    setSearchQuery('', { render: false });
    renderLists();
    closeSelector(true);
  }

  function positionPopover() {
    if (!popover || !root || !trigger) return;
    popover.classList.remove('tenant-select__popover--above');
    var triggerRect = trigger.getBoundingClientRect();
    var spaceBelow = window.innerHeight - triggerRect.bottom;
    var spaceAbove = triggerRect.top;
    var maxH = Math.min(window.innerHeight * 0.5, 380);
    if (spaceBelow < Math.min(200, maxH) && spaceAbove > spaceBelow) {
      popover.classList.add('tenant-select__popover--above');
    }
  }

  function lockBodyScroll() {
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add(BODY_SHEET_CLASS);
    document.body.style.top = '-' + lockedScrollY + 'px';
  }

  function unlockBodyScroll() {
    if (!document.body.classList.contains(BODY_SHEET_CLASS)) {
      document.body.style.top = '';
      return;
    }
    document.body.classList.remove(BODY_SHEET_CLASS);
    document.body.style.top = '';
    window.scrollTo(0, lockedScrollY || 0);
  }

  function openDesktop() {
    if (!popover) return;
    popover.hidden = false;
    positionPopover();
    setExpanded(true);
    open = true;
    var selected = selectEl ? selectEl.value : '';
    var idx = selected ? optionIds.indexOf(selected) : -1;
    if (idx >= 0) setActiveIndex(idx, false);
    if (searchDesktop && !searchDesktop.disabled) {
      try { searchDesktop.focus(); } catch (_) { /* ignore */ }
    }
  }

  function openMobile() {
    if (!sheet || !backdrop) return;
    backdrop.hidden = false;
    sheet.hidden = false;
    lockBodyScroll();
    setExpanded(true);
    open = true;
    trigger.setAttribute('aria-controls', 'tenant-select-sheet-listbox');
    var selected = selectEl ? selectEl.value : '';
    var idx = selected ? optionIds.indexOf(selected) : -1;
    if (idx >= 0) setActiveIndex(idx, false);
    // Do not focus search — avoids auto-opening the mobile keyboard.
  }

  function openSelector() {
    if (open || !canOpen()) return;
    setSearchQuery('', { render: false, announce: false });
    renderLists();
    if (isMobile()) {
      openMobile();
    } else {
      trigger.setAttribute('aria-controls', 'tenant-select-listbox');
      openDesktop();
    }
  }

  function closeSelector(returnFocus) {
    if (!open) {
      setExpanded(false);
      return;
    }
    open = false;
    setExpanded(false);
    if (popover) popover.hidden = true;
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    unlockBodyScroll();
    activeIndex = -1;
    setSearchQuery('', { render: true, announce: false });
    trigger.setAttribute('aria-controls', 'tenant-select-listbox');
    if (returnFocus && trigger && !trigger.disabled) {
      try { trigger.focus(); } catch (_) { /* ignore */ }
    }
  }

  function onTriggerClick(e) {
    e.preventDefault();
    if (open) {
      closeSelector(false);
      return;
    }
    openSelector();
  }

  function onTriggerKeydown(e) {
    if (trigger.disabled) return;
    var key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
      e.preventDefault();
      if (!open) openSelector();
      else if (key === 'ArrowDown') setActiveIndex(activeIndex + 1);
      else if (key === 'ArrowUp') setActiveIndex(Math.max(0, activeIndex - 1));
    } else if (key === 'Escape' && open) {
      e.preventDefault();
      closeSelector(true);
    }
  }

  function onSearchInput(e) {
    setSearchQuery(e.target.value);
  }

  function onSearchKeydown(e) {
    if (!open) return;
    var key = e.key;
    if (key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      closeSelector(true);
      return;
    }
    if (key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(0, true);
      return;
    }
    if (key === 'ArrowUp') {
      e.preventDefault();
      var buttons = getOptionButtons();
      if (buttons.length) setActiveIndex(buttons.length - 1, true);
    }
  }

  function onClearClick(e) {
    e.preventDefault();
    e.stopPropagation();
    clearSearch(true);
  }

  function onListKeydown(e) {
    if (!open) return;
    var key = e.key;
    var buttons = getOptionButtons();
    if (key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      if (activeIndex <= 0) {
        activeIndex = -1;
        buttons.forEach(function (btn) { btn.classList.remove('is-active'); });
        var input = isMobile() ? searchMobile : searchDesktop;
        if (input && !input.disabled) {
          try { input.focus(); } catch (_) { /* ignore */ }
        }
        return;
      }
      setActiveIndex(activeIndex - 1);
    } else if (key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (key === 'End') {
      e.preventDefault();
      setActiveIndex(buttons.length - 1);
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      if (activeIndex >= 0 && buttons[activeIndex]) {
        var id = buttons[activeIndex].getAttribute('data-tenant-id');
        if (id) chooseTenant(id);
      }
    } else if (key === 'Escape') {
      e.preventDefault();
      closeSelector(true);
    } else if (key === 'Tab') {
      // Allow natural tab; do not force-close while moving within the open UI.
    }
  }

  function onDocumentPointer(e) {
    if (!open) return;
    var t = e.target;
    if (root && root.contains(t)) return;
    if (sheet && !sheet.hidden && sheet.contains(t)) return;
    if (backdrop && t === backdrop) {
      closeSelector(true);
      return;
    }
    if (!isMobile()) closeSelector(true);
  }

  function onBreakpointChange() {
    // Close only when desktop/mobile presentation mode actually flips.
    // Do not close on keyboard / visual-viewport height resizes.
    if (!open) return;
    closeSelector(false);
  }

  function refresh() {
    if (!initialized) return;
    renderLists();
    updateTriggerText();
    syncTriggerEnabled();
    syncSearchEnabled();
    if (open && !canOpen()) closeSelector(false);
    if (open && !isMobile() && popover && !popover.hidden) positionPopover();
  }

  function enhance() {
    if (!root || !selectEl) return;
    root.classList.add('tenant-select--enhanced');
    selectEl.setAttribute('tabindex', '-1');
    selectEl.setAttribute('aria-hidden', 'true');
  }

  function wireSearch(input, clearBtn) {
    if (!input) return;
    input.addEventListener('input', onSearchInput);
    input.addEventListener('keydown', onSearchKeydown);
    input.addEventListener('search', function (e) {
      // Native clear on type=search must not submit the form.
      e.preventDefault();
      setSearchQuery(input.value);
    });
    if (clearBtn) clearBtn.addEventListener('click', onClearClick);
  }

  function init() {
    if (initialized) return;
    selectEl = document.getElementById('login-tenant');
    root = document.getElementById('tenant-select');
    trigger = document.getElementById('tenant-select-trigger');
    triggerLabel = document.getElementById('tenant-select-trigger-label');
    popover = document.getElementById('tenant-select-popover');
    desktopList = document.getElementById('tenant-select-listbox');
    backdrop = document.getElementById('tenant-select-backdrop');
    sheet = document.getElementById('tenant-select-sheet');
    sheetList = document.getElementById('tenant-select-sheet-listbox');
    sheetClose = document.getElementById('tenant-select-sheet-close');
    statusEl = document.getElementById('tenant-load-status');
    searchDesktop = document.getElementById('tenant-select-search-desktop');
    searchMobile = document.getElementById('tenant-select-search-mobile');
    clearDesktop = document.getElementById('tenant-select-search-clear-desktop');
    clearMobile = document.getElementById('tenant-select-search-clear-mobile');
    searchStatusEl = document.getElementById('tenant-select-search-status');

    if (!selectEl || !root || !trigger || !triggerLabel || !popover || !desktopList || !backdrop || !sheet || !sheetList || !sheetClose || !searchDesktop || !searchMobile || !clearDesktop || !clearMobile) {
      return;
    }

    initialized = true;
    mediaQuery = window.matchMedia(MOBILE_MQ);
    enhance();
    refresh();

    trigger.addEventListener('click', onTriggerClick);
    trigger.addEventListener('keydown', onTriggerKeydown);
    desktopList.addEventListener('keydown', onListKeydown);
    sheetList.addEventListener('keydown', onListKeydown);
    sheetClose.addEventListener('click', function () { closeSelector(true); });
    backdrop.addEventListener('click', function () { closeSelector(true); });
    wireSearch(searchDesktop, clearDesktop);
    wireSearch(searchMobile, clearMobile);

    document.addEventListener('mousedown', onDocumentPointer);
    document.addEventListener('touchstart', onDocumentPointer, { passive: true });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        closeSelector(true);
      }
    });

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onBreakpointChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(onBreakpointChange);
    }

    window.addEventListener('pagehide', function () {
      closeSelector(false);
      unlockBodyScroll();
    });

    try {
      var mo = new MutationObserver(function () { refresh(); });
      mo.observe(selectEl, { childList: true, attributes: true, attributeFilter: ['disabled', 'data-loading'] });
    } catch (_) { /* ignore */ }

    selectEl.addEventListener('change', function () {
      updateTriggerText();
      renderLists();
    });
  }

  window.SA_WEB_TENANT_SELECT = {
    refresh: function () {
      if (!initialized) init();
      refresh();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

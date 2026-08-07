/**
 * Super Admin — Web Sayfaları (siteContent draft/published) V2
 * Scoped to #admin-page-web-pages. No Auth observer / Firebase init / onSnapshot.
 */
(function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var PAGE_KEYS = ['about', 'services', 'contact'];
  var PAGE_LABELS = {
    about: 'Hakkımızda',
    services: 'Hizmetlerimiz',
    contact: 'İletişim'
  };
  var CTA_KINDS = ['primary', 'secondary', 'outline'];
  var MAX_CTA = 3;
  var LIMITS = {
    title: 120,
    subtitle: 240,
    seoTitle: 70,
    metaDescription: 160,
    sectionId: 80,
    heading: 200,
    paragraph: 5000,
    item: 500,
    maxParagraphs: 40,
    maxItems: 40,
    ctaLabel: 80,
    ctaHref: 500,
    disclaimer: 2500
  };

  var ALLOWED_SECTION_TYPES = {
    hero: true,
    text: true,
    list: true,
    benefits: true,
    ctaGroup: true,
    disclaimer: true
  };

  var state = {
    dirty: false,
    binding: false,
    busy: false,
    activePageKey: null,
    view: 'home',
    loadToken: 0,
    homeStatusToken: 0,
    draftMeta: null,
    publishedMeta: null,
    blocks: [],
    ctas: [],
    unknownSections: [],
    lastFocusedFormatField: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getDb() {
    if (typeof firebase === 'undefined' || !firebase.firestore) return null;
    return firebase.firestore();
  }

  function getUid() {
    try {
      return (firebase.auth() && firebase.auth().currentUser && firebase.auth().currentUser.uid) || '';
    } catch (e) {
      return '';
    }
  }

  function draftRef(pageKey) {
    return getDb().collection('siteContent').doc(pageKey).collection('draft').doc('current');
  }

  function publishedRef(pageKey) {
    return getDb().collection('siteContent').doc(pageKey).collection('published').doc('current');
  }

  function setMsg(text, isError) {
    var el = $('web-pages-msg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#b91c1c' : '';
  }

  function setBusy(busy) {
    state.busy = !!busy;
    ['btn-web-pages-save', 'btn-web-pages-publish', 'btn-web-pages-restore', 'web-pages-back-btn', 'web-pages-cta-add'].forEach(function (id) {
      var btn = $(id);
      if (btn) btn.disabled = !!busy || (id !== 'btn-web-pages-restore' && hasUnknownData());
    });
    if (hasUnknownData()) {
      var restore = $('btn-web-pages-restore');
      if (restore && !busy) restore.disabled = false;
      var save = $('btn-web-pages-save');
      var pub = $('btn-web-pages-publish');
      if (save) save.disabled = true;
      if (pub) pub.disabled = true;
    }
  }

  function hasUnknownData() {
    return state.unknownSections && state.unknownSections.length > 0;
  }

  function markDirty() {
    if (state.binding) return;
    state.dirty = true;
  }

  function clearDirty() {
    state.dirty = false;
  }

  function isDirty() {
    return !!state.dirty;
  }

  function formatTs(ts) {
    if (!ts) return '—';
    try {
      var d = typeof ts.toDate === 'function' ? ts.toDate() : (ts instanceof Date ? ts : null);
      if (!d || isNaN(d.getTime())) return '—';
      return d.toLocaleString('tr-TR');
    } catch (e) {
      return '—';
    }
  }

  function uniqueId(prefix) {
    return String(prefix || 'blk') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function isSafeHref(href) {
    if (typeof href !== 'string') return false;
    var h = href.trim();
    if (!h || h.length > LIMITS.ctaHref) return false;
    var lower = h.toLowerCase();
    if (lower.indexOf('javascript:') === 0 || lower.indexOf('data:') === 0 || lower.indexOf('vbscript:') === 0) return false;
    if (h.indexOf('//') === 0) return false;
    if (h.charAt(0) === '/') return true;
    if (lower.indexOf('https://') === 0) return true;
    if (lower.indexOf('mailto:') === 0) return true;
    return false;
  }

  function containsHtmlRisk(str) {
    if (typeof str !== 'string') return true;
    if (/<\s*script/i.test(str)) return true;
    if (/<\/?[a-z][^>]*>/i.test(str)) return true;
    if (/on\w+\s*=/i.test(str)) return true;
    if (/javascript\s*:/i.test(str)) return true;
    if (/data\s*:/i.test(str)) return true;
    if (/vbscript\s*:/i.test(str)) return true;
    return false;
  }

  function stripRestrictedTokens(str) {
    var s = String(str || '');
    s = s.replace(/\[cyan\]([\s\S]*?)\[\/cyan\]/gi, '$1');
    s = s.replace(/\[gold\]([\s\S]*?)\[\/gold\]/gi, '$1');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/\*([^*]+)\*/g, '$1');
    return s;
  }

  function validateRestrictedMarkup(str, strict) {
    if (typeof str !== 'string') return 'Geçersiz metin.';
    if (containsHtmlRisk(str)) return 'HTML veya tehlikeli içerik kullanılamaz.';
    var openCyan = (str.match(/\[cyan\]/gi) || []).length;
    var closeCyan = (str.match(/\[\/cyan\]/gi) || []).length;
    var openGold = (str.match(/\[gold\]/gi) || []).length;
    var closeGold = (str.match(/\[\/gold\]/gi) || []).length;
    if (openCyan !== closeCyan || openGold !== closeGold) {
      if (strict) return 'Cyan/Altın etiketleri eksik veya hatalı.';
    }
    var linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
    var m;
    while ((m = linkRe.exec(str)) !== null) {
      if (!isSafeHref(m[2])) {
        if (strict) return 'Bağlantı adresi geçersiz veya güvenli değil.';
      }
    }
    if (/\]\s*\(\s*(javascript|data|vbscript):/i.test(str)) {
      return 'Bağlantı protokolü güvenli değil.';
    }
    return '';
  }

  function createEmptyContent() {
    return {
      title: '',
      subtitle: '',
      seoTitle: '',
      metaDescription: '',
      sections: [],
      ctaButtons: [],
      disclaimer: ''
    };
  }

  function sectionsToBlocks(sections) {
    var blocks = [];
    var unknown = [];
    var list = Array.isArray(sections) ? sections : [];
    list.forEach(function (sec) {
      if (!sec || typeof sec !== 'object') return;
      var type = String(sec.type || '');
      if (type === 'ctaGroup' || type === 'disclaimer') return;
      if (!ALLOWED_SECTION_TYPES[type]) {
        unknown.push(sec);
        return;
      }
      var sid = typeof sec.id === 'string' && sec.id ? sec.id : uniqueId('sec');
      var heading = typeof sec.heading === 'string' ? sec.heading.trim() : '';
      var paragraphs = Array.isArray(sec.paragraphs) ? sec.paragraphs : [];
      var items = Array.isArray(sec.items) ? sec.items : [];
      var cleanItems = items.filter(function (it) { return typeof it === 'string' && it.trim(); }).map(function (it) { return it.trim(); });

      /* List sections keep heading on the list block (listHeading), never peel to Ara Başlık. */
      if (type === 'list') {
        if (!heading && !cleanItems.length) return;
        blocks.push({
          id: sid,
          kind: 'list',
          value: cleanItems.join('\n'),
          listHeading: heading,
          accent: ''
        });
        return;
      }

      var usedId = false;

      if (heading) {
        blocks.push({
          id: sid,
          kind: 'heading',
          value: heading,
          accent: ''
        });
        usedId = true;
      }

      paragraphs.forEach(function (p) {
        if (typeof p !== 'string') return;
        var t = p.trim();
        if (!t) return;
        var fullAccent = t.match(/^\[(cyan|gold)\]([\s\S]*)\[\/(cyan|gold)\]$/i);
        if (
          fullAccent
          && fullAccent[1].toLowerCase() === fullAccent[3].toLowerCase()
          && fullAccent[2].indexOf('[cyan]') < 0
          && fullAccent[2].indexOf('[gold]') < 0
          && fullAccent[2].indexOf('[/cyan]') < 0
          && fullAccent[2].indexOf('[/gold]') < 0
        ) {
          blocks.push({
            id: usedId ? uniqueId('sec') : sid,
            kind: 'accent',
            value: fullAccent[2],
            accent: fullAccent[1].toLowerCase()
          });
          usedId = true;
          return;
        }
        blocks.push({
          id: usedId ? uniqueId('sec') : sid,
          kind: 'paragraph',
          value: t,
          accent: ''
        });
        usedId = true;
      });

      if (cleanItems.length) {
        blocks.push({
          id: usedId ? uniqueId('sec') : sid,
          kind: 'list',
          value: cleanItems.join('\n'),
          listHeading: '',
          accent: ''
        });
        usedId = true;
      }
    });
    return { blocks: blocks, unknown: unknown };
  }

  function blocksToSections(blocks) {
    var sections = [];
    var seen = {};
    (blocks || []).forEach(function (b) {
      if (!b || !b.kind) return;
      var id = typeof b.id === 'string' && b.id.trim() ? b.id.trim() : uniqueId('sec');
      if (seen[id]) id = uniqueId('sec');
      seen[id] = true;
      if (b.kind === 'heading') {
        var h = String(b.value || '').trim();
        if (!h) return;
        sections.push({ id: id, type: 'text', heading: h, paragraphs: [], items: [] });
        return;
      }
      if (b.kind === 'paragraph') {
        var p = String(b.value || '').trim();
        if (!p) return;
        sections.push({ id: id, type: 'text', heading: '', paragraphs: [p], items: [] });
        return;
      }
      if (b.kind === 'list') {
        var items = String(b.value || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
        var lh = String(b.listHeading || '').trim();
        if (!items.length && !lh) return;
        sections.push({ id: id, type: 'list', heading: lh, paragraphs: [], items: items });
        return;
      }
      if (b.kind === 'accent') {
        var av = String(b.value || '').trim();
        if (!av) return;
        var tone = b.accent === 'gold' ? 'gold' : 'cyan';
        sections.push({
          id: id,
          type: 'text',
          heading: '',
          paragraphs: ['[' + tone + ']' + av + '[/' + tone + ']'],
          items: []
        });
      }
    });
    return sections;
  }

  function showHomeView() {
    state.view = 'home';
    state.activePageKey = null;
    var home = $('web-pages-home-view');
    var editor = $('web-pages-editor-view');
    if (home) home.hidden = false;
    if (editor) editor.hidden = true;
  }

  function showEditorView() {
    state.view = 'editor';
    var home = $('web-pages-home-view');
    var editor = $('web-pages-editor-view');
    if (home) home.hidden = true;
    if (editor) editor.hidden = false;
  }

  function updateSeoCounters() {
    var title = $('web-pages-seo-title');
    var meta = $('web-pages-meta-description');
    var tc = $('web-pages-seo-title-count');
    var mc = $('web-pages-meta-description-count');
    if (tc && title) tc.textContent = String(title.value || '').length + ' / 70';
    if (mc && meta) mc.textContent = String(meta.value || '').length + ' / 160';
  }

  function openSeoPanel() {
    var panel = $('web-pages-seo-panel');
    if (panel) panel.open = true;
  }

  function setUnknownWarning(unknown) {
    state.unknownSections = unknown || [];
    var box = $('web-pages-unknown-warning');
    if (!box) return;
    if (state.unknownSections.length) {
      box.hidden = false;
      box.textContent = 'Bu içerikte yeni editörün tanımadığı bir bölüm bulunuyor. Veri kaybını önlemek için kayıt ve yayın işlemleri durduruldu.';
    } else {
      box.hidden = true;
      box.textContent = '';
    }
    setBusy(state.busy);
  }

  function renderMeta() {
    var draftBadge = $('web-pages-draft-badge');
    var pubBadge = $('web-pages-published-badge');
    var draftUpdated = $('web-pages-draft-updated');
    var pubAt = $('web-pages-published-at');
    var draftBy = $('web-pages-draft-by');
    var pubBy = $('web-pages-published-by');
    if (draftBadge) {
      draftBadge.textContent = state.draftMeta ? 'Taslak kayıtlı' : 'Henüz taslak kaydedilmedi';
      draftBadge.className = 'web-pages-status-badge ' + (state.draftMeta ? 'is-ok' : 'is-missing');
    }
    if (pubBadge) {
      pubBadge.textContent = state.publishedMeta ? 'Yayında' : 'Henüz yayımlanmadı';
      pubBadge.className = 'web-pages-status-badge ' + (state.publishedMeta ? 'is-ok' : 'is-missing');
    }
    if (draftUpdated) draftUpdated.textContent = formatTs(state.draftMeta && state.draftMeta.updatedAt);
    if (pubAt) pubAt.textContent = formatTs(state.publishedMeta && state.publishedMeta.publishedAt);
    if (draftBy) draftBy.textContent = (state.draftMeta && state.draftMeta.updatedBy) || '—';
    if (pubBy) pubBy.textContent = (state.publishedMeta && state.publishedMeta.publishedBy) || '—';
  }

  function applyCardStatus(pageKey, draftExists, publishedExists, updatedText) {
    var d = $('web-pages-card-' + pageKey + '-draft');
    var p = $('web-pages-card-' + pageKey + '-published');
    var u = $('web-pages-card-' + pageKey + '-updated');
    if (d) {
      d.textContent = draftExists ? 'Taslak kayıtlı' : 'Taslak yok';
      d.className = 'web-pages-status-badge ' + (draftExists ? 'is-ok' : 'is-missing');
    }
    if (p) {
      p.textContent = publishedExists ? 'Yayında' : 'Henüz yayımlanmadı';
      p.className = 'web-pages-status-badge ' + (publishedExists ? 'is-ok' : 'is-missing');
    }
    if (u) u.textContent = updatedText || '—';
  }

  function refreshHomeCardStatuses() {
    var db = getDb();
    if (!db) return;
    var token = ++state.homeStatusToken;
    var loading = $('web-pages-home-loading');
    if (loading) loading.hidden = false;
    var jobs = PAGE_KEYS.map(function (pageKey) {
      return Promise.all([
        draftRef(pageKey).get(),
        publishedRef(pageKey).get()
      ]).then(function (pair) {
        return {
          pageKey: pageKey,
          draftSnap: pair[0],
          pubSnap: pair[1]
        };
      });
    });
    Promise.all(jobs).then(function (results) {
      if (token !== state.homeStatusToken) return;
      results.forEach(function (r) {
        var draftExists = r.draftSnap.exists;
        var publishedExists = r.pubSnap.exists;
        var updatedText = '—';
        if (draftExists && r.draftSnap.data() && r.draftSnap.data().updatedAt) {
          updatedText = formatTs(r.draftSnap.data().updatedAt);
        } else if (publishedExists && r.pubSnap.data() && r.pubSnap.data().publishedAt) {
          updatedText = formatTs(r.pubSnap.data().publishedAt);
        }
        applyCardStatus(r.pageKey, draftExists, publishedExists, updatedText);
      });
    }).catch(function () {
      if (token !== state.homeStatusToken) return;
    }).then(function () {
      if (token !== state.homeStatusToken) return;
      if (loading) loading.hidden = true;
    });
  }

  function clearHost(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function renderBlocks() {
    var host = $('web-pages-blocks-host');
    if (!host) return;
    clearHost(host);
    if (!state.blocks.length) {
      var empty = document.createElement('p');
      empty.className = 'web-pages-blocks-empty muted';
      empty.textContent = 'Henüz içerik bloğu yok. Yukarıdaki düğmelerle ekleyin.';
      host.appendChild(empty);
      return;
    }
    state.blocks.forEach(function (block, index) {
      host.appendChild(buildBlockCard(block, index));
    });
  }

  function buildBlockCard(block, index) {
    var card = document.createElement('div');
    card.className = 'web-pages-block';
    card.dataset.blockIndex = String(index);

    var head = document.createElement('div');
    head.className = 'web-pages-block__head';
    var label = document.createElement('span');
    label.className = 'web-pages-block__label';
    var labels = { heading: 'Ara Başlık', paragraph: 'Paragraf', list: 'Madde Listesi', accent: 'Vurgu Metni' };
    label.textContent = labels[block.kind] || 'Blok';
    head.appendChild(label);

    var actions = document.createElement('div');
    actions.className = 'web-pages-block__actions';
    [['up', 'Yukarı'], ['down', 'Aşağı'], ['delete', 'Sil']].forEach(function (pair) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = pair[1];
      btn.dataset.blockAction = pair[0];
      btn.dataset.blockIndex = String(index);
      if (pair[0] === 'up' && index === 0) btn.disabled = true;
      if (pair[0] === 'down' && index === state.blocks.length - 1) btn.disabled = true;
      actions.appendChild(btn);
    });
    head.appendChild(actions);
    card.appendChild(head);

    if (block.kind === 'accent') {
      var toneWrap = document.createElement('div');
      toneWrap.className = 'field';
      var toneLabel = document.createElement('label');
      toneLabel.textContent = 'Vurgu türü';
      var toneSelect = document.createElement('select');
      toneSelect.dataset.blockField = 'accent';
      toneSelect.dataset.blockIndex = String(index);
      [['cyan', 'Cyan Vurgu'], ['gold', 'Altın Vurgu']].forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        if ((block.accent || 'cyan') === opt[0]) o.selected = true;
        toneSelect.appendChild(o);
      });
      toneWrap.appendChild(toneLabel);
      toneWrap.appendChild(toneSelect);
      card.appendChild(toneWrap);
    }

    if (block.kind === 'list') {
      var lhWrap = document.createElement('div');
      lhWrap.className = 'field';
      var lhLabel = document.createElement('label');
      lhLabel.textContent = 'Liste başlığı (isteğe bağlı)';
      var lhInput = document.createElement('input');
      lhInput.type = 'text';
      lhInput.maxLength = LIMITS.heading;
      lhInput.value = block.listHeading || '';
      lhInput.dataset.blockField = 'listHeading';
      lhInput.dataset.blockIndex = String(index);
      lhWrap.appendChild(lhLabel);
      lhWrap.appendChild(lhInput);
      card.appendChild(lhWrap);
    }

    var fieldWrap = document.createElement('div');
    fieldWrap.className = 'field';
    var fieldLabel = document.createElement('label');
    if (block.kind === 'heading') fieldLabel.textContent = 'Başlık metni';
    else if (block.kind === 'list') fieldLabel.textContent = 'Maddeler (her satır bir madde)';
    else fieldLabel.textContent = 'Metin';
    fieldWrap.appendChild(fieldLabel);

    var input;
    if (block.kind === 'heading') {
      input = document.createElement('input');
      input.type = 'text';
      input.maxLength = LIMITS.heading;
      input.value = block.value || '';
    } else {
      input = document.createElement('textarea');
      input.rows = block.kind === 'list' ? 5 : 4;
      input.maxLength = block.kind === 'list' ? LIMITS.item * LIMITS.maxItems : LIMITS.paragraph;
      input.value = block.value || '';
      if (block.kind === 'paragraph' || block.kind === 'accent') {
        input.dataset.formatTarget = '1';
      }
    }
    input.dataset.blockField = 'value';
    input.dataset.blockIndex = String(index);
    fieldWrap.appendChild(input);
    card.appendChild(fieldWrap);
    return card;
  }

  function syncBlocksFromDom() {
    var host = $('web-pages-blocks-host');
    if (!host) return;
    state.blocks.forEach(function (block, index) {
      var valueEl = host.querySelector('[data-block-field="value"][data-block-index="' + index + '"]');
      var accentEl = host.querySelector('[data-block-field="accent"][data-block-index="' + index + '"]');
      var lhEl = host.querySelector('[data-block-field="listHeading"][data-block-index="' + index + '"]');
      if (valueEl) block.value = valueEl.value;
      if (accentEl) block.accent = accentEl.value === 'gold' ? 'gold' : 'cyan';
      if (lhEl) block.listHeading = lhEl.value;
    });
  }

  function addBlock(kind) {
    if (hasUnknownData()) return;
    syncBlocksFromDom();
    var block = { id: uniqueId('sec'), kind: kind, value: '', accent: kind === 'accent' ? 'cyan' : '', listHeading: '' };
    state.blocks.push(block);
    markDirty();
    renderBlocks();
  }

  function moveBlock(index, dir) {
    syncBlocksFromDom();
    var next = index + dir;
    if (next < 0 || next >= state.blocks.length) return;
    var tmp = state.blocks[index];
    state.blocks[index] = state.blocks[next];
    state.blocks[next] = tmp;
    markDirty();
    renderBlocks();
  }

  function deleteBlock(index) {
    syncBlocksFromDom();
    state.blocks.splice(index, 1);
    markDirty();
    renderBlocks();
  }

  function renderCtas() {
    var host = $('web-pages-cta-host');
    if (!host) return;
    clearHost(host);
    state.ctas.forEach(function (cta, index) {
      host.appendChild(buildCtaRow(cta, index));
    });
    var addBtn = $('web-pages-cta-add');
    if (addBtn) addBtn.disabled = state.busy || hasUnknownData() || state.ctas.length >= MAX_CTA;
  }

  function buildCtaRow(cta, index) {
    var row = document.createElement('div');
    row.className = 'web-pages-cta-row';

    var labelField = document.createElement('div');
    labelField.className = 'field';
    var labelLab = document.createElement('label');
    labelLab.textContent = 'Buton Yazısı';
    var labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.maxLength = LIMITS.ctaLabel;
    labelInput.value = cta.label || '';
    labelInput.dataset.ctaField = 'label';
    labelInput.dataset.ctaIndex = String(index);
    labelField.appendChild(labelLab);
    labelField.appendChild(labelInput);

    var hrefField = document.createElement('div');
    hrefField.className = 'field';
    var hrefLab = document.createElement('label');
    hrefLab.textContent = 'Bağlantı';
    var hrefInput = document.createElement('input');
    hrefInput.type = 'text';
    hrefInput.maxLength = LIMITS.ctaHref;
    hrefInput.value = cta.href || '';
    hrefInput.dataset.ctaField = 'href';
    hrefInput.dataset.ctaIndex = String(index);
    hrefField.appendChild(hrefLab);
    hrefField.appendChild(hrefInput);

    var kindField = document.createElement('div');
    kindField.className = 'field';
    var kindLab = document.createElement('label');
    kindLab.textContent = 'Görünüm';
    var kindSelect = document.createElement('select');
    kindSelect.dataset.ctaField = 'kind';
    kindSelect.dataset.ctaIndex = String(index);
    [
      ['primary', 'Ana Buton'],
      ['secondary', 'İkincil Buton'],
      ['outline', 'Çerçeveli Buton']
    ].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      if ((cta.kind || 'primary') === opt[0]) o.selected = true;
      kindSelect.appendChild(o);
    });
    kindField.appendChild(kindLab);
    kindField.appendChild(kindSelect);

    var delWrap = document.createElement('div');
    delWrap.className = 'web-pages-cta-delete-wrap';
    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn';
    delBtn.textContent = 'Sil';
    delBtn.dataset.ctaAction = 'delete';
    delBtn.dataset.ctaIndex = String(index);
    delWrap.appendChild(delBtn);

    row.appendChild(labelField);
    row.appendChild(hrefField);
    row.appendChild(kindField);
    row.appendChild(delWrap);
    return row;
  }

  function syncCtasFromDom() {
    var host = $('web-pages-cta-host');
    if (!host) return;
    state.ctas.forEach(function (cta, index) {
      var labelEl = host.querySelector('[data-cta-field="label"][data-cta-index="' + index + '"]');
      var hrefEl = host.querySelector('[data-cta-field="href"][data-cta-index="' + index + '"]');
      var kindEl = host.querySelector('[data-cta-field="kind"][data-cta-index="' + index + '"]');
      if (labelEl) cta.label = labelEl.value;
      if (hrefEl) cta.href = hrefEl.value;
      if (kindEl) cta.kind = kindEl.value;
    });
  }

  function addCta() {
    if (hasUnknownData()) return;
    syncCtasFromDom();
    if (state.ctas.length >= MAX_CTA) return;
    state.ctas.push({ label: '', href: '', kind: 'primary' });
    markDirty();
    renderCtas();
  }

  function deleteCta(index) {
    syncCtasFromDom();
    state.ctas.splice(index, 1);
    markDirty();
    renderCtas();
  }

  function bindContent(content, unknown) {
    state.binding = true;
    try {
      var c = content || createEmptyContent();
      var title = $('web-pages-title');
      var subtitle = $('web-pages-subtitle');
      var seo = $('web-pages-seo-title');
      var meta = $('web-pages-meta-description');
      var disclaimer = $('web-pages-disclaimer');
      if (title) title.value = c.title || '';
      if (subtitle) subtitle.value = c.subtitle || '';
      if (seo) seo.value = c.seoTitle || '';
      if (meta) meta.value = c.metaDescription || '';
      if (disclaimer) disclaimer.value = c.disclaimer || '';
      updateSeoCounters();

      var converted = sectionsToBlocks(c.sections || []);
      state.blocks = converted.blocks;
      var allUnknown = (unknown || []).concat(converted.unknown || []);
      setUnknownWarning(allUnknown);
      renderBlocks();

      state.ctas = [];
      (Array.isArray(c.ctaButtons) ? c.ctaButtons : []).slice(0, MAX_CTA).forEach(function (btn) {
        if (!btn || typeof btn !== 'object') return;
        state.ctas.push({
          label: typeof btn.label === 'string' ? btn.label : '',
          href: typeof btn.href === 'string' ? btn.href : '',
          kind: CTA_KINDS.indexOf(btn.kind) >= 0 ? btn.kind : 'primary'
        });
      });
      renderCtas();
    } finally {
      state.binding = false;
      clearDirty();
    }
  }

  function collectCtas() {
    syncCtasFromDom();
    var out = [];
    state.ctas.forEach(function (cta) {
      var label = String(cta.label || '').trim();
      var href = String(cta.href || '').trim();
      var kind = CTA_KINDS.indexOf(cta.kind) >= 0 ? cta.kind : 'primary';
      if (!label && !href) return;
      out.push({ label: label, href: href, kind: kind });
    });
    return out;
  }

  function collectContent() {
    syncBlocksFromDom();
    return {
      title: String(($('web-pages-title') && $('web-pages-title').value) || '').trim(),
      subtitle: String(($('web-pages-subtitle') && $('web-pages-subtitle').value) || '').trim(),
      seoTitle: String(($('web-pages-seo-title') && $('web-pages-seo-title').value) || '').trim(),
      metaDescription: String(($('web-pages-meta-description') && $('web-pages-meta-description').value) || '').trim(),
      sections: blocksToSections(state.blocks),
      ctaButtons: collectCtas(),
      disclaimer: String(($('web-pages-disclaimer') && $('web-pages-disclaimer').value) || '').trim()
    };
  }

  function validateDraftStructure(doc) {
    if (!doc || typeof doc !== 'object') return 'Geçersiz belge.';
    if (PAGE_KEYS.indexOf(doc.pageKey) < 0) return 'Geçersiz pageKey.';
    if (doc.schemaVersion !== SCHEMA_VERSION) return 'schemaVersion 1 olmalı.';
    if (!doc.content || typeof doc.content !== 'object') return 'content eksik.';
    var c = doc.content;
    if (typeof c.title !== 'string' || c.title.length > LIMITS.title) return 'Sayfa başlığı geçersiz.';
    if (typeof c.subtitle !== 'string' || c.subtitle.length > LIMITS.subtitle) return 'Kısa tanıtım geçersiz.';
    if (typeof c.seoTitle !== 'string' || c.seoTitle.length > LIMITS.seoTitle) return 'SEO başlığı geçersiz.';
    if (typeof c.metaDescription !== 'string' || c.metaDescription.length > LIMITS.metaDescription) return 'Meta açıklaması geçersiz.';
    if (typeof c.disclaimer !== 'string' || c.disclaimer.length > LIMITS.disclaimer) return 'Bilgilendirme notu geçersiz.';
    if (containsHtmlRisk(c.title) || containsHtmlRisk(c.subtitle) || containsHtmlRisk(c.seoTitle) || containsHtmlRisk(c.metaDescription) || containsHtmlRisk(c.disclaimer)) {
      return 'HTML veya tehlikeli içerik kullanılamaz.';
    }
    if (!Array.isArray(c.sections)) return 'Bölüm listesi geçersiz.';
    var ids = {};
    for (var i = 0; i < c.sections.length; i++) {
      var sec = c.sections[i];
      if (!sec || typeof sec !== 'object') return 'Bölüm geçersiz.';
      if (typeof sec.id !== 'string' || !sec.id || sec.id.length > LIMITS.sectionId) return 'Bölüm kimliği geçersiz.';
      if (ids[sec.id]) return 'Bölüm kimlikleri benzersiz olmalı.';
      ids[sec.id] = true;
      if (sec.type !== 'text' && sec.type !== 'list') return 'Desteklenmeyen bölüm tipi.';
      var secErr = validateSectionFields(sec, false);
      if (secErr) return secErr;
    }
    return validateCtaButtons(c.ctaButtons);
  }

  function validateSectionFields(sec, strictMarkup) {
    if (typeof sec.heading !== 'string' || sec.heading.length > LIMITS.heading) return 'Başlık geçersiz.';
    if (containsHtmlRisk(sec.heading)) return 'HTML veya tehlikeli içerik kullanılamaz.';
    if (!Array.isArray(sec.paragraphs) || sec.paragraphs.length > LIMITS.maxParagraphs) return 'Paragraf listesi geçersiz.';
    if (!Array.isArray(sec.items) || sec.items.length > LIMITS.maxItems) return 'Madde listesi geçersiz.';
    for (var p = 0; p < sec.paragraphs.length; p++) {
      if (typeof sec.paragraphs[p] !== 'string' || sec.paragraphs[p].length > LIMITS.paragraph) return 'Paragraf geçersiz.';
      var soft = validateRestrictedMarkup(sec.paragraphs[p], !!strictMarkup);
      if (soft) return soft;
    }
    for (var it = 0; it < sec.items.length; it++) {
      if (typeof sec.items[it] !== 'string' || sec.items[it].length > LIMITS.item) return 'Madde geçersiz.';
      if (containsHtmlRisk(sec.items[it])) return 'HTML veya tehlikeli içerik kullanılamaz.';
    }
    return '';
  }

  function validateCtaButtons(ctaButtons) {
    if (!Array.isArray(ctaButtons) || ctaButtons.length > MAX_CTA) return 'Buton listesi geçersiz.';
    for (var b = 0; b < ctaButtons.length; b++) {
      var btn = ctaButtons[b];
      if (!btn || typeof btn !== 'object') return 'Buton geçersiz.';
      if (typeof btn.label !== 'string' || !btn.label.trim() || btn.label.length > LIMITS.ctaLabel) return 'Buton yazısı geçersiz.';
      if (typeof btn.href !== 'string' || !isSafeHref(btn.href)) return 'Buton bağlantısı geçersiz.';
      if (CTA_KINDS.indexOf(btn.kind) < 0) return 'Buton görünümü geçersiz.';
      if (containsHtmlRisk(btn.label)) return 'Buton yazısında HTML kullanılamaz.';
    }
    return '';
  }

  /** Lenient check for existing V1 stored docs (publish/restore reads). */
  function validateStoredDocument(doc, strictPublish) {
    if (!doc || typeof doc !== 'object') return 'Geçersiz belge.';
    if (PAGE_KEYS.indexOf(doc.pageKey) < 0) return 'Geçersiz pageKey.';
    if (doc.schemaVersion !== SCHEMA_VERSION) return 'schemaVersion 1 olmalı.';
    if (!doc.content || typeof doc.content !== 'object') return 'content eksik.';
    var c = doc.content;
    if (typeof c.title !== 'string' || c.title.length > LIMITS.title) return 'Sayfa başlığı geçersiz.';
    if (typeof c.subtitle !== 'string' || c.subtitle.length > LIMITS.subtitle) return 'Kısa tanıtım geçersiz.';
    if (typeof c.seoTitle !== 'string' || c.seoTitle.length > LIMITS.seoTitle) return 'SEO başlığı geçersiz.';
    if (typeof c.metaDescription !== 'string' || c.metaDescription.length > LIMITS.metaDescription) return 'Meta açıklaması geçersiz.';
    if (typeof c.disclaimer !== 'string' || c.disclaimer.length > LIMITS.disclaimer) return 'Bilgilendirme notu geçersiz.';
    if (containsHtmlRisk(c.title) || containsHtmlRisk(c.subtitle) || containsHtmlRisk(c.seoTitle) || containsHtmlRisk(c.metaDescription) || containsHtmlRisk(c.disclaimer)) {
      return 'HTML veya tehlikeli içerik kullanılamaz.';
    }
    if (!Array.isArray(c.sections)) return 'Bölüm listesi geçersiz.';
    var ids = {};
    for (var i = 0; i < c.sections.length; i++) {
      var sec = c.sections[i];
      if (!sec || typeof sec !== 'object') return 'Bölüm geçersiz.';
      if (typeof sec.id !== 'string' || !sec.id || sec.id.length > LIMITS.sectionId) return 'Bölüm kimliği geçersiz.';
      if (ids[sec.id]) return 'Bölüm kimlikleri benzersiz olmalı.';
      ids[sec.id] = true;
      if (!ALLOWED_SECTION_TYPES[sec.type]) {
        return 'Bu içerikte yeni editörün tanımadığı bir bölüm bulunuyor. Veri kaybını önlemek için kayıt ve yayın işlemleri durduruldu.';
      }
      if (sec.type === 'ctaGroup' || sec.type === 'disclaimer') continue;
      var secErr = validateSectionFields(sec, !!strictPublish);
      if (secErr) return secErr;
    }
    return validateCtaButtons(c.ctaButtons);
  }

  function hasMeaningfulBody(content) {
    var sections = content.sections || [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      if (!sec) continue;
      if (typeof sec.heading === 'string' && sec.heading.trim()) return true;
      if (Array.isArray(sec.paragraphs)) {
        for (var p = 0; p < sec.paragraphs.length; p++) {
          if (typeof sec.paragraphs[p] === 'string' && sec.paragraphs[p].trim()) return true;
        }
      }
      if (Array.isArray(sec.items)) {
        for (var it = 0; it < sec.items.length; it++) {
          if (typeof sec.items[it] === 'string' && sec.items[it].trim()) return true;
        }
      }
    }
    return false;
  }

  function hasParagraphOrItem(content) {
    var sections = content.sections || [];
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      if (!sec) continue;
      if (Array.isArray(sec.paragraphs)) {
        for (var p = 0; p < sec.paragraphs.length; p++) {
          if (typeof sec.paragraphs[p] === 'string' && sec.paragraphs[p].trim()) return true;
        }
      }
      if (Array.isArray(sec.items)) {
        for (var it = 0; it < sec.items.length; it++) {
          if (typeof sec.items[it] === 'string' && sec.items[it].trim()) return true;
        }
      }
    }
    return false;
  }

  function validatePublishContent(doc) {
    var base = validateStoredDocument(doc, true);
    if (base) return base;
    var c = doc.content;
    if (!c.title.trim()) return 'Yayın için sayfa başlığı zorunlu.';
    if (!c.seoTitle.trim()) {
      openSeoPanel();
      return 'Yayın için SEO başlığı zorunlu.';
    }
    if (!c.metaDescription.trim()) {
      openSeoPanel();
      return 'Yayın için meta açıklaması zorunlu.';
    }
    if (!hasMeaningfulBody(c) || !hasParagraphOrItem(c)) {
      return 'Yayın için en az bir anlamlı paragraf veya madde gerekli.';
    }
    return '';
  }

  function normalizeLoadedContent(raw, pageKey) {
    var empty = createEmptyContent();
    if (!raw || typeof raw !== 'object') return { content: empty, unknown: [] };
    empty.title = typeof raw.title === 'string' ? raw.title : '';
    empty.subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : '';
    empty.seoTitle = typeof raw.seoTitle === 'string' ? raw.seoTitle : '';
    empty.metaDescription = typeof raw.metaDescription === 'string' ? raw.metaDescription : '';
    empty.disclaimer = typeof raw.disclaimer === 'string' ? raw.disclaimer : '';
    empty.ctaButtons = Array.isArray(raw.ctaButtons) ? raw.ctaButtons.slice(0, MAX_CTA) : [];
    empty.sections = Array.isArray(raw.sections) ? raw.sections : [];
    return { content: empty, unknown: [] };
  }

  function loadPage(pageKey) {
    var db = getDb();
    if (!db || PAGE_KEYS.indexOf(pageKey) < 0) return Promise.resolve();
    var token = ++state.loadToken;
    var loading = $('web-pages-loading');
    if (loading) loading.hidden = false;
    setMsg('');
    setBusy(true);
    return Promise.all([draftRef(pageKey).get(), publishedRef(pageKey).get()]).then(function (pair) {
      if (token !== state.loadToken) return;
      var draftSnap = pair[0];
      var pubSnap = pair[1];
      state.draftMeta = draftSnap.exists ? {
        updatedAt: draftSnap.data().updatedAt || null,
        updatedBy: draftSnap.data().updatedBy || ''
      } : null;
      state.publishedMeta = pubSnap.exists ? {
        publishedAt: pubSnap.data().publishedAt || null,
        publishedBy: pubSnap.data().publishedBy || ''
      } : null;
      renderMeta();

      if (draftSnap.exists) {
        var data = draftSnap.data() || {};
        if (data.pageKey && data.pageKey !== pageKey) {
          setMsg('Taslak pageKey uyuşmazlığı.', true);
          bindContent(createEmptyContent(), []);
          return;
        }
        if (data.schemaVersion != null && data.schemaVersion !== SCHEMA_VERSION) {
          setMsg('Desteklenmeyen schemaVersion.', true);
          bindContent(createEmptyContent(), []);
          return;
        }
        var normalized = normalizeLoadedContent(data.content, pageKey);
        bindContent(normalized.content, normalized.unknown);
      } else {
        bindContent(createEmptyContent(), []);
        setMsg('Henüz taslak kaydedilmedi');
      }
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      setMsg((err && err.message) || 'Yükleme başarısız.', true);
      bindContent(createEmptyContent(), []);
    }).then(function () {
      if (token !== state.loadToken) return;
      if (loading) loading.hidden = true;
      setBusy(false);
    });
  }

  function openEditor(pageKey) {
    if (PAGE_KEYS.indexOf(pageKey) < 0) return;
    if (state.view === 'editor' && state.dirty && state.activePageKey && state.activePageKey !== pageKey) {
      if (!window.confirm('Kaydedilmemiş değişiklikler var. Devam edilsin mi?')) return;
    }
    state.activePageKey = pageKey;
    var heading = $('web-pages-editor-heading');
    if (heading) heading.textContent = PAGE_LABELS[pageKey] || pageKey;
    showEditorView();
    loadPage(pageKey);
  }

  function goHome() {
    if (state.dirty) {
      if (!window.confirm('Kaydedilmemiş değişiklikler var. Web Sayfalarına dönülsün mü?')) return false;
    }
    clearDirty();
    showHomeView();
    setMsg('');
    refreshHomeCardStatuses();
    return true;
  }

  function saveDraft() {
    if (hasUnknownData()) {
      setMsg('Tanımsız bölüm nedeniyle kayıt durduruldu.', true);
      return Promise.resolve();
    }
    var pageKey = state.activePageKey;
    var db = getDb();
    var uid = getUid();
    if (!pageKey || !db) return Promise.resolve();
    if (!uid) {
      setMsg('Oturum gerekli.', true);
      return Promise.resolve();
    }
    var content = collectContent();
    var doc = {
      pageKey: pageKey,
      schemaVersion: SCHEMA_VERSION,
      content: content,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid
    };
    var err = validateDraftStructure(doc);
    if (err) {
      if (err.indexOf('SEO') >= 0 || err.indexOf('Meta') >= 0 || err.indexOf('seo') >= 0 || err.indexOf('meta') >= 0) openSeoPanel();
      setMsg(err, true);
      return Promise.resolve();
    }
    setBusy(true);
    setMsg('Kaydediliyor…');
    return draftRef(pageKey).set(doc).then(function () {
      clearDirty();
      setMsg('Taslak kaydedildi.');
      return loadPage(pageKey).then(function () {
        refreshHomeCardStatuses();
      });
    }).catch(function (e) {
      setMsg((e && e.message) || 'Kayıt başarısız.', true);
    }).then(function () {
      setBusy(false);
    });
  }

  function publishDraft() {
    if (hasUnknownData()) {
      setMsg('Tanımsız bölüm nedeniyle yayın durduruldu.', true);
      return Promise.resolve();
    }
    var pageKey = state.activePageKey;
    var db = getDb();
    var uid = getUid();
    if (!pageKey || !db) return Promise.resolve();
    if (!uid) {
      setMsg('Oturum gerekli.', true);
      return Promise.resolve();
    }
    if (state.dirty) {
      setMsg('Önce mevcut değişiklikleri taslak olarak kaydedin.', true);
      return Promise.resolve();
    }
    if (!window.confirm('Taslak yayımlansın mı?')) return Promise.resolve();
    setBusy(true);
    setMsg('Yayımlanıyor…');
    return draftRef(pageKey).get().then(function (snap) {
      if (!snap.exists) throw new Error('Yayımlanacak taslak bulunamadı.');
      var data = snap.data() || {};
      var docCheck = {
        pageKey: data.pageKey,
        schemaVersion: data.schemaVersion,
        content: data.content
      };
      var err = validatePublishContent(docCheck);
      if (err) {
        if (err.indexOf('SEO') >= 0 || err.indexOf('meta') >= 0 || err.indexOf('Meta') >= 0) {
          openSeoPanel();
          var seoEl = !docCheck.content.seoTitle ? $('web-pages-seo-title') : $('web-pages-meta-description');
          if (seoEl && typeof seoEl.focus === 'function') seoEl.focus();
        }
        throw new Error(err);
      }
      var publishedDoc = {
        pageKey: data.pageKey,
        schemaVersion: data.schemaVersion,
        content: data.content,
        publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
        publishedBy: uid,
        sourceUpdatedAt: data.updatedAt || null,
        sourceUpdatedBy: data.updatedBy || ''
      };
      return publishedRef(pageKey).set(publishedDoc);
    }).then(function () {
      setMsg('Yayınlandı.');
      return loadPage(pageKey).then(function () {
        refreshHomeCardStatuses();
      });
    }).catch(function (e) {
      setMsg((e && e.message) || 'Yayın başarısız.', true);
    }).then(function () {
      setBusy(false);
    });
  }

  function restorePublished() {
    var pageKey = state.activePageKey;
    var db = getDb();
    var uid = getUid();
    if (!pageKey || !db) return Promise.resolve();
    if (!uid) {
      setMsg('Oturum gerekli.', true);
      return Promise.resolve();
    }
    var confirmMsg = 'Yayımdaki içerik taslağın üzerine yazılacak. Devam edilsin mi?';
    if (hasUnknownData()) {
      confirmMsg = 'Mevcut taslakta tanınmayan bölümler var. Geri yükleme bu taslağı yayımlanan içerikle değiştirecek. Devam edilsin mi?';
    }
    if (!window.confirm(confirmMsg)) return Promise.resolve();
    setBusy(true);
    setMsg('Geri yükleniyor…');
    return publishedRef(pageKey).get().then(function (snap) {
      if (!snap.exists) throw new Error('Yayımlanmış içerik bulunamadı.');
      var data = snap.data() || {};
      var docCheck = {
        pageKey: data.pageKey,
        schemaVersion: data.schemaVersion,
        content: data.content
      };
      var err = validateStoredDocument(docCheck, false);
      if (err) throw new Error('Yayımlanmış içerik yapısal olarak geçersiz: ' + err);
      var draftDoc = {
        pageKey: data.pageKey,
        schemaVersion: data.schemaVersion,
        content: data.content,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid
      };
      return draftRef(pageKey).set(draftDoc);
    }).then(function () {
      setMsg('Yayımdaki içerik taslağa yüklendi.');
      return loadPage(pageKey).then(function () {
        refreshHomeCardStatuses();
      });
    }).catch(function (e) {
      setMsg((e && e.message) || 'Geri yükleme başarısız.', true);
    }).then(function () {
      setBusy(false);
    });
  }

  function applyFormat(action) {
    var el = state.lastFocusedFormatField;
    if (!el || !el.isConnected || el.dataset.formatTarget !== '1') return;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    if (typeof start !== 'number' || typeof end !== 'number') return;
    var value = el.value || '';
    var selected = value.slice(start, end);
    var before = value.slice(0, start);
    var after = value.slice(end);
    var next = value;
    var selStart = start;
    var selEnd = end;

    if (action === 'bold') {
      next = before + '**' + (selected || 'metin') + '**' + after;
      selStart = start + 2;
      selEnd = selStart + (selected || 'metin').length;
    } else if (action === 'italic') {
      next = before + '*' + (selected || 'metin') + '*' + after;
      selStart = start + 1;
      selEnd = selStart + (selected || 'metin').length;
    } else if (action === 'cyan') {
      next = before + '[cyan]' + (selected || 'metin') + '[/cyan]' + after;
      selStart = start + 6;
      selEnd = selStart + (selected || 'metin').length;
    } else if (action === 'gold') {
      next = before + '[gold]' + (selected || 'metin') + '[/gold]' + after;
      selStart = start + 6;
      selEnd = selStart + (selected || 'metin').length;
    } else if (action === 'link') {
      var url = window.prompt('Bağlantı adresi (/…, https:// veya mailto:)');
      if (url == null) return;
      url = String(url).trim();
      if (!isSafeHref(url)) {
        setMsg('Bağlantı adresi geçersiz veya güvenli değil.', true);
        return;
      }
      var label = selected || 'bağlantı metni';
      next = before + '[' + label + '](' + url + ')' + after;
      selStart = start + 1;
      selEnd = selStart + label.length;
    } else if (action === 'clear') {
      var cleaned = stripRestrictedTokens(selected || value);
      if (selected) {
        next = before + cleaned + after;
        selStart = start;
        selEnd = start + cleaned.length;
      } else {
        next = cleaned;
        selStart = 0;
        selEnd = cleaned.length;
      }
    } else {
      return;
    }

    el.value = next;
    markDirty();
    syncBlocksFromDom();
    try {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    } catch (e) {}
  }

  function onRootInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'web-pages-seo-title' || t.id === 'web-pages-meta-description') updateSeoCounters();
    if (t.dataset && (t.dataset.blockField || t.dataset.ctaField)) {
      markDirty();
      return;
    }
    if (t.id === 'web-pages-title' || t.id === 'web-pages-subtitle' || t.id === 'web-pages-seo-title' || t.id === 'web-pages-meta-description' || t.id === 'web-pages-disclaimer') {
      markDirty();
    }
  }

  function onRootChange(e) {
    var t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.blockField || t.dataset.ctaField) markDirty();
  }

  function onRootFocusIn(e) {
    var t = e.target;
    if (t && t.dataset && t.dataset.formatTarget === '1') {
      state.lastFocusedFormatField = t;
    }
  }

  function onRootClick(e) {
    var t = e.target;
    if (!t) return;
    var card = t.closest ? t.closest('[data-web-page-card]') : null;
    var editBtn = t.closest ? t.closest('[data-web-page-edit]') : null;
    if (editBtn && editBtn.getAttribute('data-web-page-edit')) {
      e.preventDefault();
      openEditor(editBtn.getAttribute('data-web-page-edit'));
      return;
    }
    if (card && card.getAttribute('data-web-page-card') && !(t.closest && t.closest('button'))) {
      openEditor(card.getAttribute('data-web-page-card'));
      return;
    }

    var addBlock = t.closest ? t.closest('[data-web-pages-add-block]') : null;
    if (addBlock) {
      addBlockFn(addBlock.getAttribute('data-web-pages-add-block'));
      return;
    }
    var formatBtn = t.closest ? t.closest('[data-web-pages-format]') : null;
    if (formatBtn) {
      applyFormat(formatBtn.getAttribute('data-web-pages-format'));
      return;
    }
    var blockAction = t.closest ? t.closest('[data-block-action]') : null;
    if (blockAction) {
      var bi = parseInt(blockAction.getAttribute('data-block-index'), 10);
      var action = blockAction.getAttribute('data-block-action');
      if (action === 'up') moveBlock(bi, -1);
      else if (action === 'down') moveBlock(bi, 1);
      else if (action === 'delete') deleteBlock(bi);
      return;
    }
    var ctaAction = t.closest ? t.closest('[data-cta-action]') : null;
    if (ctaAction && ctaAction.getAttribute('data-cta-action') === 'delete') {
      deleteCta(parseInt(ctaAction.getAttribute('data-cta-index'), 10));
    }
  }

  function addBlockFn(kind) {
    if (kind === 'heading' || kind === 'paragraph' || kind === 'list' || kind === 'accent') addBlock(kind);
  }

  function canLeave(targetPage) {
    if (targetPage === 'web-pages') return true;
    if (!isDirty()) return true;
    return window.confirm('Kaydedilmemiş Web Sayfaları değişiklikleri var. Sayfadan çıkılsın mı?');
  }

  function onShow() {
    if (state.view !== 'editor') {
      showHomeView();
      refreshHomeCardStatuses();
    } else if (state.activePageKey) {
      refreshHomeCardStatuses();
    } else {
      showHomeView();
      refreshHomeCardStatuses();
    }
  }

  function onBeforeUnload(e) {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  }

  function init() {
    var root = $('admin-page-web-pages');
    if (!root || root.dataset.webPagesBound === '1') return;
    root.dataset.webPagesBound = '1';

    root.addEventListener('input', onRootInput);
    root.addEventListener('change', onRootChange);
    root.addEventListener('focusin', onRootFocusIn);
    root.addEventListener('click', onRootClick);

    var back = $('web-pages-back-btn');
    if (back) back.addEventListener('click', function () { goHome(); });
    var save = $('btn-web-pages-save');
    if (save) save.addEventListener('click', function () { saveDraft(); });
    var pub = $('btn-web-pages-publish');
    if (pub) pub.addEventListener('click', function () { publishDraft(); });
    var restore = $('btn-web-pages-restore');
    if (restore) restore.addEventListener('click', function () { restorePublished(); });
    var ctaAdd = $('web-pages-cta-add');
    if (ctaAdd) ctaAdd.addEventListener('click', function () { addCta(); });

    window.addEventListener('beforeunload', onBeforeUnload);
    showHomeView();
  }

  window.AdminWebPages = {
    init: init,
    onShow: onShow,
    canLeave: canLeave,
    isDirty: isDirty
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * Public site content renderer — schemaVersion 1
 * Reads only siteContent/{pageKey}/published/current
 * No Auth observer, no onSnapshot, no draft reads, no writes.
 */
(function () {
  'use strict';

  var SCHEMA_VERSION = 1;
  var CTA_KINDS = { primary: true, secondary: true, outline: true };
  var SECTION_TYPES = {
    hero: true,
    text: true,
    list: true,
    benefits: true,
    ctaGroup: true,
    disclaimer: true
  };

  var PAGE_PATHS = {
    about: { pageKey: 'about', collectionId: 'about' },
    services: { pageKey: 'services', collectionId: 'services' }
  };

  function getDb() {
    var api = window.SA_WEB_FIREBASE;
    if (!api || !api.ready || !api.db) return null;
    return api.db;
  }

  function isSafeHref(href) {
    if (typeof href !== 'string') return false;
    var h = href.trim();
    if (!h || h.length > 500) return false;
    var lower = h.toLowerCase();
    if (lower.indexOf('javascript:') === 0) return false;
    if (lower.indexOf('data:') === 0) return false;
    if (lower.indexOf('vbscript:') === 0) return false;
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

  function clearNode(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function appendText(parent, text) {
    parent.appendChild(document.createTextNode(String(text == null ? '' : text)));
  }

  /** Nested-safe-ish linear token parse into DOM (no innerHTML). */
  function renderInlineTokens(container, raw, allowAccent) {
    if (typeof raw !== 'string') {
      appendText(container, '');
      return;
    }
    if (containsHtmlRisk(raw)) {
      appendText(container, raw.replace(/<[^>]*>/g, ''));
      return;
    }

    var s = raw;
    var i = 0;
    var len = s.length;
    var allow = allowAccent !== false;

    while (i < len) {
      if (allow && s.slice(i, i + 6).toLowerCase() === '[cyan]') {
        i += 6;
        var cEnd = s.toLowerCase().indexOf('[/cyan]', i);
        var cText = cEnd >= 0 ? s.slice(i, cEnd) : s.slice(i);
        var cSpan = document.createElement('span');
        cSpan.className = 'site-content-accent site-content-accent--cyan';
        renderInlineTokens(cSpan, cText, false);
        container.appendChild(cSpan);
        i = cEnd >= 0 ? cEnd + 7 : len;
        continue;
      }
      if (allow && s.slice(i, i + 6).toLowerCase() === '[gold]') {
        i += 6;
        var gEnd = s.toLowerCase().indexOf('[/gold]', i);
        var gText = gEnd >= 0 ? s.slice(i, gEnd) : s.slice(i);
        var gSpan = document.createElement('span');
        gSpan.className = 'site-content-accent site-content-accent--gold';
        renderInlineTokens(gSpan, gText, false);
        container.appendChild(gSpan);
        i = gEnd >= 0 ? gEnd + 7 : len;
        continue;
      }

      var lm = s.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (lm) {
        i += lm[0].length;
        if (isSafeHref(lm[2]) && !containsHtmlRisk(lm[1])) {
          var link = document.createElement('a');
          link.href = lm[2].trim();
          link.className = 'site-content-inline-link';
          appendText(link, lm[1]);
          container.appendChild(link);
        } else {
          appendText(container, lm[0]);
        }
        continue;
      }

      if (s.charAt(i) === '*' && s.charAt(i + 1) === '*') {
        i += 2;
        var bEnd = s.indexOf('**', i);
        var bText = bEnd >= 0 ? s.slice(i, bEnd) : s.slice(i);
        var bEl = document.createElement('strong');
        appendText(bEl, bText);
        container.appendChild(bEl);
        i = bEnd >= 0 ? bEnd + 2 : len;
        continue;
      }

      if (s.charAt(i) === '*') {
        i += 1;
        var eEnd = s.indexOf('*', i);
        var eText = eEnd >= 0 ? s.slice(i, eEnd) : s.slice(i);
        var eEl = document.createElement('em');
        appendText(eEl, eText);
        container.appendChild(eEl);
        i = eEnd >= 0 ? eEnd + 1 : len;
        continue;
      }

      appendText(container, s.charAt(i));
      i += 1;
    }
  }

  function validateDocument(data, expectedPageKey) {
    if (!data || typeof data !== 'object') return 'Belge geçersiz.';
    if (data.pageKey !== expectedPageKey) return 'pageKey uyuşmazlığı.';
    if (data.schemaVersion !== SCHEMA_VERSION) return 'schemaVersion desteklenmiyor.';
    if (!data.content || typeof data.content !== 'object') return 'content eksik.';
    var c = data.content;
    if (typeof c.title !== 'string') return 'title geçersiz.';
    if (typeof c.subtitle !== 'string') return 'subtitle geçersiz.';
    if (!Array.isArray(c.sections)) return 'sections geçersiz.';
    if (!Array.isArray(c.ctaButtons)) return 'ctaButtons geçersiz.';
    if (typeof c.disclaimer !== 'string') return 'disclaimer geçersiz.';
    if (containsHtmlRisk(c.title) || containsHtmlRisk(c.subtitle) || containsHtmlRisk(c.disclaimer)) {
      return 'Güvenli olmayan içerik.';
    }
    if (typeof c.seoTitle === 'string' && containsHtmlRisk(c.seoTitle)) return 'seoTitle geçersiz.';
    if (typeof c.metaDescription === 'string' && containsHtmlRisk(c.metaDescription)) return 'metaDescription geçersiz.';
    return '';
  }

  function setStatus(el, text, isError) {
    if (!el) return;
    el.textContent = text || '';
    if (isError) el.setAttribute('data-state', 'error');
    else if (text) el.setAttribute('data-state', 'loading');
    else {
      el.removeAttribute('data-state');
      el.hidden = true;
      return;
    }
    el.hidden = false;
  }

  function updateSeo(content) {
    if (content.seoTitle && String(content.seoTitle).trim()) {
      document.title = String(content.seoTitle).trim();
    }
    if (content.metaDescription && String(content.metaDescription).trim()) {
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', String(content.metaDescription).trim());
    }
  }

  function renderCtas(host, buttons) {
    var list = Array.isArray(buttons) ? buttons : [];
    var wrap = document.createElement('div');
    wrap.className = 'site-content-ctas';
    var count = 0;
    list.forEach(function (btn) {
      if (!btn || typeof btn !== 'object') return;
      var label = typeof btn.label === 'string' ? btn.label.trim() : '';
      var href = typeof btn.href === 'string' ? btn.href.trim() : '';
      var kind = typeof btn.kind === 'string' ? btn.kind : 'primary';
      if (!label || !isSafeHref(href) || containsHtmlRisk(label)) return;
      if (!CTA_KINDS[kind]) kind = 'primary';
      var a = document.createElement('a');
      a.href = href;
      a.className = 'site-content-cta site-content-cta--' + kind;
      appendText(a, label);
      wrap.appendChild(a);
      count += 1;
    });
    if (count) host.appendChild(wrap);
  }

  function renderSection(host, sec) {
    if (!sec || typeof sec !== 'object') return;
    var type = String(sec.type || '');
    if (!SECTION_TYPES[type]) return;
    if (type === 'ctaGroup' || type === 'disclaimer') return;

    var heading = typeof sec.heading === 'string' ? sec.heading.trim() : '';
    var paragraphs = Array.isArray(sec.paragraphs) ? sec.paragraphs : [];
    var items = Array.isArray(sec.items) ? sec.items : [];

    var hasBody = false;
    paragraphs.forEach(function (p) {
      if (typeof p === 'string' && p.trim()) hasBody = true;
    });
    items.forEach(function (it) {
      if (typeof it === 'string' && it.trim()) hasBody = true;
    });
    if (!heading && !hasBody) return;

    var section = document.createElement('section');
    section.className = 'site-content-section';

    if (heading && !containsHtmlRisk(heading)) {
      var h2 = document.createElement('h2');
      h2.className = 'site-content-heading';
      appendText(h2, heading);
      section.appendChild(h2);
    }

    paragraphs.forEach(function (p) {
      if (typeof p !== 'string') return;
      var t = p.trim();
      if (!t) return;
      var pEl = document.createElement('p');
      pEl.className = 'site-content-paragraph';
      renderInlineTokens(pEl, t, true);
      section.appendChild(pEl);
    });

    var cleanItems = [];
    items.forEach(function (it) {
      if (typeof it === 'string' && it.trim() && !containsHtmlRisk(it)) cleanItems.push(it.trim());
    });
    if (cleanItems.length) {
      var ul = document.createElement('ul');
      ul.className = 'site-content-list';
      cleanItems.forEach(function (it) {
        var li = document.createElement('li');
        renderInlineTokens(li, it, true);
        ul.appendChild(li);
      });
      section.appendChild(ul);
    }

    if (section.childNodes.length) host.appendChild(section);
  }

  function renderContent(root, content) {
    clearNode(root);

    var article = document.createElement('article');
    article.className = 'site-content-article';

    var title = typeof content.title === 'string' ? content.title.trim() : '';
    if (title) {
      var h1 = document.createElement('h1');
      h1.className = 'site-content-title';
      appendText(h1, title);
      article.appendChild(h1);
    }

    var subtitle = typeof content.subtitle === 'string' ? content.subtitle.trim() : '';
    if (subtitle) {
      var lead = document.createElement('p');
      lead.className = 'site-content-lead';
      appendText(lead, subtitle);
      article.appendChild(lead);
    }

    (content.sections || []).forEach(function (sec) {
      renderSection(article, sec);
    });

    renderCtas(article, content.ctaButtons);

    var disclaimer = typeof content.disclaimer === 'string' ? content.disclaimer.trim() : '';
    if (disclaimer) {
      var note = document.createElement('aside');
      note.className = 'site-content-disclaimer';
      var noteP = document.createElement('p');
      appendText(noteP, disclaimer);
      note.appendChild(noteP);
      article.appendChild(note);
    }

    root.appendChild(article);
  }

  function loadPublished(pageKey) {
    var cfg = PAGE_PATHS[pageKey];
    if (!cfg) return;

    var root = document.getElementById('site-content-root');
    var status = document.getElementById('site-content-status');
    if (!root) return;

    var db = getDb();
    if (!db) {
      setStatus(status, 'Güncel içerik şu an yüklenemedi.', true);
      return;
    }

    setStatus(status, 'İçerik güncelleniyor…', false);

    db.collection('siteContent')
      .doc(cfg.collectionId)
      .collection('published')
      .doc('current')
      .get()
      .then(function (snap) {
        if (!snap.exists) {
          setStatus(status, 'Güncel içerik şu an yüklenemedi.', true);
          return;
        }
        var data = snap.data() || {};
        var err = validateDocument(data, cfg.pageKey);
        if (err) {
          setStatus(status, 'Güncel içerik şu an yüklenemedi.', true);
          return;
        }
        renderContent(root, data.content);
        updateSeo(data.content);
        setStatus(status, '', false);
      })
      .catch(function () {
        setStatus(status, 'Güncel içerik şu an yüklenemedi.', true);
      });
  }

  function init() {
    var host = document.body || document.documentElement;
    var pageKey = host && host.getAttribute('data-site-page');
    if (!pageKey || !PAGE_PATHS[pageKey]) return;
    loadPublished(pageKey);
  }

  window.SA_SITE_CONTENT = {
    init: init,
    loadPublished: loadPublished
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

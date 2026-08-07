/**
 * Tenant logo resolution for student web (W3.1).
 * Paths are relative to /app/*.html (../assets/...).
 */
(function () {
  'use strict';

  var DEFAULT_BRAND_TENANT_ID = 'surucu_akademisi';
  var LOGO_FIELDS = ['logoUrl', 'logo', 'logoPath', 'logoFile'];

  function pickLogoRawFromTenant(tenantData) {
    if (!tenantData || typeof tenantData !== 'object') return '';
    for (var i = 0; i < LOGO_FIELDS.length; i++) {
      var v = tenantData[LOGO_FIELDS[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  function resolveWebTenantLogoUrl(tenantId, tenantData) {
    var raw = pickLogoRawFromTenant(tenantData);
    if (raw) {
      if (/^https?:\/\//i.test(raw)) return raw;
      var normalized = raw.replace(/^\/+/, '').replace(/^\.\/+/, '');
      normalized = normalized.replace(/^mobile_app\/src\//i, '');
      normalized = normalized.replace(/^src\//i, '');
      if (/^assets\//i.test(normalized)) return '../' + normalized;
      if (/^tenant-logos\//i.test(normalized)) return '../assets/' + normalized;
      return '../' + normalized;
    }
    var tid = String(tenantId || '').trim();
    if (tid) return '../assets/tenant-logos/' + tid + '.png';
    return '../assets/tenant-logos/' + DEFAULT_BRAND_TENANT_ID + '.png';
  }

  function getTenantMonogramInitial(tenantName, tenantId) {
    var name = String(tenantName || '').trim();
    if (name) return name.charAt(0).toLocaleUpperCase('tr-TR');
    var id = String(tenantId || '').trim();
    if (id) return id.charAt(0).toLocaleUpperCase('tr-TR');
    return 'K';
  }

  function showMonogram(monogramEl, initial) {
    if (!monogramEl) return;
    monogramEl.textContent = initial || 'K';
    monogramEl.hidden = false;
    monogramEl.style.display = '';
  }

  function hideMonogram(monogramEl) {
    if (!monogramEl) return;
    monogramEl.hidden = true;
    monogramEl.style.display = 'none';
  }

  function hideLogo(imgEl) {
    if (!imgEl) return;
    imgEl.hidden = true;
    imgEl.style.display = 'none';
    imgEl.removeAttribute('src');
  }

  /**
   * Apply logo or monogram to header elements.
   * @param {HTMLImageElement|null} imgEl
   * @param {HTMLElement|null} monogramEl
   * @param {{ tenantId?: string, tenantName?: string, tenantLogoUrl?: string, showInstitutionLogo?: boolean }} session
   */
  function applyHeaderBranding(imgEl, monogramEl, session) {
    var s = session || {};
    var tenantName = s.tenantName || s.tenantId || 'Kurum';
    var tenantId = s.tenantId || '';
    var showLogo = s.showInstitutionLogo !== false;
    var initial = getTenantMonogramInitial(tenantName, tenantId);

    if (imgEl) {
      imgEl.alt = tenantName + ' logosu';
    }

    if (!showLogo) {
      hideLogo(imgEl);
      hideMonogram(monogramEl);
      return;
    }

    var candidates = [];
    if (s.tenantLogoUrl) candidates.push(String(s.tenantLogoUrl));
    if (tenantId) {
      var resolved = resolveWebTenantLogoUrl(tenantId, {
        logoUrl: s.tenantLogoUrl,
        logo: s.tenantLogoUrl
      });
      if (resolved) candidates.push(resolved);
      candidates.push('../assets/tenant-logos/' + tenantId + '.png');
    }
    candidates.push('../assets/tenant-logos/' + DEFAULT_BRAND_TENANT_ID + '.png');

    var seen = {};
    candidates = candidates.filter(function (url) {
      if (!url || seen[url]) return false;
      seen[url] = true;
      return true;
    });

    if (!imgEl || !candidates.length) {
      hideLogo(imgEl);
      showMonogram(monogramEl, initial);
      return;
    }

    hideMonogram(monogramEl);
    var index = 0;

    function tryNext() {
      if (index >= candidates.length) {
        hideLogo(imgEl);
        showMonogram(monogramEl, initial);
        return;
      }
      var url = candidates[index++];
      imgEl.onload = function () {
        imgEl.hidden = false;
        imgEl.style.display = '';
        hideMonogram(monogramEl);
      };
      imgEl.onerror = function () {
        tryNext();
      };
      imgEl.src = url;
    }

    tryNext();
  }

  window.SA_WEB_TENANT_BRAND = {
    DEFAULT_BRAND_TENANT_ID: DEFAULT_BRAND_TENANT_ID,
    pickLogoRawFromTenant: pickLogoRawFromTenant,
    resolveWebTenantLogoUrl: resolveWebTenantLogoUrl,
    getTenantMonogramInitial: getTenantMonogramInitial,
    applyHeaderBranding: applyHeaderBranding
  };
})();

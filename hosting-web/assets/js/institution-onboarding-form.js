/**
 * Kurumsal Başvuru → createInstitutionOnboardingDraft callable.
 * Logo bytes sent for Admin SDK staging upload only.
 * No direct Firestore/Storage client writes. No payment / tenant / Auth side effects.
 */
(function () {
  'use strict';

  var NOTICE_VERSION = 'contact-v1';
  var LOGO_MAX_BYTES = 2 * 1024 * 1024;
  var LOGO_ALLOWED_TYPES = {
    'image/png': true,
    'image/jpeg': true,
    'image/webp': true
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function setStatus(el, message, kind) {
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
    if (message && kind) el.setAttribute('data-state', kind);
    else el.removeAttribute('data-state');
  }

  function getFunctions() {
    if (typeof firebase === 'undefined' || !firebase.functions) return null;
    try {
      return firebase.app().functions();
    } catch (e) {
      return null;
    }
  }

  function clientErrorMessage(err) {
    var msg = err && err.message ? String(err.message) : '';
    if (
      msg.indexOf('Lütfen PNG') !== -1 ||
      msg.indexOf('Logo dosyası') !== -1 ||
      msg.indexOf('logo') !== -1 ||
      msg.indexOf('Logo') !== -1
    ) {
      return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || msg;
    }
    var code = err && err.code ? String(err.code) : '';
    if (code.indexOf('resource-exhausted') !== -1) {
      return 'Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.';
    }
    if (code.indexOf('invalid-argument') !== -1) {
      return 'Lütfen form alanlarını kontrol edin ve zorunlu bilgileri eksiksiz doldurun.';
    }
    if (code.indexOf('unavailable') !== -1 || code.indexOf('internal') !== -1) {
      return 'İşlem şu anda tamamlanamadı. Lütfen kısa süre sonra tekrar deneyin.';
    }
    return 'Başvurunuz gönderilemedi. Lütfen tekrar deneyin.';
  }

  function validateLogoFile(file) {
    if (!file) {
      return { ok: false, message: 'Lütfen kurum logosunu seçin.' };
    }
    var type = String(file.type || '').toLowerCase();
    if (!LOGO_ALLOWED_TYPES[type]) {
      return { ok: false, message: 'Lütfen PNG, JPG veya WEBP formatında bir logo seçin.' };
    }
    if (file.size > LOGO_MAX_BYTES) {
      return { ok: false, message: 'Logo dosyası en fazla 2 MB olabilir.' };
    }
    return { ok: true };
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = typeof reader.result === 'string' ? reader.result : '';
        var comma = result.indexOf(',');
        var base64 = comma >= 0 ? result.slice(comma + 1) : result;
        if (!base64) {
          reject(new Error('Logo okunamadı.'));
          return;
        }
        resolve(base64);
      };
      reader.onerror = function () {
        reject(new Error('Logo okunamadı.'));
      };
      reader.readAsDataURL(file);
    });
  }

  function bindLogoUpload(form) {
    var wrap = form.querySelector('[data-inst-logo-upload]');
    var input = form.querySelector('#inst-logo');
    var preview = form.querySelector('#inst-logo-preview');
    var placeholder = form.querySelector('#inst-logo-placeholder');
    var fileNameEl = form.querySelector('#inst-logo-file-name');
    var objectUrl = null;
    var selectedFile = null;

    function clearPreview() {
      selectedFile = null;
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (e) {}
        objectUrl = null;
      }
      if (preview) {
        preview.hidden = true;
        preview.removeAttribute('src');
        preview.alt = '';
      }
      if (placeholder) placeholder.hidden = false;
      if (wrap) wrap.classList.remove('is-selected');
      if (fileNameEl) fileNameEl.textContent = 'Henüz dosya seçilmedi';
    }

    function applyFile(file) {
      var check = validateLogoFile(file);
      if (!check.ok) {
        if (input) input.value = '';
        clearPreview();
        return check;
      }
      selectedFile = file;
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (e) {}
      }
      objectUrl = URL.createObjectURL(file);
      if (preview) {
        preview.src = objectUrl;
        preview.alt = 'Seçilen kurum logosu önizlemesi';
        preview.hidden = false;
      }
      if (placeholder) placeholder.hidden = true;
      if (wrap) wrap.classList.add('is-selected');
      if (fileNameEl) fileNameEl.textContent = String(file.name || 'logo');
      return { ok: true };
    }

    if (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0] ? input.files[0] : null;
        if (!file) {
          clearPreview();
          return;
        }
        var result = applyFile(file);
        if (!result.ok) {
          var statusEl = $('#institution-form-status', form) || $('#institution-form-status');
          setStatus(statusEl, result.message, 'error');
        }
      });
    }

    return {
      getSelectedFile: function () {
        return selectedFile;
      },
      clear: clearPreview,
      validate: function () {
        return validateLogoFile(selectedFile);
      }
    };
  }

  function bindInstitutionOnboardingForm(form) {
    var statusEl = $('#institution-form-status', form) || $('#institution-form-status');
    var submitBtn = form.querySelector('[type="submit"]');
    var logoCtl = bindLogoUpload(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.getAttribute('data-submitting') === '1') return;

      var institutionName = String((form.institutionName && form.institutionName.value) || '').trim();
      var authorizedPersonName = String(
        (form.authorizedPersonName && form.authorizedPersonName.value) || ''
      ).trim();
      var authorizedPersonTitle = String(
        (form.authorizedPersonTitle && form.authorizedPersonTitle.value) || ''
      ).trim();
      var email = String((form.email && form.email.value) || '').trim();
      var phone = String((form.phone && form.phone.value) || '').trim();
      var city = String((form.city && form.city.value) || '').trim();
      var district = String((form.district && form.district.value) || '').trim();
      var fullAddress = String((form.fullAddress && form.fullAddress.value) || '').trim();
      var interestedProgram = String(
        (form.interestedProgram && form.interestedProgram.value) || ''
      ).trim();
      var estimatedRaw = String(
        (form.estimatedStudentCount && form.estimatedStudentCount.value) || ''
      ).trim();
      var message = String((form.message && form.message.value) || '').trim();
      var notice = form.noticeAcknowledged && form.noticeAcknowledged.checked === true;
      var website = String((form.website && form.website.value) || '');
      var logoCheck = logoCtl.validate();
      var logoFile = logoCtl.getSelectedFile();

      if (!institutionName) {
        setStatus(statusEl, 'Lütfen kurum adını girin.', 'error');
        return;
      }
      if (!logoCheck.ok) {
        setStatus(statusEl, logoCheck.message, 'error');
        return;
      }
      if (authorizedPersonName.length < 2) {
        setStatus(statusEl, 'Lütfen yetkili ad soyad girin.', 'error');
        return;
      }
      if (!email || email.indexOf('@') === -1) {
        setStatus(statusEl, 'Lütfen geçerli bir e-posta girin.', 'error');
        return;
      }
      if (!phone) {
        setStatus(statusEl, 'Lütfen telefon numarası girin.', 'error');
        return;
      }
      if (!city) {
        setStatus(statusEl, 'Lütfen il girin.', 'error');
        return;
      }
      if (!district) {
        setStatus(statusEl, 'Lütfen ilçe girin.', 'error');
        return;
      }
      if (fullAddress.length < 5) {
        setStatus(statusEl, 'Lütfen açık adresi girin.', 'error');
        return;
      }
      if (
        interestedProgram !== 'driving_license' &&
        interestedProgram !== 'machine_operator' &&
        interestedProgram !== 'both'
      ) {
        setStatus(statusEl, 'Lütfen ilgilenilen programı seçin.', 'error');
        return;
      }
      if (estimatedRaw && !/^\d{1,6}$/.test(estimatedRaw)) {
        setStatus(statusEl, 'Tahmini öğrenci sayısı sayı olmalıdır.', 'error');
        return;
      }
      if (!notice) {
        setStatus(
          statusEl,
          'Göndermeden önce İletişim Formu Aydınlatma Metnini okuyup bilgi edindiğinizi işaretleyin.',
          'error'
        );
        return;
      }

      var fns = getFunctions();
      if (!fns) {
        setStatus(statusEl, 'Bağlantı hazır değil. Lütfen sayfayı yenileyip tekrar deneyin.', 'error');
        return;
      }

      form.setAttribute('data-submitting', '1');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
      }
      setStatus(statusEl, 'Başvurunuz kaydediliyor…', 'pending');

      readFileAsBase64(logoFile)
        .then(function (logoBase64) {
          var payload = {
            institutionName: institutionName,
            authorizedPersonName: authorizedPersonName,
            authorizedPersonTitle: authorizedPersonTitle || null,
            email: email,
            phone: phone,
            city: city,
            district: district,
            fullAddress: fullAddress,
            interestedProgram: interestedProgram,
            estimatedStudentCount: estimatedRaw || null,
            message: message || null,
            logoBase64: logoBase64,
            logoContentType: String(logoFile.type || '').toLowerCase(),
            logoOriginalName: String(logoFile.name || 'logo').slice(0, 180),
            noticeAcknowledged: true,
            noticeVersion: NOTICE_VERSION,
            website: website
          };

          return fns.httpsCallable('createInstitutionOnboardingDraft')(payload);
        })
        .then(function () {
          form.reset();
          logoCtl.clear();
          var programSelect = form.querySelector('[name="interestedProgram"]');
          if (programSelect) {
            programSelect.value = '';
            programSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
          setStatus(
            statusEl,
            'Kurum bilgileriniz alındı. Ödeme adımı henüz aktif değildir; ekibimiz başvurunuzu değerlendirecektir.',
            'ok'
          );
        })
        .catch(function (err) {
          setStatus(statusEl, clientErrorMessage(err), 'error');
        })
        .then(function () {
          form.removeAttribute('data-submitting');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.removeAttribute('aria-busy');
          }
        });
    });
  }

  function init() {
    var form = document.getElementById('sa-institution-application-form');
    if (form) bindInstitutionOnboardingForm(form);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

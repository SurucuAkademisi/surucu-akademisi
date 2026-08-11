/**
 * Public contact / institution application forms → submitContactRequest callable.
 * No direct Firestore writes.
 */
(function () {
  'use strict';

  var NOTICE_VERSION = 'contact-v1';
  var MESSAGE_MIN = 10;

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

  function mapUserType(requestType) {
    if (requestType === 'institution_student_support') return 'institution_student';
    if (requestType === 'partnership') return 'institution_representative';
    return 'individual';
  }

  function clientErrorMessage(err) {
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
    return 'Talebiniz gönderilemedi. Lütfen tekrar deneyin.';
  }

  function bindGeneralForm(form) {
    var statusEl = $('#contact-form-status', form) || $('#contact-form-status');
    var submitBtn = form.querySelector('[type="submit"]');
    var institutionWrap = form.querySelector('[data-contact-institution-wrap]');
    var institutionInput = form.querySelector('[name="institutionName"]');
    var typeSelect = form.querySelector('[name="requestType"]');

    function syncInstitutionField() {
      var type = typeSelect ? String(typeSelect.value || '') : '';
      var need = type === 'institution_student_support';
      if (institutionWrap) institutionWrap.hidden = !need;
      if (institutionInput) {
        if (need) institutionInput.setAttribute('required', 'required');
        else institutionInput.removeAttribute('required');
      }
    }

    if (typeSelect) {
      typeSelect.addEventListener('change', syncInstitutionField);
      syncInstitutionField();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.getAttribute('data-submitting') === '1') return;

      var fullName = String((form.fullName && form.fullName.value) || '').trim();
      var email = String((form.email && form.email.value) || '').trim();
      var phone = String((form.phone && form.phone.value) || '').trim();
      var requestType = String((form.requestType && form.requestType.value) || '').trim();
      var institutionName = String((form.institutionName && form.institutionName.value) || '').trim();
      var message = String((form.message && form.message.value) || '').trim();
      var notice = form.noticeAcknowledged && form.noticeAcknowledged.checked === true;
      var website = String((form.website && form.website.value) || '');

      if (fullName.length < 2) {
        setStatus(statusEl, 'Lütfen ad soyad girin.', 'error');
        return;
      }
      if (!email || email.indexOf('@') === -1) {
        setStatus(statusEl, 'Lütfen geçerli bir e-posta girin.', 'error');
        return;
      }
      if (!requestType) {
        setStatus(statusEl, 'Lütfen talep konusunu seçin.', 'error');
        return;
      }
      if (requestType === 'institution_student_support' && !institutionName) {
        setStatus(statusEl, 'Lütfen kurum adını girin.', 'error');
        return;
      }
      if (message.length < MESSAGE_MIN) {
        setStatus(statusEl, 'Mesajınız en az ' + MESSAGE_MIN + ' karakter olmalıdır.', 'error');
        return;
      }
      if (!notice) {
        setStatus(statusEl, 'Göndermeden önce İletişim Formu Aydınlatma Metnini okuyup bilgi edindiğinizi işaretleyin.', 'error');
        return;
      }

      var fns = getFunctions();
      if (!fns) {
        setStatus(statusEl, 'Bağlantı hazır değil. Lütfen sayfayı yenileyip tekrar deneyin.', 'error');
        return;
      }

      var payload = {
        fullName: fullName,
        email: email,
        phone: phone || null,
        requestType: requestType,
        userType: mapUserType(requestType),
        institutionName: institutionName || null,
        message: message,
        noticeAcknowledged: true,
        noticeVersion: NOTICE_VERSION,
        sourcePage: 'iletisim',
        website: website
      };

      form.setAttribute('data-submitting', '1');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
      }
      setStatus(statusEl, 'Talebiniz gönderiliyor…', 'pending');

      fns
        .httpsCallable('submitContactRequest')(payload)
        .then(function () {
          form.reset();
          syncInstitutionField();
          setStatus(
            statusEl,
            'Talebiniz alındı. Gerekli değerlendirme sonrasında sizinle iletişime geçilebilir.',
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

  function bindInstitutionForm(form) {
    var statusEl = $('#institution-form-status', form) || $('#institution-form-status');
    var submitBtn = form.querySelector('[type="submit"]');

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
      var interestedProgram = String(
        (form.interestedProgram && form.interestedProgram.value) || ''
      ).trim();
      var estimatedRaw = String(
        (form.estimatedStudentCount && form.estimatedStudentCount.value) || ''
      ).trim();
      var message = String((form.message && form.message.value) || '').trim();
      var notice = form.noticeAcknowledged && form.noticeAcknowledged.checked === true;
      var website = String((form.website && form.website.value) || '');

      if (!institutionName) {
        setStatus(statusEl, 'Lütfen kurum adını girin.', 'error');
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
      if (message.length < MESSAGE_MIN) {
        setStatus(statusEl, 'Açıklama en az ' + MESSAGE_MIN + ' karakter olmalıdır.', 'error');
        return;
      }
      if (!notice) {
        setStatus(statusEl, 'Göndermeden önce İletişim Formu Aydınlatma Metnini okuyup bilgi edindiğinizi işaretleyin.', 'error');
        return;
      }

      var fns = getFunctions();
      if (!fns) {
        setStatus(statusEl, 'Bağlantı hazır değil. Lütfen sayfayı yenileyip tekrar deneyin.', 'error');
        return;
      }

      var payload = {
        requestType: 'institution_application',
        userType: 'institution_representative',
        institutionName: institutionName,
        authorizedPersonName: authorizedPersonName,
        authorizedPersonTitle: authorizedPersonTitle || null,
        fullName: authorizedPersonName,
        email: email,
        phone: phone,
        city: city,
        district: district || null,
        interestedProgram: interestedProgram,
        estimatedStudentCount: estimatedRaw || null,
        message: message,
        noticeAcknowledged: true,
        noticeVersion: NOTICE_VERSION,
        sourcePage: 'kurumsal-basvuru',
        website: website
      };

      form.setAttribute('data-submitting', '1');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-busy', 'true');
      }
      setStatus(statusEl, 'Başvurunuz gönderiliyor…', 'pending');

      fns
        .httpsCallable('submitContactRequest')(payload)
        .then(function () {
          form.reset();
          setStatus(
            statusEl,
            'Başvurunuz alındı. Gerekli değerlendirme sonrasında sizinle iletişime geçilebilir.',
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
    var general = document.getElementById('sa-general-contact-form');
    if (general) bindGeneralForm(general);
    // Kurumsal onboarding drafts use institution-onboarding-form.js + createInstitutionOnboardingDraft.
    // Skip legacy submitContactRequest binding when the dedicated onboarding form is present.
    var institution = document.getElementById('sa-institution-application-form');
    if (institution && institution.getAttribute('data-onboarding-draft') !== '1') {
      bindInstitutionForm(institution);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

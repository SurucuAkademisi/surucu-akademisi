/**
 * Shared exam category catalog for web çıkmış sorular hub + list pages.
 */
(function () {
  'use strict';

  var SHARED_EXAM_TENANT_ID = 'surucu_akademisi';

  var categories = [
    {
      key: 'standard',
      title: 'Deneme Sınavları Çıkmış Sorular',
      description: 'Genel ehliyet sınav formatına uygun karışık deneme testleri.',
      accent: 'cyan',
      order: 1
    },
    {
      key: 'motor_tech',
      title: 'Motor ve Araç Tekniği Çıkmış Sorular',
      description: 'Motor, araç tekniği, bakım ve arıza bilgisi odaklı soru grupları.',
      accent: 'green',
      order: 2
    },
    {
      key: 'traffic_ethics',
      title: 'Trafik Adabı Çıkmış Sorular',
      description: 'Sürücü davranışı, güvenli sürüş ve trafik kültürü konuları.',
      accent: 'orange',
      order: 3
    },
    {
      key: 'first_aid',
      title: 'İlk Yardım Çıkmış Sorular',
      description: 'Temel ilk yardım, kaza anı müdahale ve güvenli yardım bilgileri.',
      accent: 'purple',
      order: 4
    },
    {
      key: 'traffic_env',
      title: 'Trafik ve Çevre Çıkmış Sorular',
      description: 'Trafik kuralları, levhalar, çevre bilinci ve yol güvenliği soruları.',
      accent: 'rose',
      order: 5
    },
    {
      key: 'video_animation',
      title: 'Video-Animasyon Soruları',
      description: 'Görsel, video ve animasyon destekli yeni nesil soru hazırlıkları.',
      accent: 'gold',
      order: 6
    },
    {
      key: 'work_machines',
      title: 'İş Makineleri Çıkmış Sorular',
      description: 'İş makineleri operatörlük sınavlarına yönelik hazırlık soru alanı.',
      accent: 'blue',
      order: 7
    }
  ];

  function getCategoryByKey(key) {
    var k = String(key || '').trim().toLowerCase();
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].key === k) return categories[i];
    }
    return null;
  }

  function isValidCategoryKey(key) {
    return !!getCategoryByKey(key);
  }

  window.SA_WEB_EXAM_CATALOG = {
    SHARED_EXAM_TENANT_ID: SHARED_EXAM_TENANT_ID,
    categories: categories,
    getCategoryByKey: getCategoryByKey,
    isValidCategoryKey: isValidCategoryKey
  };
})();

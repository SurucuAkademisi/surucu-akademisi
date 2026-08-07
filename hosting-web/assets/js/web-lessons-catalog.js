/**
 * Fixed lesson book categories for web dersler module (excludes practical guide).
 */
(function () {
  'use strict';

  var PRACTICAL_CATEGORY_IDS = ['traffic_signs_practical', 'dashboard_indicators_practical'];

  var categories = [
    {
      id: 'motor_ve_arac_teknigi',
      title: 'Motor ve Araç Tekniği',
      description: 'Motor, araç tekniği, bakım ve arıza bilgisi konularını adım adım çalışın.',
      accent: 'green',
      order: 1
    },
    {
      id: 'trafik_ve_cevre_bilgisi',
      title: 'Trafik ve Çevre Bilgisi',
      description: 'Trafik kuralları, levhalar, çevre bilinci ve yol güvenliği içerikleri.',
      accent: 'cyan',
      order: 2
    },
    {
      id: 'ilk_yardim',
      title: 'İlk Yardım Bilgisi',
      description: 'Temel ilk yardım, kaza anı müdahale ve güvenli yardım bilgileri.',
      accent: 'purple',
      order: 3
    },
    {
      id: 'trafik_adabi',
      title: 'Trafik Adabı',
      description: 'Sürücü davranışı, güvenli sürüş ve trafik kültürü konuları.',
      accent: 'orange',
      order: 4
    },
    {
      id: 'is_makineleri',
      title: 'İş Makineleri',
      description: 'İş makineleri operatörlük sınavlarına yönelik ders içerikleri.',
      accent: 'gold',
      order: 5
    }
  ];

  function isPracticalCategoryId(categoryId) {
    var id = String(categoryId || '').trim();
    return PRACTICAL_CATEGORY_IDS.indexOf(id) >= 0;
  }

  function isValidLessonCategoryId(categoryId) {
    var id = String(categoryId || '').trim();
    if (!id || isPracticalCategoryId(id)) return false;
    return categories.some(function (c) {
      return c.id === id;
    });
  }

  function getCategoryById(categoryId) {
    var id = String(categoryId || '').trim();
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return categories[i];
    }
    return null;
  }

  window.SA_WEB_LESSONS_CATALOG = {
    categories: categories,
    PRACTICAL_CATEGORY_IDS: PRACTICAL_CATEGORY_IDS,
    isPracticalCategoryId: isPracticalCategoryId,
    isValidLessonCategoryId: isValidLessonCategoryId,
    getCategoryById: getCategoryById
  };
})();

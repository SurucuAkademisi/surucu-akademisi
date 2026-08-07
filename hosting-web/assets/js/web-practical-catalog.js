/**
 * Practical Guide category catalog (read-only web).
 */
(function () {
  'use strict';

  var TRAFFIC_SIGNS_PRACTICAL_CATEGORY_ID = 'traffic_signs_practical';

  var TRAFFIC_SIGNS_PRACTICAL_GROUPS = [
    {
      id: 'danger_warning',
      title: 'Tehlike Uyarı ve İşaretleri',
      icon: '⚠️',
      accent: 'amber',
      desc: 'Bu kategorideki trafik levhalarını inceleyin.'
    },
    {
      id: 'traffic_regulation',
      title: 'Trafik Tanzim İşaretleri',
      icon: '🚦',
      accent: 'violet',
      desc: 'Bu kategorideki trafik levhalarını inceleyin.'
    },
    {
      id: 'information_signs',
      title: 'Bilgi İşaretleri',
      icon: 'ℹ️',
      accent: 'cyan',
      desc: 'Bu kategorideki trafik levhalarını inceleyin.'
    },
    {
      id: 'parking_stopping',
      title: 'Duraklama ve Park Etme İşaretleri',
      icon: '🅿️',
      accent: 'orange',
      desc: 'Bu kategorideki trafik levhalarını inceleyin.'
    },
    {
      id: 'highway_signs',
      title: 'Otoyol İşaretleri',
      icon: '🛣️',
      accent: 'blue',
      desc: 'Bu kategorideki trafik levhalarını inceleyin.'
    }
  ];

  var categories = [
    {
      id: 'traffic_signs_practical',
      key: 'traffic_signs_practical',
      title: 'Trafik Levha ve İşaretleri',
      description: 'Sınavda ve trafikte sık karşılaşılan levha ve işaretleri öğrenin.',
      accent: 'orange',
      order: 1
    },
    {
      id: 'dashboard_indicators_practical',
      key: 'dashboard_indicators_practical',
      title: 'Araç Gösterge Paneli',
      description: 'Araç göstergeleri ve uyarı ışıklarını pratik şekilde inceleyin.',
      accent: 'cyan',
      order: 2
    }
  ];

  function isPracticalCategoryId(categoryId) {
    var id = String(categoryId || '').trim();
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

  function isTrafficSignsPracticalCategoryId(categoryId) {
    return String(categoryId || '').trim() === TRAFFIC_SIGNS_PRACTICAL_CATEGORY_ID;
  }

  function getTrafficSignsGroupById(groupId) {
    var gid = String(groupId || '').trim();
    for (var i = 0; i < TRAFFIC_SIGNS_PRACTICAL_GROUPS.length; i++) {
      if (TRAFFIC_SIGNS_PRACTICAL_GROUPS[i].id === gid) return TRAFFIC_SIGNS_PRACTICAL_GROUPS[i];
    }
    return null;
  }

  window.SA_WEB_PRACTICAL_CATALOG = {
    categories: categories,
    TRAFFIC_SIGNS_PRACTICAL_CATEGORY_ID: TRAFFIC_SIGNS_PRACTICAL_CATEGORY_ID,
    TRAFFIC_SIGNS_PRACTICAL_GROUPS: TRAFFIC_SIGNS_PRACTICAL_GROUPS,
    isPracticalCategoryId: isPracticalCategoryId,
    getCategoryById: getCategoryById,
    isTrafficSignsPracticalCategoryId: isTrafficSignsPracticalCategoryId,
    getTrafficSignsGroupById: getTrafficSignsGroupById
  };
})();

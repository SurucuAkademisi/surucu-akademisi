/**
 * Shared 8-module catalog for public landing and institution student home.
 */
(function () {
  'use strict';

  window.SA_WEB_MODULE_CATALOG = [
    {
      key: 'exams',
      title: 'Ehliyet Sınavları Çıkmış Sorular',
      description: 'Güncel sınav formatına uygun yapay zeka destekli deneme testleriyle hazırlanın.',
      accent: 'cyan',
      statusLabel: 'AKTİF',
      appHref: '../cikmis-sorular/'
    },
    {
      key: 'lessons',
      title: 'Ehliyet Sınavı Konu Anlatımlı Kitaplar',
      description: 'Trafik ve Çevre Bilgisi, İlk Yardım Bilgisi, Motor ve Araç Tekniği ile Trafik Adabı derslerini düzenli şekilde çalışın.',
      accent: 'green',
      statusLabel: 'AKTİF',
      appHref: '../dersler/'
    },
    {
      key: 'videos',
      title: 'Ehliyet Sınavı Canlı Video Dersler (Öğretmen)',
      description: 'Öğretmen anlatımlı premium video derslerle eksik konuları tamamlayın.',
      accent: 'gold',
      statusLabel: 'Premium',
      statusAccent: true,
      appHref: '../video-dersler/'
    },
    {
      key: 'practical',
      title: 'Ehliyet Sınavı Pratik Bilgiler Rehberi',
      description: 'Levhalar, göstergeler ve sınavda işinize yarayacak kısa rehberleri inceleyin.',
      accent: 'orange',
      statusLabel: 'Aktif',
      appHref: '../pratik-rehber/'
    },
    {
      key: 'duel',
      title: 'Ehliyet Sınav Yarışları (Sınav Düellosu)',
      description: 'Bilginizi eğlenceli şekilde canlı kullanıcılarla deneme sınavı yarışmaları yaparak ve rekabetçi karşılaşmalarla pekiştirin.',
      accent: 'rose',
      statusLabel: 'Lobi Aktif',
      appHref: '../duello/'
    },
    {
      key: 'forum',
      title: 'Ehliyet Sınavları Öğrenci Forumu',
      description: 'Sürücü adaylarıyla soru paylaşımı, bilgi alışverişi ve sınav deneyimleri alanı.',
      accent: 'purple',
      statusLabel: 'Aktif',
      appHref: '../forum/'
    },
    {
      key: 'leagues',
      title: 'Ligler',
      description: 'Sınav performansınıza göre lig tablolarında yer alın ve sıralamada yükselin.',
      accent: 'indigo',
      statusLabel: 'Aktif',
      appHref: '../ligler/'
    },
    {
      key: 'profile',
      title: 'Profilim',
      description: 'İlerlemenizi, sınav sonuçlarınızı ve hesap bilgilerinizi tek ekranda görüntüleyin.',
      accent: 'sky',
      statusLabel: 'Aktif',
      appHref: '../profilim/'
    }
  ];
})();

// Ilk alim kapisi: GOMULU kural tablosu (YEDEK KOPYA, surum tabani).
//
// YETKILI KAYNAK server/data/eligibility.js'tir; GET /eligibility?v=2 onu yanitlar (sorgusuz cagri yalniz
// bstocks + xstocks projeksiyonunu doner: eski istemciler icin). Bu dosya onun BIREBIR
// kopyasidir ve yalniz iki is gorur: (1) kalici onbellek bossa ve sunucuya hic ulasilamadiysa kapinin
// calisabilecegi son caredir (fail-closed icerik: ulke engelleri + cekirdek taban), (2) surum tabanidir:
// istemci kalici onbellek, sunucu ve bu kopya arasindan en yuksek surumlu GECERLI tabloyu kullanir.
// Eski sekilli (bilinmeyen alan tasiyan) bir tablo, kalici onbellekte olsa bile, BUTUNUYLE yok sayilir ve bu
// kopyaya dusulur (K40).
//
// ICERIK ESITLIGI ZORUNLU DEGIL, SURUM TABANI ZORUNLU: sunucu tablosu bu kopyadan YENI olabilir
// (server/test/eligibilityClientCompat.test.js `server >= client` kilitler; AYNI surumde icerik ESIT
// olmak zorundadir). Sunucu tablosunu degistirirsen bu dosyayi ayni surum ve icerikle guncellemek
// SART DEGIL ama bir sonraki istemci yayininda onerilir (yeni kurulumun yedegi taze olsun).
//
// SAF VERIDIR: hicbir import yok (saf veri dosyasi kurali, data/xStocks.js ile ayni). Derin donuk.
// featureFlags'e BAGLI DEGIL: kapi derleme zamani bayragi ardinda degildir.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

export const BUNDLED_ELIGIBILITY_RULES = deepFreeze({
  version: '2026-11-20.1',
  common: {
    precaution: [
      'AS', 'AT', 'AU', 'AX', 'BE', 'BG', 'BR', 'CA', 'CH', 'CY', 'CZ', 'DE',
      'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GF', 'GG', 'GI', 'GP', 'GR', 'GU',
      'HK', 'HR', 'HU', 'IE', 'IM', 'IR', 'IS', 'IT', 'JE', 'KP', 'LI', 'LT',
      'LU', 'LV', 'MF', 'MM', 'MP', 'MQ', 'MT', 'MY', 'NL', 'NO', 'PL', 'PR',
      'PT', 'RE', 'RO', 'SE', 'SG', 'SI', 'SK', 'UM', 'US', 'VI', 'YT',
    ],
  },
  issuers: {
    bstocks: {
      buyEnabled: true,
      blocked: [
        'AE', 'AS', 'AT', 'AU', 'AX', 'BE', 'BG', 'BH', 'CU', 'CY', 'CZ', 'DE',
        'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GG', 'GI', 'GR', 'GU', 'HK', 'HR',
        'HU', 'IE', 'IM', 'IR', 'IS', 'IT', 'JE', 'JP', 'KP', 'LI', 'LT', 'LU',
        'LV', 'MP', 'MT', 'NL', 'NO', 'NZ', 'PH', 'PL', 'PR', 'PT', 'RO', 'SE',
        'SI', 'SK', 'TH', 'TR', 'UM', 'US', 'VI',
      ],
      warn: [],
    },
    coinbase: { buyEnabled: true, blocked: [], warn: [] },
    ondo: { buyEnabled: true, blocked: [], warn: [] },
    robinhood: { buyEnabled: true, blocked: [], warn: [] },
    st0x: { buyEnabled: true, blocked: [], warn: [] },
    xstocks: {
      buyEnabled: true,
      blocked: [
        'AF', 'AU', 'BY', 'CA', 'CD', 'CF', 'CU', 'ET', 'GB', 'HT', 'IQ', 'IR',
        'KP', 'LB', 'LY', 'ML', 'MM', 'MZ', 'NG', 'NI', 'PH', 'RU', 'SD', 'SO',
        'SS', 'SY', 'US', 'VE', 'YE', 'ZW',
      ],
      warn: [],
    },
  },
})

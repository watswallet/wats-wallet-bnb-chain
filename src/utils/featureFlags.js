// Derleme zamani ozellik bayraklari — TEK KAYNAK.
//
// Vite `import.meta.env.VITE_*` ifadesini derlerken METIN SABITINE cevirir, yani
// asagidaki karsilastirma bundle'da `false` sabitine duser ve `if (SOLANA_ENABLED)`
// bloklari agac-sarsmayla TAMAMEN atilir. Bayragi bir fonksiyon ya da store degeri
// yapmak bu ozelligi kaybettirirdi: kod bundle'da kalir, yalnizca calismazdi.
//
// VARSAYILAN KAPALI ve KATI: yalnizca 'true' METNI acar. '1' / 'yes' / 'TRUE'
// acmaz — bir ortam dosyasindaki yaziminin sessizce Solana'yi yayina sokmasi,
// bu bayragin var olma sebebinin tam tersi olurdu. Bayrak yoksa da kapali:
// eksik degiskeni "acik" saymak, .env'i olmayan her derlemeyi Solana'li yapardi.
export const SOLANA_ENABLED = import.meta.env.VITE_SOLANA_ENABLED === 'true'

// GIZLI MOD (docs/superpowers/specs/2026-10-02-gizli-mod-design.md). SOLANA ile ayni
// desen: derleme zamani sabiti, yalnizca tam 'true' dizgesi acar, kapaliyken olu kod
// atilir. vitest.config.js'e BILEREK eklenmedi: arka plan kapisi asenkron ve bazi
// mevcut testler senkron dagitim varsayar; gizli mod testleri bayragi kendileri acar.
export const PRIVACY_ENABLED = import.meta.env.VITE_PRIVACY_ENABLED === 'true'

// Kullanim istatistigi (gunluk ping). VARSAYILAN KAPALI ve KATI: yalnizca
// 'true' METNI acar. NEDEN: yayimli gizlilik politikasi analitik toplamadigini
// soyluyor ve Chrome Web Store, kimlik numarasi gonderen bir istemci icin
// uygulama-ici aciklama bekliyor; politika, Privacy sekmesi ve bir kerelik bildirim
// karti hazir olmadan bir magaza derlemesi telemetriyi kendiliginden yayina sokardi.
// Kapaliyken: ping hic gitmez (background.js) ve Tercihler'de anahtar satiri yoktur.
export const ANALYTICS_ENABLED = import.meta.env.VITE_ANALYTICS_ENABLED === 'true'

// XSTOCKS (Backed / Kraken tokenize hisse) ozelligi. SOLANA_ENABLED ile AYNI kati kural:
// yalnizca 'true' METNI acar; '1' / 'yes' / 'TRUE' acmaz, degisken yoksa da kapali.
// Vite bunu derlemede sabite cevirir; kapaliyken `if (XSTOCKS_ENABLED)` bloklari
// agac-sarsmayla atilir.
//
// NEYI KAPATIR (spec 5.12, plan K1): Hisseler sekmesindeki xStock satirlari ve gruplari,
// Token.vue xStock dallari. NEYI KAPATMAZ: Takas / Kopru dislamasi ve sahte hisse
// uyarisi (koruyucu kapilar) ile fiyatin carpana bolunmesi.
export const XSTOCKS_ENABLED = import.meta.env.VITE_XSTOCKS_ENABLED === 'true'

// Faz 3: ATS ile ag ucreti (CoW emri gerceklesince ATS tahsili + iade). Ana bayraga BAGLIDIR
// (ana bayrak kapaliyken true olsa da kapali). KAPALI = Faz 2 davranisi: fee.mode 'none',
// kart cizilmez, ucret op'u gonderilmez, borc kilidi uygulanmaz. Uretimde KAPALI (testle kilitli).
export const XSTOCKS_ATS_FEE_ENABLED = XSTOCKS_ENABLED && import.meta.env.VITE_XSTOCKS_ATS_FEE_ENABLED === 'true'

// GIZLI HESAP ATS SATIN ALMA (gizli-mod cok-ag spec 4.5 madde 2, K13, E18). SOLANA_ENABLED ile AYNI kati kural:
// yalnizca 'true' METNI acar, degisken yoksa kapali; derleme sabitidir (kapi, isleyici ve arayuz AYNI sabiti okur).
// Kapaliyken kullaniciya gorunen davranis bugunku gibidir (gizli modda ATS alinamaz). Uretimde (.env.production) canli
// kanit (5.2 adim 1) ve yayin kapisi 6.11 gecene dek KAPALI kalir; acmak ayri bir insan karari ve ayri commit'tir.
// Bayrak PRIVACY_ENABLED'dan BAGIMSIZDIR: gizlilik bayragi kapaliyken bu bayrak hicbir sey acmaz (kapi ve isleyici
// Gizli kimligi zaten yalniz gizli mod canliyken gecirir).
export const PRIVATE_ATS_SALE = import.meta.env.VITE_PRIVATE_ATS_SALE === 'true'

// GIZLI MODDA KENDINE TAKAS VE KOPRU (SilentSwap). PRIVATE_ATS_SALE ile AYNI kati kural: yalnizca 'true' METNI acar, degisken
// yoksa kapali. ACIKKEN: Home ve Token'daki gizli mod Takas/Kopru dugmeleri private_swap / private_bridge ekranlarini
// (PrivateTransfer swap/bridge kipleri; alici HER ZAMAN kendi Gizli Hesabi, odeme SilentSwap uzerinden) acar, App.vue bu iki
// sayfayi baglar ve kapi (privacyGate) YALNIZ imzaci Gizli Hesap VE cikti kasadaki bilinen Gizli Hesap adresi iken
// PRIVATE_SAME_ADDRESS'i atlar. KAPALIYKEN bu dugmeler ve sayfalar yoktur ve kapi kendine gonderimi reddeder.
// KLASIK (CoW) Takas/Kopru gizli modda bu bayraktan BAGIMSIZ kapalidir: ekranlari baglanmaz (Takas yalniz "ATS al" satis
// kipinde acilir) ve kapi SWAP, SWAP_QUOTE, BRIDGE, BRIDGE_QUOTE ile iki ATS ucret teklifini Gizli kimlik icin her bayrak
// degerinde reddeder. Uretimde (.env.production) KAPALI; manifest.config.js uretim derlemesinde true'yu reddeder; acmak ayri
// bir insan commit'idir. NORMAL MOD ETKILENMEZ.
export const PRIVATE_SWAP_BRIDGE = import.meta.env.VITE_PRIVATE_SWAP_BRIDGE === 'true'

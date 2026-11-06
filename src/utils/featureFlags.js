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

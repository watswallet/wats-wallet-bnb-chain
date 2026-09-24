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

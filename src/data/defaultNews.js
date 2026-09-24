// Ana ekran "Gelismeler" seridinin GOMULU varsayilan listesi.
//
// Duyurularin ASIL kaynagi sunucudur (`GET /news`, bkz. composables/useNews.js).
// Bu dosya o uc ulasilamadigindaki yedektir ve BILEREK server/data/news.js'in
// KOPYASIDIR.
//
// NEDEN KOPYA: sunucu ve uzanti AYRI dagitiliyor ve sunucu ELLE guncelleniyor.
// Tek kaynak birakip yedegi atsaydik, `/news` sunucuya cikana kadar (ya da bir gun
// duserse) ozellik kullaniciya HIC gorunmezdi -- ana ekranda o alan bos kalirdi.
// Kopyanin bedeli: yeni bir duyuru yalnizca sunucuya eklenirse burasi eskir. Bu
// KABUL EDILEBILIR, cunku yedek yalnizca uc ulasilamazken okunur; sunucu ayaktayken
// donen liste bunun UZERINE yazar.
//
// Bicim server/data/news.js ile BIREBIR ayni olmak zorunda: ikisi de ayni
// normalizeNews()'ten geciyor (bkz. utils/news.js).
export const DEFAULT_NEWS = [
    {
        id: 'ton-support',
        date: '2026-09-14',
        accent: 'blue',
        title: {
            tr: 'TON artık destekleniyor',
            en: 'TON is now supported',
        },
        body: {
            tr: "Ağ listesinden TON'u seçip GRAM ve jetton'larınızı yönetin.",
            en: 'Pick TON from the network list to manage GRAM and jettons.',
        },
    },
    {
        id: 'ats-fee-swap-bridge',
        date: '2026-09-01',
        accent: 'amber',
        title: {
            tr: 'Takas ve köprüde ATS kesintisi',
            en: 'ATS fees on swap and bridge',
        },
        body: {
            tr: 'Takas ve köprü işlemlerinin komisyonu artık ATS olarak alınıyor.',
            en: 'Swap and bridge transactions now charge their commission in ATS.',
        },
    },
]

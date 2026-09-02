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
        id: 'ats-fee-ton',
        date: '2026-09-01',
        accent: 'blue',
        title: {
            tr: "TON'da ATS kesintisi başladı",
            en: 'ATS fees are live on TON',
        },
        body: {
            tr: 'TON ağındaki gönderimlerin işlem ücreti artık ATS bakiyenizden düşülüyor.',
            en: 'Transfers on the TON network now take their fee from your ATS balance.',
        },
    },
    {
        id: 'ats-fee-solana',
        date: '2026-09-01',
        accent: 'purple',
        title: {
            tr: "Solana'da ATS kesintisi başladı",
            en: 'ATS fees are live on Solana',
        },
        body: {
            tr: 'Solana ağındaki gönderimlerin işlem ücreti artık ATS bakiyenizden düşülüyor.',
            en: 'Transfers on the Solana network now take their fee from your ATS balance.',
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

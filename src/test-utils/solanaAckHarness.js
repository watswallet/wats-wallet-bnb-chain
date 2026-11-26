// Solana sayfa betigi (solanaInjected.js) testleri icin ack harness'i.
//
// Gercek hatta content.js, sayfadan gelen her `wats_content_script` istegini
// ALINDIGI ANDA `{ target: 'wats_solana_inpage', ack: id }` ile onaylar (arka plan
// yanitini beklemez). Saglayici ileride ack gelmeyen istegi yeniden gonderecek
// (O5); o zaman ack'siz kurulan sahte `window` ek mesaj ve zamanlayici uretip
// mevcut testleri bozar. Bu harness ack'i sahte pencereye otomatik dondurur:
// testler yanit/ack davranisini tek yerden alir.
//
// Yalniz test kodudur: uretim koduna HICBIR sey import edilmez.
import { vi } from 'vitest'

const ISTEK_HEDEFI = 'wats_content_script'
const SAYFA_HEDEFI = 'wats_solana_inpage'

/** Giden bir mesaj ack bekleyen bir Solana istegi mi? (kimlikli + yuklu istek) */
function istekMi(data) {
    return !!data && typeof data === 'object' && data.target === ISTEK_HEDEFI && !!data.id && !!data.payload
}

/**
 * `win.postMessage`i yakalar: giden mesaji `gonderilen` dizisine yazar ve her
 * kimlikli Solana istegine, content.js gibi, ack mesajini (bir mikro-gorev SONRA,
 * gercek postMessage'in eszamansizligi gibi) geri dondurur.
 *
 * `secenekler.gonderilen`: yakalama dizisi (varsayilan `win.gonderilen`, yoksa yeni dizi).
 * `secenekler.teslim(data)`: mesajin sayfa dinleyicilerine ulasma yolu. Varsayilan
 *   `win.dispatchEvent(new Event('message'))`; duz-nesne sahte pencereler
 *   (dinleyiciler dizisi tutanlar) kendi dagitimini verir.
 *
 * Ack kimliksiz oldugu icin saglayicinin dinleyicisi onu zararsizca dusurur;
 * ack `gonderilen`e YAZILMAZ (testlerin "giden mesaj" sayimlarini bozmaz).
 * Ayni pencereyi dondurur.
 */
export function createAckingWindow(win, secenekler = {}) {
    const gonderilen = secenekler.gonderilen || win.gonderilen || (win.gonderilen = [])
    const teslim = secenekler.teslim || ((data) => {
        const olay = new Event('message')
        olay.source = win
        olay.data = data
        win.dispatchEvent(olay)
    })
    win.postMessage = (data) => {
        gonderilen.push(data)
        if (istekMi(data)) {
            Promise.resolve().then(() => teslim({ target: SAYFA_HEDEFI, ack: data.id }))
        }
    }
    return win
}

/**
 * Yeniden gonderme zamanlayicilarini test icin kontrol altina alir. Yalnizca
 * zamanlayici fonksiyonlari sahtelenir (mikro-gorevler/nextTick GERCEK kalir:
 * `await` zincirleri bozulmasin). `bitir()` gercek zamanlayicilari geri koyar.
 */
export function fakeTimerKur() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    return {
        /** Sahte saati `ms` ilerletir ve bekleyen mikro-gorevleri bosaltir. */
        async ilerlet(ms) {
            await vi.advanceTimersByTimeAsync(ms)
        },
        bitir() {
            vi.useRealTimers()
        },
    }
}

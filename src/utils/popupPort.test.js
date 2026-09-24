import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { connectPopupPort } from './popupPort'
import { UI_PORT_PREFIX } from './uiRegistry'

// NEDEN BU DOSYA VAR: kayit defterinin ("Hemen" kilidi) dogru calismasi tamamen
// "arayuz koptugunda YENIDEN BAGLANIR" davranisina baglidir, ama o mantik tamamen
// test disindaydi. Biri `durduruldu` kontrolunu ya da `onDisconnect` icindeki
// `setTimeout(bagla, ...)`yi bozarsa arayuz bir kopmadan sonra bir daha HIC
// kayit olmaz -- "Hemen" kilidi HIC gelmez ve takim yesil kalir.

// Sahte chrome.runtime.connect. Gercek Port'un bu modulun kullandigi TEK
// yuzeyini taklit eder: `onDisconnect.addListener` + `disconnect`.
function sahteChrome({ firlat = 0 } = {}) {
    const portlar = []
    let kalanFirlatma = firlat

    const connect = vi.fn(({ name }) => {
        if (kalanFirlatma > 0) {
            kalanFirlatma--
            throw new Error('SW uyanik degil')
        }
        const dcs = []
        const port = {
            name,
            onDisconnect: { addListener: (fn) => dcs.push(fn) },
            disconnect: vi.fn(() => dcs.forEach((fn) => fn())),
            // Testin SW olumunu taklit etmesi icin: Chrome'un kopardigi port.
            kop: () => dcs.forEach((fn) => fn()),
        }
        portlar.push(port)
        return port
    })

    globalThis.chrome = { runtime: { connect } }
    return { connect, portlar }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

// KAYNAK KILIDI (bulgu I4) -- yeniden baglanma OZERKTIR.
//
// background.js'te alicisi OLMAYAN bir `SW_READY` yayini vardi ve yorumu var
// olmayan bir kurtarma yolunu anlatiyordu: yanlis guven. Yayindan beklenen sey
// (acik arayuzler yeniden baglansin) bu modulun kendi dongusuyle zaten
// saglaniyor. Yeniden eklenecekse ONCE onu DINLEYEN taraf yazilmali.
describe('SW_READY yayini yok -- yeniden baglanma bu modulun isi', () => {
    it('background.js SW_READY yayinlamiyor', () => {
        const bg = readFileSync(fileURLToPath(new URL('../background.js', import.meta.url)), 'utf8')
        expect(bg).not.toMatch(/['"]SW_READY['"]/)
    })

    it('hicbir arayuz SW_READY dinlemiyor (yani eklenirse alicisiz kalmaz)', () => {
        const app = readFileSync(fileURLToPath(new URL('../popup/App.vue', import.meta.url)), 'utf8')
        expect(app).not.toMatch(/SW_READY/)
    })
})

describe('connectPopupPort -- port kimligi', () => {
    it('port adi kimlikli arayuz onekiyle baslar', () => {
        const { connect } = sahteChrome()
        connectPopupPort()

        expect(connect).toHaveBeenCalledTimes(1)
        const { name } = connect.mock.calls[0][0]
        expect(name.startsWith(UI_PORT_PREFIX)).toBe(true)
        // Onekten sonra GERCEK bir ayirt edici olmali: ayni baglamdan iki kez
        // baglanmak kayit defterindeki kumeyi yaniltmasin.
        expect(name.length).toBeGreaterThan(UI_PORT_PREFIX.length)
    })

    it('her baglanti YENI bir kimlik alir', () => {
        const { connect, portlar } = sahteChrome()
        connectPopupPort()

        portlar[0].kop()
        vi.advanceTimersByTime(250)

        expect(connect).toHaveBeenCalledTimes(2)
        expect(connect.mock.calls[0][0].name).not.toBe(connect.mock.calls[1][0].name)
    })
})

describe('connectPopupPort -- kopmada yeniden baglanir', () => {
    // MV3'te SW ~30 saniye atalette sonlanir ve acik bir port bu sayaci
    // SIFIRLAMAZ. Eski kod tek seferlik bagleniyordu: o andan sonra panel bir
    // daha HIC kayitli olmuyordu -- kullanici paneli gercekten kapattiginda
    // bile kilit gelmiyordu.
    it('kopmadan 250 ms sonra yeniden baglanir', () => {
        const { connect, portlar } = sahteChrome()
        connectPopupPort()
        expect(connect).toHaveBeenCalledTimes(1)

        portlar[0].kop()
        vi.advanceTimersByTime(249)
        expect(connect).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(1)
        expect(connect).toHaveBeenCalledTimes(2)
    })

    it('pes pese kopmalarda yeniden baglanmaya devam eder', () => {
        const { connect, portlar } = sahteChrome()
        connectPopupPort()

        portlar[0].kop()
        vi.advanceTimersByTime(250)
        portlar[1].kop()
        vi.advanceTimersByTime(500)
        portlar[2].kop()
        vi.advanceTimersByTime(1000)

        expect(connect).toHaveBeenCalledTimes(4)
    })

    it('connect FIRLATIRSA yeniden dener', () => {
        // Arka plan henuz uyanmamis / acilista patlamis olabilir.
        const { connect } = sahteChrome({ firlat: 1 })
        const h = connectPopupPort()

        expect(h.port).toBe(null)
        expect(connect).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(250)
        expect(connect).toHaveBeenCalledTimes(2)
    })
})

describe('connectPopupPort -- stop()', () => {
    it('stop() sonrasi yeniden BAGLANMAZ', () => {
        const { connect, portlar } = sahteChrome()
        const h = connectPopupPort()

        h.stop()
        // stop() aktif portu kapatir; bu da onDisconnect'i tetikler.
        expect(portlar[0].disconnect).toHaveBeenCalled()

        vi.advanceTimersByTime(60000)
        expect(connect).toHaveBeenCalledTimes(1)
    })

    it('kopmadan SONRA gelen stop() bekleyen denemeyi iptal eder', () => {
        const { connect, portlar } = sahteChrome()
        const h = connectPopupPort()

        portlar[0].kop()          // yeniden baglanma planlandi (250 ms)
        h.stop()                  // ... ama arayuz kapaniyor

        vi.advanceTimersByTime(60000)
        expect(connect).toHaveBeenCalledTimes(1)
    })

    it('connect firlatmisken gelen stop() de denemeyi iptal eder', () => {
        const { connect } = sahteChrome({ firlat: 1 })
        const h = connectPopupPort()

        h.stop()
        vi.advanceTimersByTime(60000)
        expect(connect).toHaveBeenCalledTimes(1)
    })
})

// USTEL GERI CEKILME (bulgu I8).
//
// `gecikme = ILK_GECIKME_MS` sifirlamasi eskiden `connect()` BASARILI olur olmaz
// calisiyordu. `chrome.runtime.connect()` SW olu olsa bile SENKRON bir port
// dondurur (ve SW'yi uyandirir), yani "basari" neredeyse HER ZAMAN gerceklesir:
// gecikme hep 250 ms'de kalir, AZAMI_GECIKME_MS olu bir sabittir ve arka plan
// acilista firlatiyorsa (import hatasi, bozuk dist) arayuz saniyede DORT kez
// connect() cagirip SW'yi durmadan yeniden baslatir -- pil/CPU yakan sessiz
// dongu. Sifirlama artik "baglanti ~10 sn ayakta kaldi" kosuluna bagli.
describe('connectPopupPort -- ustel geri cekilme', () => {
    it('kisa dongude gecikme KATLANIR (sifirlama ANINDA olmaz)', () => {
        const { connect, portlar } = sahteChrome()
        connectPopupPort()

        portlar[0].kop()
        vi.advanceTimersByTime(250)
        expect(connect).toHaveBeenCalledTimes(2)

        // Baglanti ANINDA koptu: "kararli" esigine hic ulasmadi.
        portlar[1].kop()
        vi.advanceTimersByTime(250)
        // Sifirlama anlik olsaydi burada UCUNCU baglanti olurdu.
        expect(connect).toHaveBeenCalledTimes(2)

        vi.advanceTimersByTime(250)   // toplam 500 ms
        expect(connect).toHaveBeenCalledTimes(3)
    })

    it('gecikme AZAMI_GECIKME_MS (5 sn) ustune cikmaz', () => {
        const { connect, portlar } = sahteChrome()
        connectPopupPort()

        // 250 -> 500 -> 1000 -> 2000 -> 4000 -> 5000 (tavan)
        const beklenen = [250, 500, 1000, 2000, 4000, 5000, 5000]
        for (const ms of beklenen) {
            portlar[portlar.length - 1].kop()
            vi.advanceTimersByTime(ms - 1)
            const once = connect.mock.calls.length
            vi.advanceTimersByTime(1)
            expect(connect.mock.calls.length).toBe(once + 1)
        }
    })

    it('baglanti ~10 sn ayakta kalirsa gecikme SIFIRLANIR', () => {
        const { connect, portlar } = sahteChrome()
        connectPopupPort()

        // Once gecikmeyi buyut: bir kisa dongu turu (250 -> 500).
        portlar[0].kop()
        vi.advanceTimersByTime(250)
        expect(connect).toHaveBeenCalledTimes(2)

        // Bu baglanti TUTUYOR: normal isleyiste SW ~30 sn yasar.
        vi.advanceTimersByTime(10000)

        // Simdi kopsun: gecikme 500 degil, YENIDEN 250 olmali.
        portlar[1].kop()
        vi.advanceTimersByTime(249)
        expect(connect).toHaveBeenCalledTimes(2)
        vi.advanceTimersByTime(1)
        expect(connect).toHaveBeenCalledTimes(3)
    })

    it('stop() bekleyen "kararli" sayacini da temizler', () => {
        const { connect } = sahteChrome()
        const h = connectPopupPort()

        h.stop()
        // Sayac kalsaydi bile yeni bir baglanti uretmemeli: `durduruldu` nihaidir.
        vi.advanceTimersByTime(60000)
        expect(connect).toHaveBeenCalledTimes(1)
    })
})

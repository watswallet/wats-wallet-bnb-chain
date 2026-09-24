import { describe, it, expect } from 'vitest'
import { isDappRequestStale, SOLANA_REQUEST_TYPES } from './dappRequestGuard'

const EVM = { chainId: 1, rpc: [{ url: 'https://eth' }] }
const SOLANA = { chainId: 'solana-mainnet', vm: 'solana' }
const CONNECT = { type: 'CONNECT', id: 'r1' }
const SEND_TX = { type: 'SEND_TX', id: 'r2' }
const SIGN_MESSAGE = { type: 'SIGN_MESSAGE', id: 'r3' }

describe('isDappRequestStale', () => {
    it('istek yoksa BAYAT SAYILMAZ (kontrol edilecek bir sey yok)', () => {
        expect(isDappRequestStale(null, SOLANA)).toBe(false)
        expect(isDappRequestStale(undefined, EVM)).toBe(false)
    })

    // F1'in Task 15 raporundaki bulgusuyla AYNI ilke: taze bir cuzdanda henuz
    // currentNetwork diske yazilmamis olabilir; App.vue bu durumda zaten
    // varsayilan Ethereum'u YAZIP `currentNetwork`i doldurduktan SONRA bu
    // fonksiyonu cagirir (bkz. App.vue onMounted) -- burada dogrudan `undefined`
    // gecirilirse de evmOnlyFeatures(undefined) => hepsi kapali doner, yani
    // istek "bayat" sayilir. Bu KASITLI: chain cozulemiyorsa acik varsaymak
    // yanlis taraf.
    it.each([CONNECT, SEND_TX, SIGN_MESSAGE])('EVM aktifken istek ($type) BAYAT DEGIL', (req) => {
        expect(isDappRequestStale(req, EVM)).toBe(false)
    })

    it.each([SEND_TX, SIGN_MESSAGE])('Solana aktifken IMZA istegi ($type) BAYAT SAYILIR', (req) => {
        expect(isDappRequestStale(req, SOLANA)).toBe(true)
    })

    // CONNECT MUAF (kullanici bildirimi: "cuzdan en son gram aginda kalmissa
    // dapp ile evm'lere gecemiyor").
    //
    // Bu satirin dayandigi eski degismez COKTU. Eskiden "istek var AMA aktif ag
    // EVM degil" HER ZAMAN bayat bir kayitti, cunku boyle bir istek hicbir zaman
    // YENI YAZILAMAZDI: handleConnectWallet giriste CHAIN_NOT_EVM firlatirdi.
    // Artik firlatMIYOR -- pencereyi ACIYOR, cunku sessiz red kullaniciyi cikissiz
    // birakiyordu (dappFunctions.js'teki uzun not). Yani CONNECT icin
    // "EVM disi agda dogmus kayit" artik TAMAMEN GECERLI bir kullanici akisidir,
    // tipki SWITCH_CHAIN gibi.
    //
    // Muafiyet olmasaydi degisiklik HICBIR ISE YARAMAZDI: kayit diske yazilir,
    // pencere acilir ve App.vue onu acilir acilmaz bayat sayip SILERDI --
    // kullanici bos bir pencere gorur, dapp'in promise'i asili kalirdi. Tam da
    // SWITCH_CHAIN muafiyetinin onledigi ariza.
    //
    // KARDESLERI MUAF DEGIL (yukaridaki satir): SEND_TX ve SIGN_MESSAGE ekranlari
    // EVM'e ozeldir ve arka plandaki kapilari da hala firlatiyor, yani o tipte
    // EVM disi agda dogmus bir kayit HALA imkansiz -- bayat olmasi dogru.
    it('CONNECT istegi Solana aginda BAYAT DEGIL (onay ekrani cikisi gostermeli)', () => {
        expect(isDappRequestStale(CONNECT, SOLANA)).toBe(false)
    })

    it('CONNECT istegi TON aginda BAYAT DEGIL', () => {
        expect(isDappRequestStale(CONNECT, { chainId: -239, kind: 'ton' })).toBe(false)
    })

    it('CONNECT istegi zincir cozulemezse DE bayat degil (taze kurulum)', () => {
        expect(isDappRequestStale(CONNECT, null)).toBe(false)
    })

    it('zincir cozulemezse (null) istek BAYAT SAYILIR', () => {
        expect(isDappRequestStale(SEND_TX, null)).toBe(true)
    })

    // TON istekleri EVM kapisina TABI DEGIL: TonConnect oturumu aktif agdan
    // BAGIMSIZ (spec K3). Bu satirlar olmadan TON onay penceresi, kullanici TON
    // aginda olsa BILE acilir acilmaz siliniyordu -- evmOnlyFeatures(TON).dapp
    // false doner ve eski kod istegin TIPINE hic bakmiyordu.
    const TON_CONNECT = { type: 'TON_CONNECT', id: 't1' }
    const TON_SEND_TX = { type: 'TON_SEND_TX', id: 't2' }
    const TON_SIGN_DATA = { type: 'TON_SIGN_DATA', id: 't3' }
    const TON = { chainId: -239, kind: 'ton' }

    it.each([TON_CONNECT, TON_SEND_TX, TON_SIGN_DATA])('TON istegi ($type) EVM aginda BAYAT DEGIL', (req) => {
        expect(isDappRequestStale(req, EVM)).toBe(false)
    })

    it.each([TON_CONNECT, TON_SEND_TX, TON_SIGN_DATA])('TON istegi ($type) Solana aginda BAYAT DEGIL', (req) => {
        expect(isDappRequestStale(req, SOLANA)).toBe(false)
    })

    it.each([TON_CONNECT, TON_SEND_TX, TON_SIGN_DATA])('TON istegi ($type) TON aginda BAYAT DEGIL', (req) => {
        expect(isDappRequestStale(req, TON)).toBe(false)
    })

    it('TON istegi zincir cozulemezse DE bayat degil (aktif aga bakmiyor)', () => {
        expect(isDappRequestStale(TON_SEND_TX, null)).toBe(false)
    })

    it('EVM istekleri ESKI kuralda kalir: TON aginda bayat', () => {
        expect(isDappRequestStale(SEND_TX, TON)).toBe(true)
    })
})

describe('Solana onay istekleri aktif agdan BAGIMSIZDIR', () => {
    const SOLANA_CONNECT = { type: 'SOLANA_CONNECT', id: 's1' }
    const SOLANA_SIGN_TX = { type: 'SOLANA_SIGN_TX', id: 's2' }
    const SOLANA_SIGN_MESSAGE = { type: 'SOLANA_SIGN_MESSAGE', id: 's3' }
    const TON = { chainId: -239, kind: 'ton' }

    it('kume TAM OLARAK uc tipi sayar -- "EVM degilse muaftir" DENMEZ', () => {
        expect([...SOLANA_REQUEST_TYPES].sort()).toEqual(['SOLANA_CONNECT', 'SOLANA_SIGN_MESSAGE', 'SOLANA_SIGN_TX'])
    })

    // Bu muafiyet olmadan App.vue her Solana onay kaydini popup acilir acilmaz
    // BAYAT sayip SILIYORDU: evmOnlyFeatures(Solana).dapp false doner ve eski kod
    // istegin TIPINE hic bakmiyordu. Kullanici onay ekrani yerine bos pencere gorurdu.
    it.each([SOLANA_CONNECT, SOLANA_SIGN_TX, SOLANA_SIGN_MESSAGE])('Solana istegi ($type) Solana aginda BAYAT DEGIL', (req) => {
        expect(isDappRequestStale(req, SOLANA)).toBe(false)
    })

    // K6: oturum aktif agdan bagimsiz. Kullanici Ethereum'da dururken de bir Solana
    // dapp'ine baglanabilmeli -- window.solana ile window.ethereum ayri ad alanlari.
    it.each([SOLANA_CONNECT, SOLANA_SIGN_TX, SOLANA_SIGN_MESSAGE])('Solana istegi ($type) EVM aginda BAYAT DEGIL', (req) => {
        expect(isDappRequestStale(req, EVM)).toBe(false)
    })

    it.each([SOLANA_CONNECT, SOLANA_SIGN_TX, SOLANA_SIGN_MESSAGE])('Solana istegi ($type) TON aginda BAYAT DEGIL', (req) => {
        expect(isDappRequestStale(req, TON)).toBe(false)
    })

    it('Solana istegi zincir cozulemezse DE bayat degil', () => {
        expect(isDappRequestStale(SOLANA_SIGN_TX, null)).toBe(false)
    })

    it('EVM ve TON kurallari DEGISMEZ', () => {
        expect(isDappRequestStale(SEND_TX, SOLANA)).toBe(true)
        expect(isDappRequestStale({ type: 'TON_SEND_TX' }, SOLANA)).toBe(false)
    })
})

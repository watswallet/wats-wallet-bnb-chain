import { describe, it, expect } from 'vitest'
import { counterpartyAddress, counterpartyOf } from './historyCounterparty'

const ALICI = '0x1111111111111111111111111111111111111111'
const GONDEREN = '0x2222222222222222222222222222222222222222'
const TOKEN_KONTRATI = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SOL_KARSI = 'DrPbCbmxVNdk7maPM5tGv6MvB3v1sRMC86PZ8okm21hY'
const TON_KARSI = 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsMxNOT'

describe('counterpartyAddress — Solana satirlari', () => {
    it('giden islemde karsi tarafi doner', () => {
        expect(counterpartyAddress({ direction: 'out', counterparty: SOL_KARSI })).toBe(SOL_KARSI)
    })

    it('gelen islemde karsi tarafi doner', () => {
        expect(counterpartyAddress({ direction: 'in', counterparty: SOL_KARSI })).toBe(SOL_KARSI)
    })

    it('base58 adresi KUCULTMEZ (harf kasasi korunur)', () => {
        expect(counterpartyAddress({ direction: 'out', counterparty: SOL_KARSI })).not.toBe(SOL_KARSI.toLowerCase())
    })

    // Kendine transferde karsi taraf KENDIMIZ. Kendi adresimizi "kiminle" satirina
    // yazmak bilgi degil gurultu: baslik zaten "Kendine Transfer" diyor.
    it('kendine transferde null doner', () => {
        expect(counterpartyAddress({ direction: 'self', counterparty: SOL_KARSI })).toBeNull()
    })
})

describe('counterpartyAddress — EVM satirlari', () => {
    it('native gonderimde islemin hedefi karsi taraftir', () => {
        const tx = {
            category: 'send',
            to_address: ALICI,
            from_address: GONDEREN,
            native_transfers: [{ direction: 'send', to_address: ALICI, from_address: GONDEREN }],
        }
        expect(counterpartyAddress(tx)).toBe(ALICI)
    })

    // KRITIK: ERC20 gonderiminde islemin to_address'i TOKEN KONTRATIDIR, alici DEGIL.
    // Kontrat adresini "kime gonderdin" diye gostermek duz bir yalandir.
    it('token gonderiminde transfer bacagindaki aliciyi doner, token kontratini DEGIL', () => {
        const tx = {
            category: 'token send',
            to_address: TOKEN_KONTRATI,
            from_address: GONDEREN,
            erc20_transfers: [{ direction: 'send', to_address: ALICI, from_address: GONDEREN }],
        }
        expect(counterpartyAddress(tx)).toBe(ALICI)
        expect(counterpartyAddress(tx)).not.toBe(TOKEN_KONTRATI)
    })

    it('token aliminda transfer bacagindaki gondereni doner', () => {
        const tx = {
            category: 'receive',
            to_address: TOKEN_KONTRATI,
            from_address: GONDEREN,
            erc20_transfers: [{ direction: 'receive', to_address: ALICI, from_address: GONDEREN }],
        }
        expect(counterpartyAddress(tx)).toBe(GONDEREN)
    })

    it('bekleyen yerel iskeletin "native send" kategorisi de gonderim sayilir', () => {
        const tx = {
            category: 'native send',
            to_address: ALICI,
            from_address: GONDEREN,
            native_transfers: [{ direction: 'send', to_address: ALICI }],
        }
        expect(counterpartyAddress(tx)).toBe(ALICI)
    })

    // Takas/izin/kopru satirlarinda karsi taraf bir YONLENDIRICI SOZLESMEDIR.
    // Kullaniciya hicbir sey anlatmaz; bos donulur ki satir baska bir sey gostersin.
    it('takas satirinda null doner', () => {
        expect(counterpartyAddress({ category: 'token swap', to_address: TOKEN_KONTRATI })).toBeNull()
    })

    it('izin (approve) satirinda null doner', () => {
        expect(counterpartyAddress({ category: 'approve', to_address: TOKEN_KONTRATI })).toBeNull()
    })

    it('kopru satirinda null doner', () => {
        expect(counterpartyAddress({ category: 'bridge', to_address: TOKEN_KONTRATI })).toBeNull()
    })

    it('taninmayan kategoride null doner (yanlis taraf gostermektense hic gosterme)', () => {
        expect(counterpartyAddress({ category: 'contract interaction', to_address: TOKEN_KONTRATI })).toBeNull()
        expect(counterpartyAddress({ to_address: TOKEN_KONTRATI })).toBeNull()
    })
})

describe('counterpartyAddress — TON satirlari', () => {
    // tonHistoryView.js from_address/to_address'i GERCEK taraflarla doldurur;
    // erc20_transfers bacaklarinda adres alani HIC YOKTUR.
    it('giden TON satirinda to_address doner', () => {
        const tx = {
            chainId: -239,
            category: 'send',
            from_address: 'BENIM',
            to_address: TON_KARSI,
            erc20_transfers: [{ direction: 'send', value_formatted: '12', token_symbol: 'GRAM' }],
        }
        expect(counterpartyAddress(tx)).toBe(TON_KARSI)
    })

    it('gelen TON satirinda from_address doner', () => {
        const tx = {
            chainId: -239,
            category: 'receive',
            from_address: TON_KARSI,
            to_address: 'BENIM',
            erc20_transfers: [{ direction: 'receive', value_formatted: '12', token_symbol: 'GRAM' }],
        }
        expect(counterpartyAddress(tx)).toBe(TON_KARSI)
    })
})

describe('counterpartyAddress — savunma', () => {
    it('bos/eksik girdide FIRLATMAZ', () => {
        expect(counterpartyAddress(null)).toBeNull()
        expect(counterpartyAddress(undefined)).toBeNull()
        expect(counterpartyAddress({})).toBeNull()
    })
})

describe('counterpartyOf — adres + insan-okur etiket', () => {
    const hesaplar = [{ name: 'Yedek Hesabim', address: ALICI }]
    const defter = [{ label: 'Ahmet', address: GONDEREN }]

    it('kendi hesap adi ONCE gelir', () => {
        const tx = { category: 'send', to_address: ALICI, native_transfers: [{ direction: 'send', to_address: ALICI }] }
        expect(counterpartyOf(tx, { accounts: hesaplar, savedAddresses: defter }))
            .toEqual({ address: ALICI, label: 'Yedek Hesabim' })
    })

    it('adres defteri etiketi kullanilir', () => {
        const tx = { category: 'receive', from_address: GONDEREN, native_transfers: [{ direction: 'receive', from_address: GONDEREN }] }
        expect(counterpartyOf(tx, { accounts: hesaplar, savedAddresses: defter }))
            .toEqual({ address: GONDEREN, label: 'Ahmet' })
    })

    it('taninmayan adreste etiket null doner, adres yine doner', () => {
        const yabanci = '0x3333333333333333333333333333333333333333'
        const tx = { category: 'send', to_address: yabanci, native_transfers: [{ direction: 'send', to_address: yabanci }] }
        expect(counterpartyOf(tx, { accounts: hesaplar, savedAddresses: defter }))
            .toEqual({ address: yabanci, label: null })
    })

    // Moralis'in to_address_label alani ISLEMIN HEDEFINI etiketler. Native
    // gonderimde hedef = alici, yani etiket dogrudur.
    it('native gonderimde saglayici etiketi (orn. borsa adi) kullanilir', () => {
        const borsa = '0x4444444444444444444444444444444444444444'
        const tx = { category: 'send', to_address: borsa, to_address_label: 'Kraken', native_transfers: [{ direction: 'send', to_address: borsa }] }
        expect(counterpartyOf(tx, {})).toEqual({ address: borsa, label: 'Kraken' })
    })

    // KRITIK: ERC20 gonderiminde to_address_label TOKEN KONTRATINI etiketler
    // ("USD Coin"). Onu alici ismi diye basmak duz bir yalan olurdu.
    it('token gonderiminde saglayici etiketi KULLANILMAZ (o etiket token kontratinindir)', () => {
        const tx = {
            category: 'token send',
            to_address: TOKEN_KONTRATI,
            to_address_label: 'USD Coin',
            erc20_transfers: [{ direction: 'send', to_address: ALICI }],
        }
        expect(counterpartyOf(tx, {})).toEqual({ address: ALICI, label: null })
    })

    it('adres defteri etiketi saglayici etiketini EZER (kullanicinin kendi adlandirmasi oncelikli)', () => {
        const tx = { category: 'send', to_address: GONDEREN, to_address_label: 'Kraken', native_transfers: [{ direction: 'send', to_address: GONDEREN }] }
        expect(counterpartyOf(tx, { savedAddresses: defter })).toEqual({ address: GONDEREN, label: 'Ahmet' })
    })

    it('karsi tarafi olmayan satirda (takas) null doner', () => {
        expect(counterpartyOf({ category: 'token swap', to_address: TOKEN_KONTRATI }, {})).toBeNull()
    })

    it('liste verilmese de FIRLATMAZ', () => {
        const tx = { category: 'send', to_address: ALICI, native_transfers: [{ direction: 'send', to_address: ALICI }] }
        expect(counterpartyOf(tx)).toEqual({ address: ALICI, label: null })
    })
})

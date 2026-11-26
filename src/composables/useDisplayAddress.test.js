import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { pickDisplayAddress, pickNetworkWarningKey, warningKeyForKind, buildAddressRows } from './useDisplayAddress'

const EVM = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const TON = 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P'

describe('pickDisplayAddress', () => {
    it('EVM aginda EVM adresi gosterilir', () => {
        expect(pickDisplayAddress({ chain: { chainId: 1 }, evmAddress: EVM, tonAddress: TON })).toBe(EVM)
    })

    it('TON aginda TON adresi gosterilir', () => {
        expect(pickDisplayAddress({ chain: { chainId: -239, kind: 'ton' }, evmAddress: EVM, tonAddress: TON })).toBe(TON)
    })

    it('TON aginda TON adresi HENUZ YOKSA hicbir sey gosterilmez', () => {
        // 0x'e geri dusmek yasak: kullanici TON'u EVM adresine gonderir ve para gider.
        expect(pickDisplayAddress({ chain: { chainId: -239, kind: 'ton' }, evmAddress: EVM, tonAddress: null })).toBeNull()
        expect(pickDisplayAddress({ chain: { chainId: -239, kind: 'ton' }, evmAddress: EVM, tonAddress: '' })).toBeNull()
    })

    it('zincir cozulemediginde EVM adresi gosterilir', () => {
        expect(pickDisplayAddress({ chain: null, evmAddress: EVM, tonAddress: TON })).toBe(EVM)
    })

    it('hicbir adres yoksa null doner', () => {
        expect(pickDisplayAddress({ chain: { chainId: 1 }, evmAddress: null, tonAddress: null })).toBeNull()
    })
})

// K4: uyari anahtari ve aktif satir kindOf tabanli. "ton degilse EVM" bicimi, Solana'yi
// sessizce EVM sayar: Solana adresinin altinda "EVM uyumlu aglardan gonderin" yazar
// ve kullanici varligi yanlis agdan gonderip KALICI OLARAK kaybeder.
const SOL = { chainId: 'solana-mainnet', vm: 'solana', name: 'Solana' }
const EVM_CHAIN = { chainId: 1, name: 'Ethereum' }
const TON_CHAIN = { chainId: -239, kind: 'ton', name: 'TON' }

describe('pickNetworkWarningKey — kindOf tabanli (K4)', () => {
    it('Solana zinciri icin Solana anahtari doner (kimlik metin ya da kayit)', () => {
        expect(pickNetworkWarningKey('solana-mainnet')).toBe('warning_network_bold_solana')
        expect(pickNetworkWarningKey(SOL)).toBe('warning_network_bold_solana')
    })

    it('EVM ve TON AYNEN kalir', () => {
        expect(pickNetworkWarningKey(EVM_CHAIN)).toBe('warning_network_bold')
        expect(pickNetworkWarningKey(1)).toBe('warning_network_bold')
        expect(pickNetworkWarningKey(TON_CHAIN)).toBe('warning_network_bold_ton')
        expect(pickNetworkWarningKey(-239)).toBe('warning_network_bold_ton')
        expect(pickNetworkWarningKey(null)).toBe('warning_network_bold')
    })

    it('warningKeyForKind("solana") Solana anahtarini verir, EVM/TON ayni', () => {
        expect(warningKeyForKind('solana')).toBe('warning_network_bold_solana')
        expect(warningKeyForKind('ton')).toBe('warning_network_bold_ton')
        expect(warningKeyForKind('evm')).toBe('warning_network_bold')
    })

    it('uc anahtar da 12 dilin hepsinde var (popups.receive)', () => {
        const diller = ['en', 'tr', 'de', 'es', 'fr', 'id', 'ja', 'ko', 'pt-BR', 'ru', 'vi', 'zh-CN']
        for (const d of diller) {
            const json = JSON.parse(readFileSync(new URL(`../i18n/locales/${d}.json`, import.meta.url), 'utf-8'))
            const r = json.popups.receive
            for (const k of ['warning_network_bold', 'warning_network_bold_ton', 'warning_network_bold_solana']) {
                expect(typeof r[k], `${d}:${k}`).toBe('string')
                expect(r[k].trim(), `${d}:${k}`).not.toBe('')
            }
        }
    })
})

describe('buildAddressRows — aktif satir kindOf tabanli (K4)', () => {
    const args = { evmAddress: '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d', tonAddress: TON, tonSupported: true }

    it('Solana zincirinde HICBIR satir active degil', () => {
        const rows = buildAddressRows({ chain: SOL, ...args })
        expect(rows.map(r => r.kind)).toEqual(['evm', 'ton'])
        expect(rows.some(r => r.active)).toBe(false)
        expect(buildAddressRows({ chain: 'solana-mainnet', ...args }).some(r => r.active)).toBe(false)
    })

    it('EVM zincirinde yalniz EVM, TON zincirinde yalniz TON satiri active (regresyon)', () => {
        const evm = buildAddressRows({ chain: EVM_CHAIN, ...args })
        expect(evm.find(r => r.kind === 'evm').active).toBe(true)
        expect(evm.find(r => r.kind === 'ton').active).toBe(false)
        const ton = buildAddressRows({ chain: TON_CHAIN, ...args })
        expect(ton.find(r => r.kind === 'evm').active).toBe(false)
        expect(ton.find(r => r.kind === 'ton').active).toBe(true)
    })

    it('zincir cozulemezse (null) EVM satiri aktif kalir — bugunku davranis', () => {
        const rows = buildAddressRows({ chain: null, ...args })
        expect(rows.find(r => r.kind === 'evm').active).toBe(true)
    })
})

describe('kaynak — "ton degilse EVM" bicimi yok (K4)', () => {
    it('useDisplayAddress.js isTon ? ... : evm bicimini ve !ton aktifligini icermez', () => {
        const src = readFileSync(new URL('./useDisplayAddress.js', import.meta.url), 'utf-8')
        const kod = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
        expect(kod).not.toMatch(/isTon\(chain\)\s*\?\s*'ton'\s*:\s*'evm'/)
        expect(kod).not.toMatch(/active:\s*!ton/)
    })
})

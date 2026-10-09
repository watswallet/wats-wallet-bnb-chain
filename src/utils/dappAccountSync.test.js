// dappAccountSync: hibe kurallarinin saf mantigi (spec 6 G4, D1 = A).
import { describe, it, expect } from 'vitest'
import {
    isSameAddress,
    resolveFollowActive,
    orderGrantedAccounts,
    resolveDappRecord,
    findGrantedAccount,
    applyManualAccountEdit,
    planAccountSwitch,
} from './dappAccountSync.js'

const A = '0xAaaa000000000000000000000000000000000001'
const B = '0xBbbb000000000000000000000000000000000002'
const C = '0xCccc000000000000000000000000000000000003'
const TON = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'

describe('isSameAddress', () => {
    it('harf duyarsiz esitlik', () => {
        expect(isSameAddress(A, A.toLowerCase())).toBe(true)
        expect(isSameAddress(A, B)).toBe(false)
    })
    it('bos ve dize olmayan degerler ASLA esit sayilmaz', () => {
        expect(isSameAddress('', '')).toBe(false)
        expect(isSameAddress(undefined, undefined)).toBe(false)
        expect(isSameAddress(null, A)).toBe(false)
        expect(isSameAddress(5, 5)).toBe(false)
    })
})

describe('resolveFollowActive', () => {
    it('alan yoksa izler, true izler, YALNIZ false izlemez', () => {
        expect(resolveFollowActive({ accounts: [A] })).toBe(true)
        expect(resolveFollowActive({ followActive: true })).toBe(true)
        expect(resolveFollowActive({ followActive: false })).toBe(false)
    })
    it('kayit nesne degilse izlenecek bir sey yok', () => {
        expect(resolveFollowActive(undefined)).toBe(false)
        expect(resolveFollowActive(null)).toBe(false)
        expect(resolveFollowActive('x')).toBe(false)
    })
})

describe('orderGrantedAccounts', () => {
    it('aktif hesap izinliyse basa gelir, kalan sira korunur', () => {
        expect(orderGrantedAccounts([A, B, C], B)).toEqual([B, A, C])
        expect(orderGrantedAccounts([A, B, C], C)).toEqual([C, A, B])
    })
    it('aktif zaten basta ya da izinli degilse sira degismez', () => {
        expect(orderGrantedAccounts([A, B], A)).toEqual([A, B])
        expect(orderGrantedAccounts([A, B], C)).toEqual([A, B])
        expect(orderGrantedAccounts([A, B], undefined)).toEqual([A, B])
    })
    it('aktif adres harf duyarsiz eslesir ve SAKLANAN yazimi korunur', () => {
        expect(orderGrantedAccounts([A, B], B.toLowerCase())).toEqual([B, A])
    })
    it('tekrarlar (harf duyarsiz) ve dize olmayanlar atilir', () => {
        expect(orderGrantedAccounts([A, A.toLowerCase(), 5, null, '', B], undefined)).toEqual([A, B])
    })
    it('dizi degilse bos dizi; girdiyi DEGISTIRMEZ', () => {
        expect(orderGrantedAccounts(undefined, A)).toEqual([])
        expect(orderGrantedAccounts('x', A)).toEqual([])
        const girdi = [A, B]
        orderGrantedAccounts(girdi, B)
        expect(girdi).toEqual([A, B])
    })
})

describe('resolveDappRecord / findGrantedAccount', () => {
    const dapps = {
        'app.x.io': { accounts: [A, B], origin: 'https://app.x.io' },
        'eski.io': { accounts: [A] },
        'localhost': { accounts: [B], origin: 'http://localhost:5173' },
    }

    it('saklanan tam origin ile ayni origin kaydi cozer', () => {
        expect(resolveDappRecord(dapps, 'https://app.x.io').hostname).toBe('app.x.io')
    })
    it('kayitta origin YOKSA hostname esitligine dusulur (eski kayit)', () => {
        expect(resolveDappRecord(dapps, 'https://eski.io').record.accounts).toEqual([A])
        expect(resolveDappRecord(dapps, 'http://eski.io:8080')).not.toBeNull()
    })
    it('ayni hostname FARKLI sema veya port ise null (kayitta origin varsa)', () => {
        expect(resolveDappRecord(dapps, 'http://app.x.io')).toBeNull()
        expect(resolveDappRecord(dapps, 'https://app.x.io:8443')).toBeNull()
        expect(resolveDappRecord(dapps, 'http://localhost:3000')).toBeNull()
        expect(resolveDappRecord(dapps, 'http://localhost:5173')).not.toBeNull()
    })
    it('varsayilan port yazimi normalize edilir', () => {
        expect(resolveDappRecord(dapps, 'https://app.x.io:443')).not.toBeNull()
    })
    it('kayitta bozuk origin varsa fail-closed (null)', () => {
        expect(resolveDappRecord({ 'a.io': { accounts: [A], origin: 'bozuk' } }, 'https://a.io')).toBeNull()
    })
    it('Unknown, null, bos ve bozuk origin null; kayit yok null', () => {
        for (const o of ['Unknown', 'null', '', undefined, 42, 'not a url']) {
            expect(resolveDappRecord(dapps, o)).toBeNull()
        }
        expect(resolveDappRecord(dapps, 'https://yok.io')).toBeNull()
    })
    it('prototip anahtarlari kayit SAYILMAZ', () => {
        expect(resolveDappRecord({}, 'https://constructor')).toBeNull()
        expect(resolveDappRecord({}, 'https://tostring')).toBeNull()
        expect(resolveDappRecord(undefined, 'https://a.io')).toBeNull()
    })

    it('findGrantedAccount: izinli adresi SAKLANAN yazimla doner (harf duyarsiz)', () => {
        expect(findGrantedAccount(dapps, 'https://app.x.io', B.toLowerCase())).toBe(B)
    })
    it('findGrantedAccount: izinsiz adres ve eslesmeyen origin null', () => {
        expect(findGrantedAccount(dapps, 'https://app.x.io', C)).toBeNull()
        expect(findGrantedAccount(dapps, 'http://app.x.io', A)).toBeNull()
    })
    it('findGrantedAccount: adres verilmezse kayittaki ILK hesap', () => {
        expect(findGrantedAccount(dapps, 'https://app.x.io')).toBe(A)
        expect(findGrantedAccount(dapps, 'https://app.x.io', '')).toBe(A)
        expect(findGrantedAccount(dapps, 'https://app.x.io', null)).toBe(A)
    })
    it('findGrantedAccount: bos hesap listesi null', () => {
        expect(findGrantedAccount({ 'a.io': { accounts: [] } }, 'https://a.io')).toBeNull()
        expect(findGrantedAccount({ 'a.io': {} }, 'https://a.io', A)).toBeNull()
    })
})

describe('applyManualAccountEdit', () => {
    it('hesap kumesi DEGISTIYSE followActive false olur, digerleri korunur', () => {
        const kayit = { accounts: [A], followActive: true, followedAt: 5, origin: 'https://x.io', favicon: 'f', gasless: true, allowedChains: [1] }
        const sonuc = applyManualAccountEdit(kayit, [A, B])
        expect(sonuc).toEqual({ ...kayit, accounts: [A, B], followActive: false })
    })
    it('bayrak yokken de false yazilir', () => {
        expect(applyManualAccountEdit({ accounts: [A] }, [B]).followActive).toBe(false)
    })
    it('hesap kumesi AYNI kaldiysa (yalniz zincir duzenlendi) bayrak ve hesaplar DEGISMEZ', () => {
        const kayit = { accounts: [A, B], followActive: true }
        expect(applyManualAccountEdit(kayit, [B.toLowerCase(), A])).toEqual({ accounts: [A, B], followActive: true })
        expect(applyManualAccountEdit({ accounts: [A] }, [A])).toEqual({ accounts: [A] })
    })
    it('girdi kaydi DEGISTIRMEZ', () => {
        const kayit = { accounts: [A], followActive: true }
        applyManualAccountEdit(kayit, [B])
        expect(kayit).toEqual({ accounts: [A], followActive: true })
    })
    it('girilen listede tekrar ve dize olmayanlar atilir', () => {
        expect(applyManualAccountEdit({ accounts: [A] }, [B, B.toLowerCase(), 5]).accounts).toEqual([B])
    })
    it('kayit nesne degilse bos kayittan baslar', () => {
        expect(applyManualAccountEdit(undefined, [A])).toEqual({ accounts: [A], followActive: false })
    })
})

describe('planAccountSwitch -- takip eden site', () => {
    const acik = ['site.com']
    const girdi = (kayit, ekstra = {}) => ({
        dapps: { 'site.com': kayit },
        previousAddress: A,
        nextAddress: B,
        openHostnames: acik,
        now: 1234,
        ...ekstra,
    })

    it('accounts TAM [previous] ve bayrak yoksa: [next] yazilir (degistir), followedAt, bildirim', () => {
        const plan = planAccountSwitch(girdi({ accounts: [A], origin: 'https://site.com' }))
        expect(plan.writes).toEqual({ 'site.com': { accounts: [B], followedAt: 1234 } })
        expect(plan.notifications).toEqual([{ hostnames: ['site.com'], accounts: [B] }])
        expect(plan.permissionLost).toEqual([{ hostname: 'site.com', origin: 'https://site.com' }])
    })
    it('eski kayitta origin yoksa permissionLost.origin null', () => {
        expect(planAccountSwitch(girdi({ accounts: [A] })).permissionLost).toEqual([{ hostname: 'site.com', origin: null }])
    })
    it('followActive true acikca verilmis olsa da izler', () => {
        expect(planAccountSwitch(girdi({ accounts: [A], followActive: true })).writes['site.com'].accounts).toEqual([B])
    })
    it('previous harf duyarsiz eslesir', () => {
        const plan = planAccountSwitch(girdi({ accounts: [A.toLowerCase()] }))
        expect(plan.writes['site.com'].accounts).toEqual([B])
    })
    it('followActive FALSE ise izlemez: next izinli degil -> hicbir sey', () => {
        const plan = planAccountSwitch(girdi({ accounts: [A], followActive: false }))
        expect(plan).toEqual({ writes: {}, notifications: [], permissionLost: [] })
    })
    it('[previous] DEGIL, [B] (kullanici bilerek yalniz B verdi): kayit tasinmaz', () => {
        const plan = planAccountSwitch(girdi({ accounts: [B] }, { previousAddress: A, nextAddress: C }))
        expect(plan).toEqual({ writes: {}, notifications: [], permissionLost: [] })
    })
    it('birden cok hesabi olan kayit izlemez (yalniz siralanir)', () => {
        const plan = planAccountSwitch(girdi({ accounts: [A, B] }))
        expect(plan.writes['site.com']).toEqual({ accounts: [B, A] })
        expect(plan.permissionLost).toEqual([])
    })
})

describe('planAccountSwitch -- takip etmeyen acik site', () => {
    it('next izinli ve basta degil: aktif basa alinir, yazilir, bildirilir', () => {
        const plan = planAccountSwitch({
            dapps: { 'site.com': { accounts: [A, B], followActive: false } },
            previousAddress: A, nextAddress: B, openHostnames: ['site.com'],
        })
        expect(plan.writes).toEqual({ 'site.com': { accounts: [B, A] } })
        expect(plan.notifications).toEqual([{ hostnames: ['site.com'], accounts: [B, A] }])
        expect(plan.permissionLost).toEqual([])
    })
    it('saklanan sira zaten yeni sira ([B,A], previous A): YAZMA yok ama dapp [A,B] gormustu -> BILDIRIM [B,A]', () => {
        const plan = planAccountSwitch({
            dapps: { 'site.com': { accounts: [B, A] } },
            previousAddress: A, nextAddress: B, openHostnames: ['site.com'],
        })
        expect(plan.writes).toEqual({})
        expect(plan.notifications).toEqual([{ hostnames: ['site.com'], accounts: [B, A] }])
        expect(plan.permissionLost).toEqual([])
    })
    it('ayna: saklanan [A,B], previous B, next A -> yazma yok, bildirim [A,B] (dapp [B,A] gormustu)', () => {
        const plan = planAccountSwitch({
            dapps: { 'site.com': { accounts: [A, B], followActive: false } },
            previousAddress: B, nextAddress: A, openHostnames: ['site.com'],
        })
        expect(plan.writes).toEqual({})
        expect(plan.notifications).toEqual([{ hostnames: ['site.com'], accounts: [A, B] }])
    })
    it('dapp zaten yeni listeyi goruyorsa ([A,B], previous C izinsiz, next A) bildirim YOK', () => {
        const plan = planAccountSwitch({
            dapps: { 'site.com': { accounts: [A, B] } },
            previousAddress: C, nextAddress: A, openHostnames: ['site.com'],
        })
        expect(plan).toEqual({ writes: {}, notifications: [], permissionLost: [] })
    })
    it('suppressUnchanged: yazimsiz bildirim kapatilir (ayni olayin tekrar teslimi), yazimli olan etkilenmez', () => {
        const kapali = planAccountSwitch({
            dapps: { 'site.com': { accounts: [B, A] } },
            previousAddress: A, nextAddress: B, openHostnames: ['site.com'], suppressUnchanged: true,
        })
        expect(kapali).toEqual({ writes: {}, notifications: [], permissionLost: [] })
        const yazimli = planAccountSwitch({
            dapps: { 'site.com': { accounts: [A, B] } },
            previousAddress: A, nextAddress: B, openHostnames: ['site.com'], suppressUnchanged: true,
        })
        expect(yazimli.writes).toEqual({ 'site.com': { accounts: [B, A] } })
        expect(yazimli.notifications).toHaveLength(1)
    })
    it('hostname __proto__ ise yazim sessizce dusmez ve prototip bozulmaz (kayit atlanir)', () => {
        const dapps = JSON.parse('{"__proto__": {"accounts": ["' + A + '"]}, "a.com": {"accounts": ["' + A + '"]}}')
        const plan = planAccountSwitch({ dapps, previousAddress: A, nextAddress: B, openHostnames: ['__proto__', 'a.com'] })
        expect(Object.keys(plan.writes)).toEqual(['a.com'])
        expect(Object.getPrototypeOf(plan.writes)).toBeNull()
    })
    it('next izinli DEGIL: HICBIR SEY (sizinti yok)', () => {
        const plan = planAccountSwitch({
            dapps: { 'site.com': { accounts: [A, B], followActive: false } },
            previousAddress: A, nextAddress: C, openHostnames: ['site.com'],
        })
        expect(plan).toEqual({ writes: {}, notifications: [], permissionLost: [] })
    })
})

describe('planAccountSwitch -- uyuyan siteler ve sinirlar', () => {
    it('acik sekmesi OLMAYAN sitenin kaydina dokunulmaz, bildirilmez', () => {
        const plan = planAccountSwitch({
            dapps: { 'uyuyan.com': { accounts: [A] }, 'acik.com': { accounts: [A] } },
            previousAddress: A, nextAddress: B, openHostnames: ['acik.com'],
        })
        expect(Object.keys(plan.writes)).toEqual(['acik.com'])
        expect(plan.notifications).toEqual([{ hostnames: ['acik.com'], accounts: [B] }])
    })
    it('openHostnames bos ya da yoksa plan bos', () => {
        const dapps = { 'a.com': { accounts: [A] } }
        for (const open of [[], undefined, new Set()]) {
            expect(planAccountSwitch({ dapps, previousAddress: A, nextAddress: B, openHostnames: open }))
                .toEqual({ writes: {}, notifications: [], permissionLost: [] })
        }
    })
    it('openHostnames Set de kabul edilir', () => {
        const plan = planAccountSwitch({
            dapps: { 'a.com': { accounts: [A] } }, previousAddress: A, nextAddress: B, openHostnames: new Set(['a.com']),
        })
        expect(plan.writes['a.com'].accounts).toEqual([B])
    })
    it('previous == next (harf duyarsiz; yeniden adlandirma) -> bos plan', () => {
        const plan = planAccountSwitch({
            dapps: { 'a.com': { accounts: [A] } }, previousAddress: A, nextAddress: A.toLowerCase(), openHostnames: ['a.com'],
        })
        expect(plan).toEqual({ writes: {}, notifications: [], permissionLost: [] })
    })
    it('nextAddress yoksa ya da dapps bozuksa bos plan', () => {
        const bos = { writes: {}, notifications: [], permissionLost: [] }
        expect(planAccountSwitch({ dapps: { 'a.com': { accounts: [A] } }, previousAddress: A, nextAddress: '', openHostnames: ['a.com'] })).toEqual(bos)
        expect(planAccountSwitch({ dapps: undefined, previousAddress: A, nextAddress: B, openHostnames: ['a.com'] })).toEqual(bos)
        expect(planAccountSwitch()).toEqual(bos)
    })
    it('bozuk kayit (nesne degil) atlanir, digerleri islenir', () => {
        const plan = planAccountSwitch({
            dapps: { 'bozuk.com': 'x', 'a.com': { accounts: [A] } }, previousAddress: A, nextAddress: B, openHostnames: ['bozuk.com', 'a.com'],
        })
        expect(Object.keys(plan.writes)).toEqual(['a.com'])
    })
    it('girdi dapps DEGISTIRILMEZ (saf)', () => {
        const dapps = { 'a.com': { accounts: [A] } }
        planAccountSwitch({ dapps, previousAddress: A, nextAddress: B, openHostnames: ['a.com'] })
        expect(dapps).toEqual({ 'a.com': { accounts: [A] } })
    })
    it('now verilmezse followedAt bir sayidir', () => {
        const plan = planAccountSwitch({
            dapps: { 'a.com': { accounts: [A] } }, previousAddress: A, nextAddress: B, openHostnames: ['a.com'],
        })
        expect(typeof plan.writes['a.com'].followedAt).toBe('number')
    })
})

describe('planAccountSwitch -- bildirim gruplama', () => {
    it('ayni yuku alan siteler TEK grupta, farkli yuk ayri grupta', () => {
        const plan = planAccountSwitch({
            dapps: {
                'bir.com': { accounts: [A] },
                'iki.com': { accounts: [A] },
                'cok.com': { accounts: [A, B], followActive: false },
            },
            previousAddress: A, nextAddress: B, openHostnames: ['bir.com', 'iki.com', 'cok.com'],
        })
        expect(plan.notifications).toEqual([
            { hostnames: ['bir.com', 'iki.com'], accounts: [B] },
            { hostnames: ['cok.com'], accounts: [B, A] },
        ])
    })
})

describe('planAccountSwitch -- EVM adresi olmayan hesap', () => {
    it('EVM -> TON: kayitlar DEGISMEZ, acik bagli sitelere accountsChanged([])', () => {
        const plan = planAccountSwitch({
            dapps: { 'acik.com': { accounts: [A] }, 'uyuyan.com': { accounts: [A] } },
            previousAddress: A, nextAddress: TON, openHostnames: ['acik.com'],
        })
        expect(plan.writes).toEqual({})
        expect(plan.permissionLost).toEqual([])
        expect(plan.notifications).toEqual([{ hostnames: ['acik.com'], accounts: [] }])
    })
    it('TON -> TON: dapp zaten [] almisti, tekrar BILDIRILMEZ', () => {
        const plan = planAccountSwitch({
            dapps: { 'acik.com': { accounts: [A] } },
            previousAddress: TON, nextAddress: 'UQother', openHostnames: ['acik.com'],
        })
        expect(plan.notifications).toEqual([])
    })
    it('TON -> EVM: [next] izinli site siralari ayni olsa bile accountsChanged alir (donus)', () => {
        const plan = planAccountSwitch({
            dapps: { 'acik.com': { accounts: [A] }, 'baska.com': { accounts: [B] } },
            previousAddress: TON, nextAddress: A, openHostnames: ['acik.com', 'baska.com'],
        })
        expect(plan.writes).toEqual({})
        expect(plan.notifications).toEqual([{ hostnames: ['acik.com'], accounts: [A] }])
    })
    it('TON -> EVM: izin sahibi olmayan acik siteye HICBIR SEY gitmez', () => {
        const plan = planAccountSwitch({
            dapps: { 'baska.com': { accounts: [B] } },
            previousAddress: TON, nextAddress: A, openHostnames: ['baska.com'],
        })
        expect(plan.notifications).toEqual([])
    })
    it('isEvmAddress enjekte edilebilir', () => {
        const plan = planAccountSwitch({
            dapps: { 'a.com': { accounts: ['sol1'] } },
            previousAddress: 'sol1', nextAddress: 'sol2', openHostnames: ['a.com'],
            isEvmAddress: (v) => v.startsWith('sol'),
        })
        expect(plan.writes['a.com'].accounts).toEqual(['sol2'])
    })
})

describe('planAccountSwitch -- bildirim yuku EVM suzgecinden gecer', () => {
    it('kayitta eski bir UQ girdisi varsa dapp e GITMEZ', () => {
        const plan = planAccountSwitch({
            dapps: { 'a.com': { accounts: [A, TON, B], followActive: false } },
            previousAddress: A, nextAddress: B, openHostnames: ['a.com'],
        })
        expect(plan.notifications).toEqual([{ hostnames: ['a.com'], accounts: [B, A] }])
        expect(plan.writes['a.com'].accounts).toEqual([B, A, TON])
    })
})


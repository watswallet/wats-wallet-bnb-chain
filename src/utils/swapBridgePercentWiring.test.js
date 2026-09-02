import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// TAKAS VE KOPRU YUZDE CIPLERI - BAGLANTI TESTLERI.
//
// Duzeltilen hata: iki ekranda da MAX TAM bakiyeyi yaziyordu. Native girdide bu
// bir cikmazdi - "yetersiz gaz" kirmiziya donuyor, dugme kilitleniyor ve MAX
// hicbir zaman tamamlanamiyordu. Gonder ekraninda ayni hata bir kez zaten
// duzeltilmisti; Swap.vue'daki yorum bunu yaziyor.
//
// Saf katmanlar (sendPercent.js, nativeReserve.js) kendi dosyalarinda test
// ediliyor. Burasi cagrilarin GERCEKTEN yerinde oldugunu olcer.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const SWAP = codeOnly(read('../components/Swap.vue'))
const BRIDGE = codeOnly(read('../components/Bridge.vue'))

// Bir cagrinin gonderdigi bagimsiz degiskenleri kabaca kesip cikarir.
const callArgs = (src, needle, closing) => {
    const at = src.indexOf(needle)
    expect(at).toBeGreaterThan(-1)
    return src.slice(at, src.indexOf(closing, at) + closing.length)
}

describe.each([
    ['Takas', SWAP, 'swapReserve', 'inTokenAmount.value = clampToDecimals('],
    ['Kopru', BRIDGE, 'bridgeReserve', 'amount.value = clampToDecimals('],
])('%s ekrani', (_name, SRC, reserveFn, assignment) => {
    it('cipler SEND_PERCENTS uzerinden uretilir', () => {
        expect(SRC).toContain('v-for="percent in SEND_PERCENTS"')
        expect(SRC).toContain('@click="setPercent(percent)"')
    })

    it('MAX ayri bir kod yolu DEGIL - %100 cipinin ta kendisi', () => {
        // Ayri bir yol kalsaydi biri ucret payini dusurup digeri dusurmez ve
        // MAX yine cikmaz uretirdi.
        expect(SRC).not.toContain('>MAX<')
        expect(SRC).toContain("percent === 1 ? 'MAX'")
    })

    it('tutar percentAmount ile ve UCRET PAYI dusulerek hesaplanir', () => {
        const call = callArgs(SRC, 'percentAmount({', '})')
        expect(call).toContain('balance: inBalance.value')
        expect(call).toContain('reserve: await ' + reserveFn + '()')
        expect(call).toContain('decimals')
    })

    // clampToDecimals bu iki ekranin parseUnits oncesi SON kapisi (ustel
    // gosterim + fazla ondalik). Yuzde sonucu ondan gecmezse ikinci bir
    // bicimlendirme yolu dogar.
    it('sonuc clampToDecimals kapisindan gecer', () => {
        expect(SRC).toContain(assignment)
    })

    it('ucret payi needsNativeReserve kapisinin ardinda', () => {
        const call = callArgs(SRC, 'needsNativeReserve({', '})')
        expect(call).toContain('isNativeIn')
        // ATS ve gas-tokeni kollarinda ucret native'den ODENMEZ; pay ayirmak
        // hedef kitlesi zaten native'i olmayan kullaniciyi engellerdi.
        expect(call).toContain('gasToken: gasToken.value')
        expect(call).toContain('payWithAts: payWithAts.value')
    })

    it('canli teklifin gaz tahmini varsa O kullanilir', () => {
        // Sabit bir sayi her zinciri ve her rotayi birden yanlis tahmin ederdi.
        expect(SRC).toContain('reserveFromQuote(')
    })
})

describe('Takas - eski TAM BAKIYE yolu kalmadi', () => {
    it('MAX artik ham bakiyeyi yazmiyor', () => {
        expect(SWAP).not.toContain('inTokenAmount = clampToDecimals(inBalance')
    })

    // TON'da `network.rpc` null ve JsonRpcProvider(null) sessizce localhost'a
    // duser. Pay hesabi TON'da provider'a HIC ulasmamali.
    it('TON payi sabitten gelir, provider kurulmadan', () => {
        const at = SWAP.indexOf('if (isTonNetwork.value) return TON_SWAP_GAS_RESERVE')
        expect(at).toBeGreaterThan(-1)
        const providerAt = SWAP.indexOf('new ethers.JsonRpcProvider(network.rpc)', at)
        expect(providerAt).toBeGreaterThan(at)
    })
})

describe('Kopru - eski TAM BAKIYE yolu kalmadi', () => {
    it('MAX artik ham bakiyeyi yazmiyor', () => {
        expect(BRIDGE).not.toContain('amount = toDecimalString(inBalance)')
    })

    // Kopru teklifin gaz maliyetini zaten hesapliyor; ayri bir tahmin yolu
    // acmak yerine o sayi saklanip pay olarak kullaniliyor.
    it('teklifin hesaplanmis gaz maliyeti pay olarak saklanir', () => {
        expect(BRIDGE).toContain('estimatedGasNative.value = Number(ethers.formatEther(gasCostWei))')
        expect(BRIDGE).toContain('reserveFromQuote(estimatedGasNative.value)')
    })
})

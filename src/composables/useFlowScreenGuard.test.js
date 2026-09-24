// Korumanin IKI YARISI da burada olculur.
//
// SSR harness'i (ssrRender.js) render COZULUNCE bilesenin effect scope'unu
// DURDURUR, yani "ekran ACIKKEN ag degisti" yarisi Swap.ssr.test.js /
// Bridge.ssr.test.js ile GOZLEMLENEMEZ. Saf cekirdek (createFlowScreenGuard)
// tam da bu yuzden Pinia'dan ve bilesen ornegin den ayri duruyor: burada gercek
// bir effectScope icinde, gercek bir `watch` ile calistirilabiliyor.
import { describe, it, expect, vi } from 'vitest'
import { effectScope, ref, nextTick } from 'vue'
import { createFlowScreenGuard } from './useFlowScreenGuard'
import { FLOW } from '../utils/chainKind'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

function kur(flow, ilkZincir) {
    const chain = ref(ilkZincir)
    const leaveScreen = vi.fn()
    const scope = effectScope()
    let enforce
    scope.run(() => {
        enforce = createFlowScreenGuard({ flow, getChain: () => chain.value, leaveScreen })
    })
    return { chain, leaveScreen, enforce, scope }
}

describe('createFlowScreenGuard', () => {
    // DEADLOCK SINIFININ KILIDI. Kurulum SIRASINDA yazma olursa App.vue'daki
    // <Transition mode="out-in"> kilitlenir ve kullanici KALICI SIYAH EKRAN
    // gorur (tam mekanizma useFlowScreenGuard.js bas yorumunda). `immediate:
    // true` geri eklenirse bu iddia kirmiziya duser.
    it('KURULURKEN ekrani terk etmez -- desteklenmeyen bir zincirde bile', () => {
        const { leaveScreen } = kur(FLOW.SWAP, SOLANA_CHAIN)

        expect(leaveScreen).not.toHaveBeenCalled()
    })

    // KORUMANIN ASIL ISI. Kullanici ekrandayken ag degisirse ekran kapanmali.
    it('ag SONRADAN desteklenmeyen bir zincire gecerse ekrani terk eder', async () => {
        const { chain, leaveScreen } = kur(FLOW.SWAP, ETH_CHAIN)

        chain.value = SOLANA_CHAIN
        await nextTick()

        expect(leaveScreen).toHaveBeenCalledTimes(1)
    })

    // OTORITE BIRLESMESI. TON takasi chainKind.js'te ACIKCA destekleniyor
    // (STON.fi); eski otorite evmOnlyFeatures burada false donup kullaniciyi
    // disari atiyordu.
    it('TON takasi DESTEKLENIR: ne kurulumda ne de TON a geciste ekran terk edilir', async () => {
        const { chain, leaveScreen } = kur(FLOW.SWAP, TON_CHAIN)
        expect(leaveScreen).not.toHaveBeenCalled()

        chain.value = ETH_CHAIN
        await nextTick()
        chain.value = TON_CHAIN
        await nextTick()

        expect(leaveScreen).not.toHaveBeenCalled()
    })

    // TON KOPRUSU BILINCLI OLARAK KAPALI (LI.FI TON tasimiyor, Symbiosis native
    // TON tasimiyor -- chainKind.js FLOW.BRIDGE gerekcesi). Otorite birlesmesi
    // bu karari DEGISTIRMEMELI.
    it('TON koprusu DESTEKLENMEZ: TON a gecis ekrani terk ettirir', async () => {
        const { chain, leaveScreen } = kur(FLOW.BRIDGE, ETH_CHAIN)

        chain.value = TON_CHAIN
        await nextTick()

        expect(leaveScreen).toHaveBeenCalledTimes(1)
    })

    // Ekran bilesenleri unmount olunca izleyici de olmeli: kapanmis bir ekranin
    // korumasi `currentPage`e yazmaya devam ederse kullaniciyi bambaska bir
    // ekrandan disari atar.
    it('scope durdurulunca izleyici de durur', async () => {
        const { chain, leaveScreen, scope } = kur(FLOW.SWAP, ETH_CHAIN)

        scope.stop()
        chain.value = SOLANA_CHAIN
        await nextTick()

        expect(leaveScreen).not.toHaveBeenCalled()
    })
})

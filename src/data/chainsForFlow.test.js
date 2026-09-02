import { describe, it, expect } from 'vitest'
import { chainsForFlow, LISTED_CHAINS } from './chains'
import { TON_MAINNET_ID } from '../utils/chainKind'

// Zincir SECICILERININ kaynagi. Bugunku sizintinin en genis agzi burasiydi:
// selectFromChain, selectToChains ve networksPopup LISTED_CHAINS'i FILTRESIZ
// listeliyordu ve TON mainnet o listede. Yani kullanici Kopru ekranindan iki tikla
// TON'a gecebiliyordu - ana ekrandaki `v-if` hicbir sey engellemiyordu.
//
// Ayni derecede onemli olan ters yon: LISTED_CHAINS'ten TON'u TOPLUCA cikarmak
// YANLIS olurdu. O liste basliktaki ag secicide, kapsam pilinde ve varlik
// listelerinde de kullaniliyor; TON'un oralarda GORUNMESI gerekiyor.

const idsOf = (list) => list.map((c) => Number(c.chainId))

describe('chainsForFlow', () => {
    // TAKAS artik TON'da ACIK (STON.fi). Zincir secicisinde TON GORUNMELI, yoksa
    // kullanici takas ekraninda TON'a hic gecemez.
    it('swap listesinde TON VAR', () => {
        expect(idsOf(chainsForFlow('swap'))).toContain(TON_MAINNET_ID)
    })

    // KOPRU HALA KAPALI ve bu bilincli: native TON tasiyan bir saglayici yok
    // (tasarim §2.6/§7). Takas acildi diye kopru de acilmamali - "kopru var" deyip
    // Toncoin tasimamak, olmamasindan kotudur.
    it('bridge listesinde TON YOK', () => {
        expect(idsOf(chainsForFlow('bridge'))).not.toContain(TON_MAINNET_ID)
    })

    it('swap ve bridge listeleri BOS DEGIL — kapi her seyi kesmemis', () => {
        for (const flow of ['swap', 'bridge']) {
            expect(chainsForFlow(flow).length).toBeGreaterThan(5)
        }
    })

    // P0+P1'de gelen TON gonder/al akisi ve ana ekran portfoyu bu kapiyla KAPANMAMALI.
    it('akissiz liste LISTED_CHAINS ile BIREBIR ayni ve TON icerir', () => {
        expect(idsOf(chainsForFlow())).toEqual(idsOf(LISTED_CHAINS))
        expect(idsOf(chainsForFlow())).toContain(TON_MAINNET_ID)
    })

    it('bilinmeyen akis tam listeyi doner (fail-open)', () => {
        expect(idsOf(chainsForFlow('takas'))).toEqual(idsOf(LISTED_CHAINS))
    })

    it('donen liste LISTED_CHAINS in bir alt kumesidir', () => {
        const all = new Set(idsOf(LISTED_CHAINS))
        for (const flow of ['swap', 'bridge', 'dapp']) {
            for (const id of idsOf(chainsForFlow(flow))) expect(all.has(id)).toBe(true)
        }
    })
})

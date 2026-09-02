// UC VM'IN TEK DOGRUSU -- iki modul (vm.js ve chainKind.js) AYNI cevabi vermeli.
//
// NEDEN BU DOSYA VAR: vm.js Solana dalinda, chainKind.js TON dalinda BIRBIRINDEN
// HABERSIZ yazildi ve main'de bulustular. Bulusma su tuzagi uretti: TON kaydi
// `kind: 'ton'` tasir ama `vm` alani YOKTUR, yani chainVm() TON'a 'evm' diyordu.
// Sessiz ve agir: requireEvmVm TON'u GECIRIR ve EIP-1193 dapp yolu TON'da acilir.
// Ters yonde de ayni tuzak vardi: chainKind Solana'yi tanimiyordu ve isEvm()
// "ton degilse EVM" diye yazilmisti -- Solana adlandirilir adlandirilmaz
// swap/kopru/dapp kapilarinin HEPSI Solana'da acilacakti.
//
// Bu testler VERI ile kod arasindaki sozlesmeyi kilitler: zincir kayitlari
// degistiginde (yeni zincir, alan yeniden adlandirma) burasi kirilir.
import { describe, it, expect } from 'vitest'
import { chainVm, requireEvmVm, requireEvmChain, rpcUrlsOf } from './vm'
import { isEvm, isTon, isSolana } from './chainKind'
import chains from '../data/supported_chains.json'

const rejects = (fn, c) => { try { fn(c); return false } catch { return true } }

const TON_CHAINS = chains.filter((c) => c.kind === 'ton')
const SOLANA_CHAINS = chains.filter((c) => c.vm === 'solana')
const EVM_CHAINS = chains.filter((c) => !c.kind && !c.vm)

describe('zincir siniflandirmasi -- veri ile kod ayni seyi soyluyor', () => {
    it('kayit listesi beklenen uc tipi de icerir', () => {
        // Sayilar DUSERSE bu dosyanin geri kalani bos yere yesil kalirdi.
        expect(EVM_CHAINS.length).toBe(10)
        expect(SOLANA_CHAINS.length).toBe(1)
        expect(TON_CHAINS.length).toBe(2)
        expect(EVM_CHAINS.length + SOLANA_CHAINS.length + TON_CHAINS.length).toBe(chains.length)
    })

    it.each(EVM_CHAINS.map((c) => [c.name, c]))('%s: EVM', (_name, chain) => {
        expect(chainVm(chain)).toBe('evm')
        expect(isEvm(chain)).toBe(true)
        expect(isTon(chain)).toBe(false)
        expect(isSolana(chain)).toBe(false)
        // On EVM zincirinin HICBIRI bu birlesmede kapi degistirmedi.
        expect(rejects(requireEvmVm, chain)).toBe(false)
        expect(rejects(requireEvmChain, chain)).toBe(false)
        expect(rpcUrlsOf(chain).length).toBeGreaterThan(0)
    })

    it.each(SOLANA_CHAINS.map((c) => [c.name, c]))('%s: Solana, EVM DEGIL', (_name, chain) => {
        expect(chainVm(chain)).toBe('solana')
        expect(isSolana(chain)).toBe(true)
        expect(isEvm(chain)).toBe(false)
        expect(isTon(chain)).toBe(false)
        expect(rejects(requireEvmVm, chain)).toBe(true)
        expect(rejects(requireEvmChain, chain)).toBe(true)
        // Solana kaydinda `rpc` BILEREK yok: hicbir ethers saglayicisi acilamaz.
        expect(rpcUrlsOf(chain)).toEqual([])
    })

    it.each(TON_CHAINS.map((c) => [c.name, c]))('%s: TON, EVM DEGIL', (_name, chain) => {
        // BIRLESMENIN ASIL TUZAGI: `vm` alani yok diye EVM sayilmamali.
        expect(chainVm(chain)).toBe('ton')
        expect(isTon(chain)).toBe(true)
        expect(isEvm(chain)).toBe(false)
        expect(isSolana(chain)).toBe(false)
        expect(rejects(requireEvmVm, chain)).toBe(true)
        expect(rejects(requireEvmChain, chain)).toBe(true)
        expect(rpcUrlsOf(chain)).toEqual([])
    })

    it('KIMLIKLERLE de ayni cevap: metin kimlik EVM e DUSMEZ', () => {
        // chainKind'in kimlik yolu Number() kullanir; 'solana-mainnet' NaN'dir.
        // Sayi olmamak "zincir yok" demek DEGILDIR: kayit metinle aranir.
        expect(isSolana('solana-mainnet')).toBe(true)
        expect(isEvm('solana-mainnet')).toBe(false)
        expect(isTon(-239)).toBe(true)
        expect(isEvm(-239)).toBe(false)
        expect(isEvm(1)).toBe(true)
        expect(isEvm(137)).toBe(true)
        // GERCEKTEN bilinmeyen bir kimlik null kind uretir -> hicbir tipe girmez.
        expect(isEvm('bilinmeyen-zincir')).toBe(false)
        expect(isSolana('bilinmeyen-zincir')).toBe(false)
    })
})

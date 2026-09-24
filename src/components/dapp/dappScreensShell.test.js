// KAYNAK KILIDI (task-59 brief): sekiz onay ekraninin (ConnectDapp, Sign,
// TonConnectApprove, TonSendTx, TonSignData, SolanaConnectApprove,
// SolanaSignMessage, SolanaSignTx) HEPSININ ortak ApprovalShell.vue kabugunu
// GERCEKTEN kullandigini, eski (ayri-ayri kopyalanmis) iskelet sinif
// dizgelerinin HICBIRINDE kalmadigini ve kaldirilan `connectNotice` anahtarinin
// hicbir kaynak/ceviri dosyasinda hayalet olarak KALMADIGINI dogrudan
// KAYNAK METNI uzerinden kilitler -- render/SSR testleri bunu YAKALAYAMAZ
// (bir ekran kabugu kullanmadan da AYNI metni basabilir), bu yuzden statik bir
// dosya taramasi gerekir (bkz. locales.test.js'teki AYNI gerekce).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = join(here, '..', '..', 'i18n', 'locales')

const dappFiles = readdirSync(here)
    .filter((f) => f.endsWith('.vue') && f !== 'ApprovalShell.vue')
    .sort()

// Sekiz ekranin TAMAMI burada bekleniyor -- bu liste kisalirsa (bir dosya
// silinir/tasinirsa) test SESSIZCE daha az dosyayi kontrol eder; asagidaki
// sayim bunu yakalar.
// 8 -> 9: SwitchChain.vue (wallet_switchEthereumChain onay ekrani, 2026-09-11).
const BEKLENEN_EKRAN_SAYISI = 9

describe('components/dapp -- ApprovalShell kaynak kilidi', () => {
    it('taranan ekran sayisi BEKLENEN ile birebir ayni (dosya listesi SESSIZCE kaymadi)', () => {
        expect(dappFiles).toHaveLength(BEKLENEN_EKRAN_SAYISI)
    })

    for (const dosyaAdi of dappFiles) {
        const icerik = readFileSync(join(here, dosyaAdi), 'utf8')

        it(`${dosyaAdi}: ApprovalShell'i IMPORT EDER ve KULLANIR`, () => {
            expect(icerik).toMatch(/import\s+ApprovalShell\s+from\s+['"]\.\/ApprovalShell\.vue['"]/)
            expect(icerik).toContain('<ApprovalShell')
        })

        it(`${dosyaAdi}: eski kok iskelet sinifi (w-90 h-150) KALMADI`, () => {
            // Dokuz tuketen ekranin hicbiri kendi kokunu cizmez (kabuk cizer).
            expect(icerik).not.toContain('w-90 h-150')
            // ... ve yeni kok dizgesini de cizmezler: kok TEK yerde, ApprovalShell'de.
            expect(icerik).not.toContain('w-full h-full max-w-[420px]')
        })

        it(`${dosyaAdi}: eski buton seridi iskeleti KALMADI`, () => {
            expect(icerik).not.toContain('p-5 border-t border-slate-200 dark:border-white/5 bg-white')
        })

        it(`${dosyaAdi}: kaldirilan connectNotice anahtari HICBIR YERDE gecmez`, () => {
            expect(icerik).not.toContain('connectNotice')
        })
    }
})

describe('i18n -- connectNotice ve yeni izin anahtarlari', () => {
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'))
    const tr = JSON.parse(readFileSync(join(localesDir, 'tr.json'), 'utf8'))

    it('connectNotice ARTIK ne en.json de ne tr.json da var', () => {
        expect(en.dapps?.solana?.connectNotice).toBeUndefined()
        expect(tr.dapps?.solana?.connectNotice).toBeUndefined()
    })

    // Yeni izin anahtarlari: Solana perm_sign_*, TonConnect perm_tx_* --
    // birbirinden FARKLI ("imza isteyebilir" vs "islem onerebilir"), geri
    // kalani AYNI kalip. Her ikisi de iki dilde, BOS OLMAYAN degerlerle.
    const solanaAnahtarlari = [
        'permissions_title', 'perm_view_title', 'perm_view_desc',
        'perm_sign_title', 'perm_sign_desc', 'perm_noauto_title', 'perm_noauto_desc',
    ]
    const tonAnahtarlari = [
        'permissions_title', 'perm_view_title', 'perm_view_desc',
        'perm_tx_title', 'perm_tx_desc', 'perm_noauto_title', 'perm_noauto_desc',
    ]

    it.each(solanaAnahtarlari)('dapps.solana.%s iki dilde de var ve BOS DEGIL', (anahtar) => {
        expect(en.dapps.solana[anahtar]).toBeTruthy()
        expect(tr.dapps.solana[anahtar]).toBeTruthy()
    })

    it.each(tonAnahtarlari)('dapps.tonConnect.%s iki dilde de var ve BOS DEGIL', (anahtar) => {
        expect(en.dapps.tonConnect[anahtar]).toBeTruthy()
        expect(tr.dapps.tonConnect[anahtar]).toBeTruthy()
    })

    it('en.json / tr.json YENI anahtar kumesi dapps.solana icin BIREBIR AYNI', () => {
        expect(Object.keys(en.dapps.solana).sort()).toEqual(Object.keys(tr.dapps.solana).sort())
    })

    it('en.json / tr.json YENI anahtar kumesi dapps.tonConnect icin BIREBIR AYNI', () => {
        expect(Object.keys(en.dapps.tonConnect).sort()).toEqual(Object.keys(tr.dapps.tonConnect).sort())
    })
})

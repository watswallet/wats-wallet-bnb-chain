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
// 9 -> 10: TonAlert.vue (TonConnect ag/hesap uyusmazligi uyarisi, B2).
// 10 -> 11: SignTypedData.vue (eth_signTypedData_v4, 2026-10).
//
// LITERAL SAYI DEGIL, ACIK AD LISTESI (spec bolum 13, "semantik birlesme tuzagi"):
// iki dal ayni anda birer ekran ekleyip ayni sayiyi 10 -> 11 yapsa git temiz
// birlesir ama gercek deger 12 olur ve test kirilirdi. Ad listesinde her dal
// KENDI satirini ekler (ayri hunk'lar), kisalma/uzama yine yakalanir. Her ad
// AYRI satirda ve alfabetik: ekleyen satiri sirasina koyar.
const BEKLENEN_EKRANLAR = [
    'ConnectDapp.vue',
    'Sign.vue',
    'SignTypedData.vue',
    'SolanaConnectApprove.vue',
    'SolanaSignMessage.vue',
    'SolanaSignTx.vue',
    'SwitchChain.vue',
    'TonAlert.vue',
    'TonConnectApprove.vue',
    'TonSendTx.vue',
    'TonSignData.vue',
]

describe('components/dapp -- ApprovalShell kaynak kilidi', () => {
    it('taranan ekran listesi BEKLENEN ad listesiyle birebir ayni (dosya listesi SESSIZCE kaymadi)', () => {
        expect(dappFiles).toEqual([...BEKLENEN_EKRANLAR].sort())
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

describe('SignTypedData.vue -- kaynak kilitleri', () => {
    const kaynak = readFileSync(join(here, 'SignTypedData.vue'), 'utf8')

    it('ApprovalShell chain="evm" uzerine kurulu', () => {
        expect(kaynak).toMatch(/<ApprovalShell\s+chain="evm"/)
    })

    it('v-html KULLANMAZ (dapp metni asla HTML olarak basilmaz)', () => {
        expect(kaynak).not.toContain('v-html')
        expect(kaynak).not.toContain('innerHTML')
    })

    it('adresler ucuncu tarafa (identicon servisi) gitmez', () => {
        expect(kaynak).not.toContain('dicebear')
    })

    it('ceviri anahtarlari STATIK: her $t( / t( cagrisi tirnakli bir anahtarla baslar', () => {
        const dinamik = [...kaynak.matchAll(/(?<![\w$.])\$?t\(\s*(?!['"])/g)].map((m) => kaynak.slice(m.index, m.index + 40))
        expect(dinamik).toEqual([])
    })
})

describe('i18n -- dapps.signTypedData ad alani', () => {
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'))
    const tr = JSON.parse(readFileSync(join(localesDir, 'tr.json'), 'utf8'))
    const kaynak = readFileSync(join(here, 'SignTypedData.vue'), 'utf8')

    // Spec bolum 10 tablosundaki anahtarlar + ekranin kendi eklerini (btn_copied, request_invalid).
    const GEREKLI = [
        'title', 'label_account', 'label_primary_type', 'label_message', 'label_domain',
        'domain_name', 'domain_version', 'domain_chain', 'domain_contract', 'domain_salt',
        'chain_missing', 'technical_details', 'digest_label', 'raw_label', 'btn_copy_json', 'info_text',
        'permit_title', 'kind_erc2612', 'kind_dai', 'kind_permit2', 'kind_seaport',
        'flag_unlimited', 'flag_practically_unlimited', 'flag_no_expiry', 'flag_expired',
        'unsigned_fields', 'hidden_chars', 'truncated', 'show_all', 'show_less',
        'permit_unknown_title', 'chain_missing_warning', 'units_unknown',
        'seaport_give', 'seaport_get', 'seaport_nothing', 'domain_extra_fields',
        'request_expired', 'permission_revoked', 'btn_reject', 'btn_sign',
        'alt_dapp_logo', 'alt_wallet_avatar', 'default_account', 'copy_title',
        'btn_copied', 'request_invalid',
    ]

    it.each(GEREKLI)('dapps.signTypedData.%s iki dilde de var ve BOS DEGIL', (anahtar) => {
        expect(en.dapps.signTypedData[anahtar]).toBeTruthy()
        expect(tr.dapps.signTypedData[anahtar]).toBeTruthy()
    })

    it('en ve tr anahtar kumesi BIREBIR AYNI ve gerekli listeyle ayni', () => {
        expect(Object.keys(en.dapps.signTypedData).sort()).toEqual(Object.keys(tr.dapps.signTypedData).sort())
        expect(Object.keys(en.dapps.signTypedData).sort()).toEqual([...GEREKLI].sort())
    })

    it('ad alani dapps.sign blogundan HEMEN SONRA (nesne sonuna DEGIL)', () => {
        for (const dil of [en, tr]) {
            const anahtarlar = Object.keys(dil.dapps)
            expect(anahtarlar[anahtarlar.indexOf('sign') + 1]).toBe('signTypedData')
        }
    })

    it('ad alanindaki HER anahtar ekranda KULLANILIR (olu anahtar yok)', () => {
        const kullanilan = new Set(
            [...kaynak.matchAll(/(?:\$t|(?<![\w$.])t)\(\s*['"]dapps\.signTypedData\.([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]),
        )
        expect([...kullanilan].sort()).toEqual([...GEREKLI].sort())
    })

    it('yeniden kullanilan anahtar: send.confirmTransaction.spender', () => {
        expect(en.send.confirmTransaction.spender).toBeTruthy()
        expect(tr.send.confirmTransaction.spender).toBeTruthy()
        expect(kaynak).toContain("'send.confirmTransaction.spender'")
    })
})

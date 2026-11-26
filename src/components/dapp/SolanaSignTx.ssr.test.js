// KOK NEDEN: bu ekran kor imzalamaya karsi tek gorsel savunma. Ozet UYDURAN,
// kirmizi bayragi kacIran ya da ALT cozumlemesi basarisiz oldu diye istegi
// REDDEDEN bir ekran, ozelligin var olma amacini yok eder.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const solanaRpc = vi.fn()
vi.mock('../../utils/solana/client', () => ({
    solanaRpc: (...a) => solanaRpc(...a),
    SOLANA_API_BASE: 'https://api.test',
}))

// Gorev 10: SOL fiyati ekranda yaklasik dolar ucret satirini besler. Gercek useUsdPrice sunucuya
// (axios) gider; burada fiyat testten ayarlanir (null = fiyat bilinmiyor -> satir YOK).
const FIYAT = vi.hoisted(() => ({ sol: null }))
vi.mock('../../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return {
        useUsdPrice: () => {
            const price = ref(null)
            return { price, loadNative: async () => { price.value = FIYAT.sol }, loadById: async () => {} }
        },
    }
})

import { readFileSync } from 'node:fs'
import {
    AddressLookupTableAccount, ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction,
    TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js'
import {
    createApproveInstruction, createApproveCheckedInstruction, createAssociatedTokenAccountInstruction, createCloseAccountInstruction,
    createFreezeAccountInstruction, createInitializeAccount3Instruction, createSyncNativeInstruction,
    createTransferCheckedInstruction, createTransferInstruction, createRevokeInstruction, createBurnCheckedInstruction,
    getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import { COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../../utils/solana/decodeInstructions'
import SolanaSignTx from './SolanaSignTx.vue'

const BLOCKHASH = '11111111111111111111111111111111'
const CUZDAN = Keypair.generate()
const FROM = CUZDAN.publicKey.toBase58()
const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd', solanaAddress: FROM }

function txB64(instructions) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = CUZDAN.publicKey
    for (const ix of instructions) tx.add(ix)
    return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
}

const transferTx = () => txB64([SystemProgram.transfer({
    fromPubkey: CUZDAN.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000,
})])

const approveTx = () => txB64([createApproveInstruction(
    Keypair.generate().publicKey, Keypair.generate().publicKey, CUZDAN.publicKey, 10n,
)])

// ATA olusturan islem: §5.2'nin kira kalemi YALNIZCA boyle bir talimatta cikar.
const ataTx = () => txB64([createAssociatedTokenAccountInstruction(
    CUZDAN.publicKey, Keypair.generate().publicKey, CUZDAN.publicKey, Keypair.generate().publicKey,
)])

// Talimati sifir olan GERCEK bir islem (obligation 6): tel bicimi bunu kabul
// eder (dogrulandi -- web3.js yalnizca bir konsol uyarisi basar, FIRLATMAZ).
// decodeInstructions bu durumda BOS dizi doner ve bu, "cozumleme hic
// calismadi" ile "GERCEKTEN sifir talimat var" arasinda AYIRT EDILEMEZ (Task
// 27 arayuz notu) -- ekran bu yuzden bos bir karti "temiz" gibi SESSIZCE
// GECEMEZ.
const bosTx = () => {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = CUZDAN.publicKey
    return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
}

// ALT testi GERCEK bir v0 islemi ister: legacy bir islemde altAdresleri()
// daha ilk satirda (`parsed.version !== 0`) null doner, solanaRpc HIC cagrilmaz
// ve "cozumleme patlarsa" testi BOS YERE gecer. Asagisi, agla konusmadan
// gercek bir adres arama tablosu tasiyan en kucuk kurgudur.
const v0AltTx = () => {
    const hedef = Keypair.generate().publicKey
    const tablo = new AddressLookupTableAccount({
        key: Keypair.generate().publicKey,
        state: {
            deactivationSlot: 2n ** 64n - 1n,
            lastExtendedSlot: 0,
            lastExtendedSlotStartIndex: 0,
            authority: undefined,
            addresses: [hedef],
        },
    })
    const message = new TransactionMessage({
        payerKey: CUZDAN.publicKey,
        recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: CUZDAN.publicKey, toPubkey: hedef, lamports: 1000 })],
    }).compileToV0Message([tablo])
    return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64')
}

// GERCEK origin ile IDDIA EDILEN ad KASITLI olarak farkli host'lar (K5):
// ayni olsalardi asagidaki iddia "origin mi, appMeta mi gosterildi" sorusuna
// hicbir sey soylemezdi.
const ISTEK = {
    type: 'SOLANA_SIGN_TX',
    id: 'req-sol-1',
    requestId: 'req-sol-1',
    origin: 'https://app.jup.ag',
    appMeta: { name: 'Jupiter', icon: null, url: 'https://cdn.example.com' },
    accountKey: 'acc-1',
    from: FROM,
    mode: 'sign',
    chain: 'solana:mainnet',
    transactions: [transferTx()],
}

// Gorev 40: ayni ekran signAndSend modunu da tasir -- yayini KIMIN yapacagini
// (dapp mi, cuzdan mi) gostermek zorunlu (§4.5). ISTEK'in signAndSend
// varyanti -- AYNI origin/appMeta/requestId (K5 dominance testi yukarida
// zaten var, burada TEKRARLANMAZ -- task-40 review, Deviation 1) ve AYNI
// GERCEK islem (`transferTx()` uzerinden, txB64 ile serilestirilmis). Sahte/
// parcalanmis bir base64 onMounted icinde parseDappTransaction'i FIRLATIP
// "Unhandled Rejection" gurultusu uretirdi (task-40 review, Finding 1).
const SIGNANDSEND_ISTEK = {
    ...ISTEK,
    mode: 'signAndSend',
    isDurableNonce: false,
    options: { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 },
}

beforeEach(() => {
    vi.clearAllMocks()
    FIYAT.sol = null
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
    // Varsayilan zincir yanitlari: bakiye islemi RAHATCA karsilar ve ATA kirasi
    // gercekci bir degerdir. Boylece maliyet kalemleri yalnizca ONLARI olcen
    // testlerde konusur, digerlerinde sessiz kalir.
    solanaRpc.mockImplementation(async (method) => {
        if (method === 'getBalance') return { value: 5_000_000_000 }
        if (method === 'getMinimumBalanceForRentExemption') return 2039280
        return { value: [] }
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { imzaSonuc = { success: true, signedTransactions: ['AQAB'] } } = {}) {
    const stub = installChromeStub({
        current_request: currentRequest,
        active_account: ACCOUNT,
        vaults: [{ id: 'v1', accounts: [ACCOUNT] }],
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => {
        gonderilen.push(m)
        if (m.type === 'SOLANA_DAPP_SIGN_TX') return imzaSonuc
        return {}
    })

    const app = createApp(SolanaSignTx)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'solana_sign_tx'
    return { app, page, gonderilen, stub }
}

describe('SolanaSignTx.vue (SSR) -- gosterim', () => {
    it('GERCEK origin ekranda, sayfanin IDDIA ettigi ad DEGIL', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).toContain('app.jup.ag')
        expect(html).not.toContain('cdn.example.com')
    })

    // Obligation 2 (bu sinif defekt projede DORDUNCU kez tekrarlandi): yukaridaki
    // test yalnizca "ikisi de bir yerde var" der -- <h2>/rozet baglantilari
    // sablonda yer degistirse (origin rozette, iddia edilen ad h2'de -- tam da
    // K5'in onlemeye calistigi phishing regresyonu) o test HALA gecerdi.
    // Asagidaki iki kontrol bunu AYIRT EDER: baskin <h2>'nin ICERIGI TAM OLARAK
    // origin olmali, ve origin ham HTML'de iddia edilen isimden ONCE gelmeli.
    // Bu assertion'in GERCEKTEN isledigi, iki binding'i ELLE gecici olarak yer
    // degistirip testin KIRMIZIYA dondugu gozlemlenerek dogrulandi (bkz.
    // task-31-report.md "dominance swap RED evidence" bolumu).
    it('BASKIN <h2> TAM OLARAK origin, iddia edilen ad ondan SONRA gelir (gercek dominance testi)', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        const h2Icerik = html.match(/<h2[^>]*>([^<]*)<\/h2>/)?.[1]
        expect(h2Icerik).toBe('app.jup.ag')
        expect(html.indexOf('app.jup.ag')).toBeLessThan(html.indexOf('Jupiter'))
    })

    it('talimatlar kart kart cozulur', async () => {
        const { app } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)
        const kartlar = holder.instance.setupState.kartlar
        expect(kartlar).toHaveLength(1)
        expect(kartlar[0].talimatlar[0].type).toBe('Transfer')
    })

    it('signAll modunda HER islem AYRI kart', async () => {
        const { app } = setup({ ...ISTEK, mode: 'signAll', transactions: [transferTx(), transferTx(), transferTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)
        expect(holder.instance.setupState.kartlar).toHaveLength(3)
    })

    // Solana'nin sinirsiz-allowance karsiligi. Kacirilirsa kullanici tek
    // tiklamayla tum token bakiyesini ucuncu tarafa acar.
    it('Approve KIRMIZI uyari uretir', async () => {
        const { app } = setup({ ...ISTEK, transactions: [approveTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)
        expect(holder.instance.setupState.kirmiziBayrakVar).toBe(true)
        expect(html).toContain('Approve')
        // I5 fix (task-31 review): `html.toContain('Approve')` yalnizca
        // `{{ ix.type }}`den geliyordu -- ust bandaki DANGER banner'ini
        // (redFlagTitle) VE satir-ici kirmizi metni (redFlag_Approve) HIC
        // olcemiyordu. O ikisi SILINSE bile bu iddia gecerdi. Cevrilmis
        // gercek uyari metinleri burada dogrudan ARANIR.
        expect(html).toContain('This transaction can hand over control of your tokens or accounts')
        // approveTx() 10 birimlik SINIRLI Approve: "open-ended" demez (final SU-18).
        expect(html).toContain('Lets another address spend up to the amount shown from this token account')
        expect(html).not.toContain('open-ended allowance')
    })

    it('duz transferde kirmizi uyari CIKMAZ', async () => {
        const { app } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)
        expect(holder.instance.setupState.kirmiziBayrakVar).toBe(false)
        // I5 fix (task-31 review, ayni testin negatif yarisi): DANGER
        // banner'i ve Approve'a ozel kirmizi metin duz transferde HICBIR
        // yerde gorunmemeli.
        expect(html).not.toContain('This transaction can hand over control of your tokens or accounts')
        expect(html).not.toContain('Grants a third party an open-ended allowance over this token account')
    })

    // K5 DURUSTLUK KURALI: cozulemeyen talimatta ozet UYDURULMAZ; SHA-256
    // gosterilir (TonSignData.vue emsali).
    it('cozulemeyen talimatta ozet UYDURULMAZ, SHA-256 gosterilir', async () => {
        const yabanci = new PublicKey('Stake11111111111111111111111111111111111111')
        const base64 = txB64([new TransactionInstruction({
            programId: yabanci,
            keys: [{ pubkey: CUZDAN.publicKey, isSigner: true, isWritable: true }],
            data: Buffer.from([7, 7, 7]),
        })])
        const { app } = setup({ ...ISTEK, transactions: [base64] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        const ix = holder.instance.setupState.kartlar[0].talimatlar[0]
        expect(ix.type).toBeNull()
        expect(ix.hash).toMatch(/^[0-9a-f]{64}$/)
        // I4 fix (task-31 review): yukaridaki iki satir Task 27'nin cozucusunu
        // ve bu bilesenin hashlemesini olcuyor, EKRANI olcmuyordu -- panelin
        // KENDISI silinse bile bu test HALA gecerdi. Cevrilmis "okuyamiyor"
        // metni VE kisaltilmis hash'in GERCEKTEN HTML'e ciktigi burada
        // dogrudan dogrulanir.
        expect(html).toContain('The wallet cannot read this instruction')
        const beklenenKisaHash = ix.hash.slice(0, 16) + '...' + ix.hash.slice(-8)
        expect(html).toContain(beklenenKisaHash)
    })

    // Obligation 6 (ikinci yarisi): decodeInstructions "parsed yoktu" ile
    // "GERCEKTEN sifir talimat var"i AYIRT EDEMEZ (Task 27 arayuz notu) -- bu
    // yuzden bos bir kart SESSIZCE "burada tehlikeli bir sey yok" gibi
    // OKUNAMAZ. Ekran acikca "okunacak talimat bulunamadi" demeli.
    it('talimat listesi GERCEKTEN bossa sessizce "temiz kart" gibi GECILMEZ', async () => {
        const { app } = setup({ ...ISTEK, transactions: [bosTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.kartlar[0].talimatlar).toHaveLength(0)
        // Ham anahtar degil, GERCEK cevrilmis metin ekranda olmali.
        expect(html).toContain('no instructions')
    })

    // Global kisit (visibility helper): appMeta.name sayfa/dapp tarafindan
    // verilir ve HICBIR sekilde zorlanmaz -- SolanaSignMessage.vue'nun SIWS
    // `uri` alani icin duzelttigi AYNI sinif acik. Isaretlenmezse "site claims"
    // rozeti Kiril 'а' ile yazilmis bir ad GERCEK bir markaya AYNI gorunur.
    it('iddia edilen ad (appMeta.name) homoglif icerirse ISARETLENIR', async () => {
        const sahteAd = 'аpp.jup.ag' // Kiril 'а' (U+0430) ile baslar
        const { app } = setup({ ...ISTEK, appMeta: { name: sahteAd, icon: null, url: 'https://cdn.example.com' } })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.iddiaEdilenAd).toContain('[U+0430]')
        expect(html).toContain('[U+0430]')
        expect(html).not.toContain(sahteAd)
    })

    // ComputeBudget'tan OKUNAN oncelik ucreti. Cuzdan ASLA yazmaz.
    it('oncelik ucreti yoksa acikca "yok" durumu tasinir', async () => {
        const { app } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)
        expect(holder.instance.setupState.butce.unitPriceMicroLamports).toBeNull()
    })

    // I2 fix (task-31 review): computeBudgetSummary unitPriceMicroLamports
    // icin null'i HEM "SetComputeUnitPrice talimati hic yok" HEM "var ama
    // verisi kirpilmis, okunamadi" durumunda doner (readU64LE, decodeInstructions.js).
    // Onceki halinde ikisi de "yok" gosteriyordu -- okunamayan bir deger
    // OLUMLU bir iddiaya donusuyordu (K5).
    it('oncelik ucreti talimati VAR ama verisi kirpilmisse "yok" DEGIL "okunamadi" gosterilir', async () => {
        const base64 = txB64([new TransactionInstruction({
            programId: new PublicKey(COMPUTE_BUDGET_PROGRAM_ID),
            keys: [],
            // SetComputeUnitPrice ayirici (3) + KIRPILMIS u64 (0 bayt, 8 gerekir).
            data: Buffer.from([3]),
        })])
        const { app } = setup({ ...ISTEK, transactions: [base64] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.butce.unitPriceMicroLamports).toBeNull()
        expect(holder.instance.setupState.oncelikUcretiOkunamadi).toBe(true)
        expect(html).toContain('could not be read')
    })

    it('durable nonce rozeti isaretlenir', async () => {
        const base64 = txB64([
            SystemProgram.nonceAdvance({ noncePubkey: Keypair.generate().publicKey, authorizedPubkey: CUZDAN.publicKey }),
            SystemProgram.transfer({ fromPubkey: CUZDAN.publicKey, toPubkey: CUZDAN.publicKey, lamports: 1 }),
        ])
        const { app } = setup({ ...ISTEK, transactions: [base64] })
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)
        expect(holder.instance.setupState.kartlar[0].isDurableNonce).toBe(true)
    })
})

describe('SolanaSignTx.vue (SSR) -- ALT cozumlemesi', () => {
    // §5.2: ALT cozumlemesi AG cagrisidir. Basarisizlikta istek REDDEDILMEZ --
    // reddetmek, sunucu bir saniyeligine yavasladi diye mesru bir islemi
    // oldururdu; dogru davranis durustluk kuralina dusmektir.
    it('ALT cozumlemesi patlarsa istek REDDEDILMEZ', async () => {
        solanaRpc.mockRejectedValue(new Error('SOLANA_RPC_TIMEOUT'))
        // Islem v0 VE adres arama tablosu tasimak ZORUNDA: legacy bir islemde
        // altAdresleri() hemen null doner, catch dali HIC calismaz ve bu testin
        // tek iddiasi (basarisizlikta REDDETME) olculmemis olurdu.
        const { app, gonderilen } = setup({ ...ISTEK, transactions: [v0AltTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        expect(holder.instance.setupState.hata).toBe('')
        expect(holder.instance.setupState.altCozulemedi).toBe(true)
        expect(gonderilen.find((m) => m.type === 'SEND_TX_REJECTED')).toBeUndefined()
        // Onay dugmesi HALA calisir durumda olmali.
        expect(typeof holder.instance.setupState.onayla).toBe('function')
    })
})

describe('SolanaSignTx.vue (SSR) -- maliyet kalemleri', () => {
    // §5.2 maliyet listesi DORT kalemdir: taban ucret, oncelik ucreti,
    // OLUSTURULAN HESAPLARIN KIRASI ve bakiye yetmiyorsa kirmizi uyari.
    // Gosterilmeyen bir kira, kullanicinin hic gormedigi bir SOL gideridir.
    it('ATA olusturan islemde kira kalemi zincirden okunur', async () => {
        const { app } = setup({ ...ISTEK, transactions: [ataTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        expect(solanaRpc).toHaveBeenCalledWith('getMinimumBalanceForRentExemption', [165])
        expect(holder.instance.setupState.kiraLamports).toBe(2039280)
        expect(holder.instance.setupState.kiraCozulemedi).toBe(false)
    })

    it('bakiye taban ucret + kirayi karsilamiyorsa KIRMIZI uyari cikar', async () => {
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getBalance') return { value: 100 }
            if (method === 'getMinimumBalanceForRentExemption') return 2039280
            return { value: [] }
        })
        const { app, gonderilen } = setup({ ...ISTEK, transactions: [ataTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.bakiyeYetersiz).toBe(true)
        expect(html).toContain('does not cover')
        // Uyari BILGILENDIRIR, istegi REDDETMEZ: yetersiz bakiye kullanicinin
        // karari, cuzdanin sansuru degil.
        expect(gonderilen.find((m) => m.type === 'SEND_TX_REJECTED')).toBeUndefined()
        expect(typeof holder.instance.setupState.onayla).toBe('function')
    })

    // I3 fix (task-31 review): u64Oku KIRPILMIS CreateAccount verisinden
    // SESSIZCE 0n UYDURUYORDU -- ATA kirasindaki `!Number.isFinite` guard'inin
    // uyguladigi disiplinden FARKLI davranarak kiraLamports'a 0 ekliyor,
    // kiraCozulemedi'yi HIC tetiklemiyordu; ekran "0.000000000 SOL" gibi
    // UYDURULMUS bir rakam gosteriyordu.
    it('CreateAccount kirpilmis veri tasirsa kira SESSIZCE 0 DEGIL, okunamadi olarak isaretlenir', async () => {
        const base64 = txB64([new TransactionInstruction({
            programId: new PublicKey(SYSTEM_PROGRAM_ID),
            keys: [
                { pubkey: CUZDAN.publicKey, isSigner: true, isWritable: true },
                { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true },
            ],
            // CreateAccount ayirici (u32 LE = 0) + KIRPILMIS lamports alani
            // (8 bayt gerekir, yalnizca 3 var).
            data: Buffer.from([0, 0, 0, 0, 1, 2, 3]),
        })])
        const { app } = setup({ ...ISTEK, transactions: [base64] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.kartlar[0].talimatlar[0].type).toBe('CreateAccount')
        expect(holder.instance.setupState.kiraCozulemedi).toBe(true)
        expect(holder.instance.setupState.kiraLamports).toBe(0)
        expect(html).toContain('could not be read')
    })
})

describe('SolanaSignTx.vue (SSR) -- onay ve red', () => {
    it('SOLANA_DAPP_SIGN_TX cagrilir ve imzali islemler dapp e doner', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const istek = gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_TX')
        expect(istek.message.from).toBe(FROM)
        expect(istek.message.origin).toBe('https://app.jup.ag')
        expect(istek.message.transactions).toEqual(ISTEK.transactions)
        expect(istek.message.account?.key).toBe('acc-1')
        // Obligation 4: current_request.requestId GONDERILMEZSE Task 30'un
        // icerik baglama kilidi HER onayi SOLANA_DAPP_FROM_MISMATCH ile
        // kapali basarisiz eder.
        expect(istek.message.requestId).toBe('req-sol-1')

        const ok = gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')
        expect(ok.requestId).toBe('req-sol-1')
        expect(ok.status).toBe('success')
        expect(ok.data.result.signedTransactions).toEqual(['AQAB'])
    })

    // Ham kod ekrana ASLA cikmaz (§3.6): sendErrors tablosu uzerinden cevrilir.
    it('arka plandan gelen KOD cevrilmis metne donusur, ham kod GORUNMEZ', async () => {
        const { app, gonderilen } = setup(ISTEK, { imzaSonuc: { success: false, error: 'SOLANA_NOT_A_SIGNER' } })
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        await holder.instance.setupState.onayla()

        expect(holder.instance.setupState.hata).toBeTruthy()
        // not.toContain (not.toBe DEGIL): ham kod cevrilmis metnin ICINDE bir
        // ALT DIZGE olarak da GORUNMEMELI (orn. "Hata: SOLANA_NOT_A_SIGNER") --
        // sadece TAM ESITLIGI degil, sizintiyi da yakalar.
        expect(holder.instance.setupState.hata).not.toContain('SOLANA_NOT_A_SIGNER')
        expect(gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')).toBeUndefined()
    })

    it('red 4001 ile SEND_TX_REJECTED gonderir ve imzalatmaz', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        await holder.instance.setupState.reddet()

        const red = gonderilen.find((m) => m.type === 'SEND_TX_REJECTED')
        expect(red.requestId).toBe('req-sol-1')
        expect(red.status).toBe('error')
        expect(red.error.code).toBe(4001)
        expect(gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_TX')).toBeUndefined()
    })
})

// Obligation 1 (Gorev 14'un SolanaConnectApprove'da bulunan bulgusu buraya da
// uygulanir): onMounted'in TEK await'i (chrome.storage.local.get) COZULMEDEN
// once requestData hala null'dur, ama sablon o ana kadar da render edilmis ve
// dugme sadece `loading`e bagliysa GORSEL olarak etkin gorunur. SSR'da bu
// GECICI pencereyi dogrudan yakalayamayiz (render() TUM onMounted zincirini
// bekler), ama current_request TIPI eslesmezse requestData KALICI olarak null
// KALIR -- ayni yari-durumun SABIT/gozlemlenebilir bir izdusumu.
describe('SolanaSignTx.vue (SSR) -- onay dugmesi cozulme kilidi', () => {
    it('istek henuz/hic COZULMEMISKEN imzala dugmesi devre disi kalir, tiklama SESSIZCE hicbir sey yapmaz', async () => {
        const { app, gonderilen } = setup({ type: 'SOLANA_CONNECT', id: 'req-x', origin: 'https://app.jup.ag' })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.requestData).toBeNull()

        const dugmeAcilis = html.match(/<button[^>]*id="solana-sign-tx-approve"[^>]*>/)?.[0] || ''
        // DIKKAT (Gorev 14 emsali): dugmenin `class` degeri zaten statik
        // "disabled:opacity-50" gibi Tailwind varyant adlarini TASIR -- class
        // degeri CIKARILMADAN yapilan duz bir 'disabled' arattirmasi HER ZAMAN
        // gecerdi (dugme gercekten etkin olsa bile). class degerini cikarip
        // GERCEK `disabled` niteligini ariyoruz.
        const classSiz = dugmeAcilis.replace(/class="[^"]*"/, '')
        expect(classSiz).toContain('disabled')

        await holder.instance.setupState.onayla()
        expect(gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_TX')).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')).toBeUndefined()
    })
})

// C1 fix (task-31 review, CRITICAL): requestData dolar dolmaz (onMounted'in
// ILK await'i sonrasi) dugme ONCEDEN etkindi, ama kartKur/getBalance
// await'leri (ALT cozumlemesi ALT_TIMEOUT_MS=4000'e kadar, sonra rent/bakiye
// sorgulari) HALA surmekteydi -- o pencerede ekran hicbir kart cizmiyor ama
// maliyet panelini UYDURULMUS "0.000000000 SOL" ile ve dugmeyi ETKIN
// gosteriyordu. `render()`in kendisi TUM onMounted zincirini bekledigi icin
// bu pencere HTML'den DOGRUDAN gozlemlenemez (obligation 1'in kalici-null
// izdusumu burada YOK -- requestData GERCEKTEN dolacak); bunun yerine ilgili
// RPC cagrisi ELLE bir kapida durdurulup canli `setupState` o kapida
// okunuyor, sonra kapi acilip render'in dogru bicimde tamamlandigi dogrulanir.
describe('SolanaSignTx.vue (SSR) -- kart cozumlemesi surerken (C1)', () => {
    it('requestData dolu ama decode surerken dugme HALA kilitli, kartlar/maliyet UYDURULMAZ', async () => {
        let kapidanGecTetikle
        const kapidanGec = new Promise((resolve) => { kapidanGecTetikle = resolve })
        let kapiyiAc
        const kapi = new Promise((resolve) => { kapiyiAc = resolve })
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getMinimumBalanceForRentExemption') {
                kapidanGecTetikle()
                await kapi
                return 2039280
            }
            if (method === 'getBalance') return { value: 5_000_000_000 }
            return { value: [] }
        })

        const { app } = setup({ ...ISTEK, transactions: [ataTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const renderPromise = render(app)

        // ATA kirasi sorgusuna ULASILDIGI ANI bekle -- sabit sayida
        // Promise.resolve() turu saymaktan daha guvenilir, cunku onMounted
        // zincirinin ONCESINDE kac mikrogorev oldugu bu testin sorumlulugu
        // degil.
        await kapidanGec

        expect(holder.instance.setupState.requestData).not.toBeNull()
        expect(holder.instance.setupState.cozumlemeBitti).toBe(false)
        expect(holder.instance.setupState.kartlar).toHaveLength(0)

        kapiyiAc()
        const html = await renderPromise

        expect(holder.instance.setupState.cozumlemeBitti).toBe(true)
        // Kapi acildiktan sonra GERCEK (uydurulmamis) kira rakami ekranda.
        expect(html).toContain('0.002039280 SOL')
    })
})

// C3.1 (nihai inceleme -- Task 31'in ERTELEDIGI C1'in IKINCI kapisi): C1 fix
// yalniz "onMounted henuz bitmedi" penceresini kapatiyordu. kartKur'un
// KENDISI bir istisna FIRLATIRSA (parseDappTransaction TX_DESERIALIZE_FAILED
// atarsa) yukaridaki disaridaki try/finally onu YAKALAMAZ (catch YOK, yalniz
// finally) -- istisna dongudan disari sizip `kartlar.value = liste` satirina
// HIC ULASMAZ, ama `finally` yine de `cozumlemeBitti`yi true yapardi. Ekran
// SIFIR kart ile "cozumleme bitti" sanir, maliyet paneli UYDURULMUS
// "0.000000000 SOL" gosterir VE onay dugmesi ETKIN kalirdi -- Wallet
// Standard katmani gecmisse bugune kadar bu yolun HIC gercek bir bozuk
// base64 ile TETIKLENMEMIS olmasi (on-kapi ayni baytlari zaten ayristirdigi
// icin) bunu "olamaz" YAPMAZ, ekranin KENDI korumasi baska bir dosyaya
// DAYANMAMALI.
describe('SolanaSignTx.vue (SSR) -- kartKur cozumleme hatasi (C3.1)', () => {
    it('cozumlenemeyen tek islemde onay dugmesi kilitli kalir, maliyet UYDURULMAZ, hata paneli gosterilir', async () => {
        const { app } = setup({ ...ISTEK, transactions: ['AAAA'] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.cozumlemeBitti).toBe(true)
        expect(holder.instance.setupState.cozumlemeHatasi).toBe(true)
        expect(holder.instance.setupState.kartlar).toHaveLength(0)

        const dugmeAcilis = html.match(/<button[^>]*id="solana-sign-tx-approve"[^>]*>/)?.[0] || ''
        // DIKKAT (Gorev 14 emsali): `class` degeri statik "disabled:opacity-50"
        // gibi Tailwind varyant adlarini tasir -- class CIKARILMADAN yapilan
        // duz bir 'disabled' arattirmasi HER ZAMAN gecerdi.
        const classSiz = dugmeAcilis.replace(/class="[^"]*"/, '')
        expect(classSiz).toContain('disabled')

        // DUZ toContain('0.000000000') KULLANILMAZ: bilesenin KENDI kaynak
        // yorumlarinda (bkz. yukaridaki C1/C3.1 aciklamalari) bu TAM dizge
        // zaten metin olarak geciyor ve <template> icindeki statik yorumlar
        // Vue tarafindan HTML yorumu olarak render EDILIR -- duz bir
        // toContain, panel gercekten cizilmese bile o yorum yuzunden HER ZAMAN
        // eslesirdi. Asagidaki desen ozellikle taban ucret span'inin GERCEKTEN
        // veriyle doldugu bicimi hedefler.
        expect(html).not.toMatch(/tabular-nums">0\.000000000 SOL</)
        expect(html).toContain('The site sent a transaction the wallet could not read')
    })

    // signAll: BIRINCI islem GECERLI, IKINCI bozuk -- dongu ikincide kirilir,
    // ama birincinin cozulmus olmasi ekrani YARIM bir "basarili" duruma
    // DUSURMEMELI (§5.2 durustluk kurali burada da gecerli: yarim cozulmus
    // bir batch icin hala guvenli maliyet UYDURULAMAZ).
    it('signAll modunda BIR gecerli BIR bozuk islem OLSA da onay kilitli kalir', async () => {
        const { app } = setup({ ...ISTEK, mode: 'signAll', transactions: [transferTx(), 'AAAA'] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const html = await render(app)

        expect(holder.instance.setupState.cozumlemeHatasi).toBe(true)
        const dugmeAcilis = html.match(/<button[^>]*id="solana-sign-tx-approve"[^>]*>/)?.[0] || ''
        const classSiz = dugmeAcilis.replace(/class="[^"]*"/, '')
        expect(classSiz).toContain('disabled')
        // Yukaridaki testteki AYNI gerekce: duz toContain, KAYNAK yorumlarindaki
        // "0.000000000 SOL" metniyle (Vue'nun HTML yorumu olarak render ettigi)
        // YANLIS POZITIF verirdi.
        expect(html).not.toMatch(/tabular-nums">0\.000000000 SOL</)
    })
})

// Obligation 3 (Gorev 23 fix turunun AYNI bulgusu): `onayla` ve `reddet`
// oncesinde `catch` YOKTU. `chrome.runtime.sendMessage` REDDEDERSE (uzanti
// baglami gecersiz kilindi, service worker kapandi) yakalanmazsa kullanici
// tiklar, dugme tekrar etkinlesir ama dapp'e NE basari NE de red gider --
// GORUNURDE HICBIR SEY olmaz.
describe('SolanaSignTx.vue (SSR) -- sendMessage kendisi reddederse', () => {
    it('SOLANA_DAPP_SIGN_TX gonderimi REDDEDERSE cevirilmis hata gosterilir, sessiz sifirlama YOK', async () => {
        const { app, page, stub } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        // Basarili yanit veren varsayilan mock'u, reddeden (throw eden) bir
        // sahteyle DEGISTIRIYORUZ -- onMounted zaten tamamlandi, chrome.storage
        // cagrisi tekrar yapilmayacak, tek etkilenen yol onayla()'nin sendMessage'i.
        stub.setSendMessage(async () => { throw new Error('Extension context invalidated.') })

        await holder.instance.setupState.onayla()

        expect(holder.instance.setupState.loading).toBe(false)
        expect(holder.instance.setupState.hata).toBeTruthy()
        // Ham istisna mesaji ASLA ekrana yazilmaz (§3.6).
        expect(holder.instance.setupState.hata).not.toContain('Extension context invalidated')
        // Basarisizlikta eve DONULMEMELI -- kullanici hatayi gorup tekrar
        // deneyebilsin diye ayni ekranda kalmali.
        expect(page.currentPage).toBe('solana_sign_tx')
    })

    it('SEND_TX_REJECTED gonderimi REDDEDERSE cevirilmis hata gosterilir, sessiz sifirlama YOK', async () => {
        const { app, page, stub } = setup(ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        stub.setSendMessage(async () => { throw new Error('Extension context invalidated.') })

        await holder.instance.setupState.reddet()

        expect(holder.instance.setupState.hata).toBeTruthy()
        expect(holder.instance.setupState.hata).not.toContain('Extension context invalidated')
        // Arka plan reddi ALAMADIYSA kullanici "reddettim" saniyor olabilir ama
        // arka plan HABERSIZ -- ekran 'home'a GECMEMELI.
        expect(page.currentPage).toBe('solana_sign_tx')
    })
})

// Gorev 40: signAndSend rozetleri. Ekran UC semantik islemi tasir (sign /
// signAll / signAndSend); yayini KIMIN yapacagi gorunmezse kullanici
// "yalnizca imzaliyorum" sanip zincire giden bir islemi onaylar -- imzalanan
// bir islemi dapp istedigi zaman yayinlayabilir, ama YAYIN ANI kullanicinin
// bilmesi gereken bir seydir (ucret o an odenir).
describe('SolanaSignTx.vue (SSR) -- signAndSend rozeti', () => {
    it('signAndSend modunda "yayinlanacak" rozeti cizilir', async () => {
        const { app } = setup(SIGNANDSEND_ISTEK)
        const html = await render(app)
        expect(html).toContain('Will be broadcast')
    })

    // sign modunda yayin ROZETI CIKMAMALI: dapp'in kendi yayinlayacagi bir
    // islemde "yayinlanacak" demek yanlis bilgi verir.
    it('sign modunda rozet CIKMAZ', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).not.toContain('Will be broadcast')
    })

    // Durable nonce'ta blockhash tazeligi kontrolu ATLANIR (§6.5) -- kullanici
    // bu islemin sure sinirinin farkli calistigini gormeli.
    it('durable nonce rozeti yalnizca isDurableNonce ile cizilir', async () => {
        const { app } = setup({ ...SIGNANDSEND_ISTEK, isDurableNonce: true })
        expect(await render(app)).toContain('Durable nonce')

        const kapali = setup(SIGNANDSEND_ISTEK)
        expect(await render(kapali.app)).not.toContain('Durable nonce')
    })

    // Obligation 3 (Gorev 38): appMeta/favicon current_request'e YAZILIYOR ama
    // hicbir test bunu DOGRULAMIYORDU. Iddia edilen ad rozeti appMeta.name'den
    // (homoglif helper'inden gecerek) cizilir -- bu tek satir onu SABITLER.
    // K5'in GERCEK dominance/swap testi yukarida ("BASKIN <h2> TAM OLARAK
    // origin...") zaten var, burada TEKRARLANMIYOR (task-40 review,
    // Deviation 1 -- bu assertion varlik-her-yerde testi olarak KALIR,
    // ERTELENDI).
    it('iddia edilen ad rozeti appMeta.name den cizilir', async () => {
        const { app } = setup(SIGNANDSEND_ISTEK)
        const html = await render(app)
        expect(html).toContain('Jupiter')
    })
})

describe('SolanaSignTx.vue (SSR) -- signAndSend onayi', () => {
    // `mode` OLMADAN arka plan yayin dalina HIC girmez ve dapp'e imzali islem
    // doner: kullanicinin gordugu "yayinlanacak" rozeti YALAN olur.
    it('SOLANA_DAPP_SIGN_TX mesaji mode alanini TASIR', async () => {
        const { app, gonderilen } = setup(SIGNANDSEND_ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const imzaMsg = gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_TX')
        expect(imzaMsg.mode).toBe('signAndSend')
        // task-40 review Finding 4: ust duzey requestId `.requestId`den
        // okunmali (solanaDappFunctions.js:988-989), `.id`den DEGIL. Fixture'in
        // ikisi de 'req-sol-1' oldugu icin bu tek basina alan-swap'ini
        // yakalamaz -- SIGNANDSEND_ISTEK.requestId'ye karsi assert edilir ki
        // deger ayrisirsa (ornegin biri degisip digeri unutulursa) test
        // KIRMIZIYA donsun.
        expect(imzaMsg.requestId).toBe(SIGNANDSEND_ISTEK.requestId)
    })

    // Tasima yaniti (§3.3) HEM base58 dizgeyi HEM base64 bayti tasir: legacy
    // serit dizgeyi, Wallet Standard seridi baytlari kullanir. Ekran yaniti
    // OLDUGU GIBI iletir; alanlardan biri dusurulurse bir serit sessizce kirilir.
    it('arka planin yaniti dapp e OLDUGU GIBI iletilir', async () => {
        const { app, gonderilen } = setup(SIGNANDSEND_ISTEK, {
            imzaSonuc: { result: { signature: 'SIG58', signatureBytes: 'AAAA' } },
        })
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const ok = gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')
        expect(ok.requestId).toBe('req-sol-1')
        expect(ok.data.result.signature).toBe('SIG58')
        expect(ok.data.result.signatureBytes).toBe('AAAA')
    })

    // task-40 review Finding 5: broadcastStatusUnknown/broadcastError yalniz
    // `res.result`in BUTUNUYLE iletilmesi sayesinde dapp'e ulasiyor
    // (SolanaSignTx.vue: `data: { result: res.result }`) -- alan-alan yeniden
    // kurulan bir govde bunlari SESSIZCE dusurebilirdi, hicbir test
    // KIRMIZIYA donmezdi. Bu, ozel anahtar yolundaki DURUST-sonuc dalidir:
    // dugum islemi kabul ETMIS OLABILIR, ekran bunu HATA gibi GOSTERMEMELI.
    it('belirsiz yayinda broadcastStatusUnknown/broadcastError dapp e ulasir, ekranda HATA gosterilmez', async () => {
        const { app, gonderilen } = setup(SIGNANDSEND_ISTEK, {
            imzaSonuc: {
                result: {
                    signature: 'SIG58', signatureBytes: 'AAAA',
                    broadcastStatusUnknown: true, broadcastError: 'SOLANA_RPC_TIMEOUT',
                },
            },
        })
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const ok = gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')
        expect(ok.data.result.broadcastStatusUnknown).toBe(true)
        expect(ok.data.result.broadcastError).toBe('SOLANA_RPC_TIMEOUT')
        expect(holder.instance.setupState.hata).toBe('')
    })

    // Obligation 2 (Gorev 39 Minor 6): SEND_TX_SUCCESS gonderildikten SONRA
    // current_request'in diskten silinmesi ASENKRON'dur ve onayla()'nin
    // sendMessage'i bunu BEKLEMEZ (bkz. SolanaSignTx.vue'deki `gonderildi`
    // tanimindaki not) -- ikinci bir onay signAndSendFromApproval'i TEKRAR
    // calistirip TEKRAR yayinlayabilir. task-40 review Finding 2: onceki hali
    // AWAIT EDEREK sirayla cagiriyordu, bu da yalniz `gonderildi`yi (await'TEN
    // SONRA set edilir) olcuyordu -- `loading.value = true` await'TEN ONCE
    // atamasi bir yere KAYSA bile bu eski test YESIL kalirdi. Burada IKI cagri
    // AWAIT EDILMEDEN baslatilip Promise.all ile beklenir: GERCEK bir cift
    // tiklamanin ayni mikrogorev penceresinde iki onayla() tetikledigi durumu
    // taklit eder.
    it('onayla() iki kez EZAMANLI cagrilirsa SOLANA_DAPP_SIGN_TX yalnizca BIR kez gonderilir', async () => {
        const { app, gonderilen } = setup(SIGNANDSEND_ISTEK)
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)

        const ilk = holder.instance.setupState.onayla()
        const ikinci = holder.instance.setupState.onayla()
        await Promise.all([ilk, ikinci])

        const imzaMesajlari = gonderilen.filter((m) => m.type === 'SOLANA_DAPP_SIGN_TX')
        expect(imzaMesajlari.length).toBe(1)
    })
})

// V4-1 / V4-3: decodeInstructions'a `user` GECIRILMEZSE her CloseAccount
// (Jupiter wSOL kapatmasi dahil) fail-closed kirmizi kalir; yanlis kaynak
// (EVM `address`, fee payer) baglanirsa ya kor-kirmizi ya da SALDIRGAN adres
// "kullanici" sayilip bayrak SUSTURULUR. Kaynak: onay isteginin `from`i
// (cuzdanin KENDI urettigi oturum adresi, imza aninda kilitli); yedegi
// hesabin `solanaAddress`i. `account.address` EVM adresidir -- KULLANILMAZ.
describe('SolanaSignTx.vue (SSR) -- user kaynagi (V4-1, V4-3)', () => {
    const wsol = Keypair.generate().publicKey
    const baskasiHesap = Keypair.generate().publicKey
    const kapat = (rentTo, feePayer = CUZDAN.publicKey) => {
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = feePayer
        tx.add(createCloseAccountInstruction(wsol, rentTo, CUZDAN.publicKey))
        return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
    }

    async function bayrak(istek, hesap) {
        const stub = installChromeStub({
            current_request: istek,
            active_account: hesap || ACCOUNT,
            vaults: [{ id: 'v1', accounts: [hesap || ACCOUNT] }],
        })
        stub.setSendMessage(async () => ({}))
        const app = createApp(SolanaSignTx)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'solana_sign_tx'
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)
        return holder.instance.setupState.kartlar[0].talimatlar[0].redFlag
    }

    it('wSOL CloseAccount(kira kullaniciya = request.from) -> kirmizi DEGIL', async () => {
        expect(await bayrak({ ...ISTEK, transactions: [kapat(CUZDAN.publicKey)] })).toBe(false)
    })

    it('kira SALDIRGAN fee payer adresine -> kirmizi (fee payer "user" sayilmaz)', async () => {
        const saldirgan = Keypair.generate().publicKey
        expect(await bayrak({ ...ISTEK, transactions: [kapat(saldirgan, saldirgan)] })).toBe(true)
    })

    it('kira baska bir adrese -> kirmizi', async () => {
        expect(await bayrak({ ...ISTEK, transactions: [kapat(baskasiHesap)] })).toBe(true)
    })

    it('request.from yoksa hesabin solanaAddress i kullanilir (EVM address DEGIL)', async () => {
        const { from, ...fromsuz } = ISTEK
        expect(await bayrak({ ...fromsuz, transactions: [kapat(CUZDAN.publicKey)] })).toBe(false)
    })

    it('ne from ne solanaAddress varsa FAIL-CLOSED kirmizi (EVM adresine dusmez)', async () => {
        const { from, ...fromsuz } = ISTEK
        const evmHesap = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'A', type: 'hd' }
        expect(await bayrak({ ...fromsuz, transactions: [kapat(CUZDAN.publicKey)] }, evmHesap)).toBe(true)
    })

    it('kucuk harfe cevrilmis from fail-closed kirmizi (base58 harf duyarli)', async () => {
        expect(await bayrak({ ...ISTEK, from: FROM.toLowerCase(), transactions: [kapat(CUZDAN.publicKey)] })).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Gorev 9: statik katman -- tutar, alici, kirmizi bayrak, kor-imza kutusu (E2).
// Simulasyon bu gorevde BAGLI DEGIL (Gorev 10): durum hep "sonuc yok"; bu yuzden
// `hasUnknown` kutuyu simulasyondan BAGIMSIZ olarak zorunlu kilar.
// ---------------------------------------------------------------------------
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const MEMO_V2 = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const YABANCI_PROGRAM = new PublicKey('Stake11111111111111111111111111111111111111')
const SOL_ADRES = (k) => k.toBase58()

// feePayer'i secilebilen islem (txB64 yalniz CUZDAN'i odeyen yapar).
function txOdeyenli(instructions, odeyen = CUZDAN.publicKey) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = odeyen
    for (const ix of instructions) tx.add(ix)
    return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
}

const yabanciIx = (data = [7, 7, 7]) => new TransactionInstruction({
    programId: YABANCI_PROGRAM,
    keys: [{ pubkey: CUZDAN.publicKey, isSigner: true, isWritable: true }],
    data: Buffer.from(data),
})
const memoIx = (metin) => new TransactionInstruction({ programId: MEMO_V2, keys: [], data: Buffer.from(metin, 'utf8') })
const sol = (hedef, lamports) => SystemProgram.transfer({ fromPubkey: CUZDAN.publicKey, toPubkey: hedef, lamports })

async function ac(transactions, ekstra = {}) {
    const { app, gonderilen } = setup({ ...ISTEK, transactions, ...ekstra })
    const holder = captureInstance(app, 'SolanaSignTx')
    const html = await render(app)
    return { html, s: holder.instance.setupState, gonderilen }
}

// Gercek `disabled` niteligi: class degeri statik "disabled:opacity-50" tasir
// (Gorev 14 emsali), duz arama HER ZAMAN gecerdi.
const dugmeKilitli = (html) => {
    const acilis = html.match(/<button[^>]*id="solana-sign-tx-approve"[^>]*>/)?.[0] || ''
    return acilis.replace(/class="[^"]*"/, '').includes('disabled')
}
const imzaGonderildi = (gonderilen) => gonderilen.some((m) => m.type === 'SOLANA_DAPP_SIGN_TX')
const HAM_ANAHTAR = /dapps\.solana\./

// ---------------------------------------------------------------------------
// Gorev 10 yardimcilari: simulateTransaction yanitlari (islem BASINA) ve rpc taklidi.
// ---------------------------------------------------------------------------
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const USDC_MINT = USDC.toBase58()
const SAHTE_MINT = Keypair.generate().publicKey.toBase58() // kurasyonlu DEGIL
const kisaAdres = (a) => `${a.slice(0, 4)}...${a.slice(-4)}`

const legacyAnahtarlar = (b64) => Transaction.from(Buffer.from(b64, 'base64')).compileMessage().accountKeys.map((k) => k.toBase58())

const tokenKaydi = (mint, ham, decimals, sahip = FROM) => ({
    accountIndex: 1, mint, owner: sahip, uiTokenAmount: { amount: String(ham), decimals, uiAmount: null, uiAmountString: '' },
})

// `fee: null` -> yanitta fee alani HIC yok (getFeeForMessage yedegi calisir).
function simYaniti(b64, { sol: solFark = 0n, pre = [], post = [], err = null, fee = 5000, anahtarlar } = {}) {
    const keys = anahtarlar ?? legacyAnahtarlar(b64)
    const onceki = keys.map(() => 10_000_000_000)
    const i = keys.indexOf(FROM)
    const sonraki = onceki.map((v, k) => (k === i ? v + Number(solFark) : v))
    const value = {
        err, logs: [], preBalances: onceki, postBalances: sonraki, preTokenBalances: pre, postTokenBalances: post, unitsConsumed: 1,
    }
    if (fee !== null) value.fee = fee
    return { context: { slot: 1 }, value }
}

// `sim(b64, params)`: yanit | Error (reddedilir) | Promise. Diger yontemler Gorev 9'un varsayilanlari.
function simKur(sim, { feeYaniti = null } = {}) {
    solanaRpc.mockImplementation(async (method, params) => {
        if (method === 'simulateTransaction') {
            const y = await sim(params[0], params)
            if (y instanceof Error) throw y
            return y
        }
        if (method === 'getFeeForMessage') return feeYaniti ?? { value: null }
        if (method === 'getBalance') return { value: 5_000_000_000 }
        if (method === 'getMinimumBalanceForRentExemption') return 2039280
        return { value: [] }
    })
}
const simCagrilari = () => solanaRpc.mock.calls.filter((c) => c[0] === 'simulateTransaction')
const HESAPLANAMADI = 'The simulation is not available'
const KUTU_METNI = 'cannot fully check this transaction'
const ONCELIK_ONAY_METNI = 'the priority fee of this transaction is high'

describe('SolanaSignTx.vue (SSR) -- Gorev 9 tutar ve alici', () => {
    it('(i) System Transfer: tutar ve alici TAM adresle metinde, ham lamports DEGIL, kutu CIKMAZ', async () => {
        const hedef = Keypair.generate().publicKey
        const { html, s } = await ac([txOdeyenli([sol(hedef, 1_500_000_000)])])

        expect(html).toContain('Send SOL')
        expect(html).toContain('1.5 SOL')
        expect(html).toContain(SOL_ADRES(hedef))
        expect(html).not.toContain('1500000000')
        // "Talimatlardan okunan" ozet: cikis satiri.
        expect(html).toContain('Changes read from the instructions')
        expect(html).toContain('-1.5 SOL')
        // Zararsiz, tam cozulen transferde kor-imza kutusu CIKMAZ (Review Focus 2).
        expect(html).not.toContain('cannot fully check this transaction')
        expect(s.onayKilitli).toBe(false)
        expect(dugmeKilitli(html)).toBe(false)
        expect(html).not.toMatch(HAM_ANAHTAR)
    })

    it('(ii) TransferChecked + ATA: miktar sembolle, alici SAHIBI tam adres, kira ayri kalem', async () => {
        const sahip = Keypair.generate().publicKey
        const ata = getAssociatedTokenAddressSync(USDC, sahip)
        const { html, s } = await ac([txOdeyenli([
            createAssociatedTokenAccountInstruction(CUZDAN.publicKey, ata, sahip, USDC),
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, ata, CUZDAN.publicKey, 100_000_000n, 6),
        ])])

        expect(html).toContain('Send tokens')
        expect(html).toContain('100 USDC')
        // Alici TOKEN HESABI degil SAHIBI (tam adres).
        expect(html).toContain(SOL_ADRES(sahip))
        expect(html).toContain('Create a token account for another wallet')
        expect(html).toContain('-100 USDC')
        // Kira zincirden (getMinimumBalanceForRentExemption) gelen AYRI kalem.
        expect(html).toContain('Rent for new accounts')
        expect(html).toContain('0.002039280 SOL')
        expect(s.kirmiziBayrakVar).toBe(false)
        expect(html).not.toMatch(HAM_ANAHTAR)
    })

    it('Token-2022 satirinda token2022Note gorunur, klasik Token satirinda CIKMAZ', async () => {
        const sahip = Keypair.generate().publicKey
        const ata22 = getAssociatedTokenAddressSync(USDC, sahip, false, TOKEN_2022_PROGRAM_ID)
        const t22 = await ac([txOdeyenli([
            createAssociatedTokenAccountInstruction(CUZDAN.publicKey, ata22, sahip, USDC, TOKEN_2022_PROGRAM_ID),
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, ata22, CUZDAN.publicKey, 5_000_000n, 6, [], TOKEN_2022_PROGRAM_ID),
        ])])
        expect(t22.html).toContain('Nominal amount; fees or hooks may apply.')

        const ata = getAssociatedTokenAddressSync(USDC, sahip)
        const klasik = await ac([txOdeyenli([
            createAssociatedTokenAccountInstruction(CUZDAN.publicKey, ata, sahip, USDC),
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, ata, CUZDAN.publicKey, 5_000_000n, 6),
        ])])
        expect(klasik.html).not.toContain('Nominal amount')
    })

    it('(xvii) cozulemeyen alici/token ham anahtar degil fieldUnresolved/tokenUnresolved ile, ham miktar uydurulmadan', async () => {
        // Hedef/kaynak token hesaplari zincirde okunamiyor (varsayilan taklit bos doner).
        const bilinmeyenHedef = Keypair.generate().publicKey
        const checked = await ac([txOdeyenli([
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, bilinmeyenHedef, CUZDAN.publicKey, 5_000_000n, 6),
        ])])
        // NEDENE YANSIZ: alici sahibi RPC'den okunamadi; "adres arama tablosu" denmez (final SU-8).
        expect(checked.html).toContain('could not be read')
        expect(checked.html).not.toContain('address lookup table')
        expect(checked.html).not.toContain('could not be resolved')
        // Alici sahibi bilinmiyorsa en azindan TOKEN HESABI adresi tam gorunur (dogruluk, uydurma degil).
        expect(checked.html).toContain(SOL_ADRES(bilinmeyenHedef))
        expect(checked.html).not.toMatch(HAM_ANAHTAR)
        expect(checked.s.onayKilitli).toBe(true) // alici cozulemedi -> hasUnknown

        // Klasik Transfer: mint/decimals YALNIZ kaynak hesaptan gelir -> cozulemez.
        const duz = await ac([txOdeyenli([
            createTransferInstruction(Keypair.generate().publicKey, bilinmeyenHedef, CUZDAN.publicKey, 5_000_000n),
        ])])
        expect(duz.html).toContain('token not recognized')
        expect(duz.html).toContain('5000000')
        expect(duz.html).not.toMatch(HAM_ANAHTAR)
    })
})

describe('SolanaSignTx.vue (SSR) -- Gorev 9 kirmizi bayrak ve kor-imza kutusu', () => {
    it('(iii)/(xiii) sinirsiz Approve: kirmizi serit + f.unlimited + spender TAM adres, kutu ZORUNLU', async () => {
        const harcayan = Keypair.generate().publicKey
        const { html, s, gonderilen } = await ac([txOdeyenli([
            createApproveInstruction(Keypair.generate().publicKey, harcayan, CUZDAN.publicKey, 2n ** 64n - 1n),
        ])])

        expect(s.kirmiziBayrakVar).toBe(true)
        expect(html).toContain('This transaction can hand over control of your tokens or accounts')
        expect(html).toContain('Unlimited')
        // Sinirsizda mevcut metin kalir (final SU-18).
        expect(html).toContain('open-ended allowance')
        expect(html).not.toContain('spend up to the amount shown')
        expect(html).toContain(SOL_ADRES(harcayan))
        expect(html).toContain('cannot fully check this transaction')
        // Kutu SIMULASYONDAN BAGIMSIZ: kirmizi bayrak her zaman kutu ister.
        expect(s.onayKilitli).toBe(true)
        expect(dugmeKilitli(html)).toBe(true)
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(false)
        s.korImzaOnayi = true
        expect(s.onayKilitli).toBe(false)
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(true)
        expect(html).not.toMatch(HAM_ANAHTAR)
    })

    it('sinirli (sifir olmayan) Approve de kirmizi ve kutu ister ama "Unlimited" DEMEZ', async () => {
        const { html, s } = await ac([txOdeyenli([
            createApproveInstruction(Keypair.generate().publicKey, Keypair.generate().publicKey, CUZDAN.publicKey, 10n),
        ])])
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).not.toContain('Unlimited')
    })

    it('(iv) Jupiter benzeri: bilinmeyen programlar TEK grup, wSOL CloseAccount(kullaniciya) kirmizi DEGIL', async () => {
        const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, CUZDAN.publicKey)
        const { html, s } = await ac([txOdeyenli([
            createAssociatedTokenAccountInstruction(CUZDAN.publicKey, wsol, CUZDAN.publicKey, NATIVE_MINT),
            sol(wsol, 1_000_000),
            createSyncNativeInstruction(wsol),
            yabanciIx([1]),
            yabanciIx([2]),
            createCloseAccountInstruction(wsol, CUZDAN.publicKey, CUZDAN.publicKey),
        ])])

        expect(s.kirmiziBayrakVar).toBe(false)
        expect(html).not.toContain('This transaction can hand over control')
        // Iki bilinmeyen talimat TEK grup satirinda (n=2); ayrintisi acilir icinde.
        expect((html.match(/2 more instructions the wallet cannot read/g) || []).length).toBe(1)
        expect(html).toContain('<details')
        // Bilinmeyen program VAR -> sabit uyari + simulasyonsuz kutu.
        expect(html).toContain('This program is not recognized')
        expect(s.onayKilitli).toBe(true)
    })

    it('(vi) bilinmeyen program: onayKilitli true, kutu isaretlenince false, kutu YOKKEN onayla() dogrudan cagrisi IPTAL', async () => {
        const { html, s, gonderilen } = await ac([txOdeyenli([yabanciIx()])])

        expect(s.onayKilitli).toBe(true)
        expect(dugmeKilitli(html)).toBe(true)
        expect(html).toContain('cannot fully check this transaction')

        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(false)
        expect(gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')).toBeUndefined()

        s.korImzaOnayi = true
        expect(s.onayKilitli).toBe(false)
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(true)
    })

    it('(xv) ComputeBudget + Memo + duz transfer: tam cozulen, kutu CIKMAZ, unknownProgramWarning YOK', async () => {
        const { html, s } = await ac([txOdeyenli([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
            sol(Keypair.generate().publicKey, 1000),
            memoIx('hello'),
        ])])
        expect(s.onayKilitli).toBe(false)
        expect(html).not.toContain('cannot fully check this transaction')
        expect(html).not.toContain('This program is not recognized')
    })

    it('(xiv) ALT cozumu + simulasyonsuz: HEPSI reject, alici ALT te -> kutu zorunlu (v0)', async () => {
        solanaRpc.mockRejectedValue(new Error('SOLANA_RPC_TIMEOUT'))
        const { html, s } = await ac([v0AltTx()])
        expect(s.altCozulemedi).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain('cannot fully check this transaction')
        expect(html).not.toMatch(HAM_ANAHTAR)
    })

    it('(xiv-b) ALT yaniti bos/uyumsuz dizi donerse de cozulmedi sayilir ve kutu zorunlu', async () => {
        // varsayilan taklit getMultipleAccounts icin { value: [] } doner (uzunluk 0 != 1).
        const { s } = await ac([v0AltTx()])
        expect(s.altCozulemedi).toBe(true)
        expect(s.onayKilitli).toBe(true)
    })

    it('(xvi) AdvanceNonceAccount: durableNonceWarning gorunur, duz transferde GORUNMEZ', async () => {
        const nonceTx = txOdeyenli([
            SystemProgram.nonceAdvance({ noncePubkey: Keypair.generate().publicKey, authorizedPubkey: CUZDAN.publicKey }),
            sol(CUZDAN.publicKey, 1),
        ])
        const { html } = await ac([nonceTx])
        expect(html).toContain('This transaction may stay valid indefinitely')

        const duz = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])])
        expect(duz.html).not.toContain('This transaction may stay valid indefinitely')
    })

    it('(xvii) redFlag_<type> cizilir ve ham anahtar GORUNMEZ: kullanici hesabini programa devreden Assign kirmizi', async () => {
        const { html, s } = await ac([txOdeyenli([
            SystemProgram.assign({ accountPubkey: CUZDAN.publicKey, programId: YABANCI_PROGRAM }),
        ])])
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(html).toContain('Gives another program control of this account.')
        expect(html).not.toMatch(HAM_ANAHTAR)
        expect(s.onayKilitli).toBe(true)
    })

    it('kira alicisi = fee payer olan saldirgan CloseAccount: kirmizi ve kutu zorunlu (user fee payer DEGIL)', async () => {
        const saldirgan = Keypair.generate()
        const kapat = createCloseAccountInstruction(Keypair.generate().publicKey, saldirgan.publicKey, CUZDAN.publicKey)
        const { html, s } = await ac([txOdeyenli([kapat], saldirgan.publicKey)])
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain(SOL_ADRES(saldirgan.publicKey))
        // user = request.from: fee payer kullanici SAYILMADI.
        expect(s.kartlar[0].preview.feePayerIsUser).toBe(false)
        expect(s.kartlar[0].preview.feePayer).toBe(SOL_ADRES(saldirgan.publicKey))
    })

    it('baskasina ait token hesabi sahipligini InitializeAccount3 ile alan islem: sahip TAM adres, kutu zorunlu', async () => {
        const sahip = Keypair.generate().publicKey
        const { html, s } = await ac([txOdeyenli([
            createInitializeAccount3Instruction(Keypair.generate().publicKey, USDC, sahip),
        ])])
        expect(html).toContain('Set up a token account')
        expect(html).toContain(SOL_ADRES(sahip))
        expect(s.onayKilitli).toBe(true)
    })

    it('Gorev 5 devri: CreateAccount kira tabanini asan lamports "fon aktarimi" olarak yeni hesap TAM adresiyle, "kira" DEGIL', async () => {
        const yeni = Keypair.generate().publicKey
        const { html, s } = await ac([txOdeyenli([
            SystemProgram.createAccount({
                fromPubkey: CUZDAN.publicKey, newAccountPubkey: yeni, lamports: 50_000_000_000, space: 0, programId: SystemProgram.programId,
            }),
        ])])
        expect(html).toContain('Funds sent to the new account')
        expect(html).toContain('49.99910912 SOL')
        expect(html).toContain(SOL_ADRES(yeni))
        // Maliyet panelindeki kira YALNIZ taban: 128 * 6960 = 890880 lamport.
        expect(html).toContain('0.000890880 SOL')
        expect(html).not.toContain('50.000000000 SOL')
        expect(s.kiraLamports).toBe(890880)
    })

    it('Q2 karari: moreAddresses uyarisi ekranda GOSTERILMEZ (kapi bagli degil), adresler yine TAM', async () => {
        const hedefler = Array.from({ length: 6 }, () => Keypair.generate().publicKey)
        const { html } = await ac([txOdeyenli(hedefler.map((h) => sol(h, 1000)))])
        expect(html).not.toContain('more addresses were not checked')
        for (const h of hedefler) expect(html).toContain(SOL_ADRES(h))
    })
})

describe('SolanaSignTx.vue (SSR) -- Gorev 9 ucret karti ve kira', () => {
    it('(xi) ham priorityFeeLabel muL satiri CIZILMEZ', async () => {
        const { html, s } = await ac([txOdeyenli([
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
            sol(Keypair.generate().publicKey, 1000),
        ])])
        expect(s.butce.unitPriceMicroLamports).not.toBeNull()
        expect(html).not.toContain('µL')
        // Yalniz taban ucret, "en az" etiketiyle ve ucreti odeyenle birlikte.
        expect(html).toContain('Total network fee')
        expect(html).toContain('at least')
        expect(html).toContain('0.000005000 SOL')
    })

    it('ucreti odeyen kullanici: "Sen", ucret kullanicidan sayilir (yetersiz bakiye uyarisi cikar)', async () => {
        solanaRpc.mockImplementation(async (method) => (method === 'getBalance' ? { value: 100 } : { value: [] }))
        const { html, s } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])])
        expect(html).toContain('Fee paid by')
        expect(html).toMatch(/>You</)
        expect(s.bakiyeYetersiz).toBe(true)
    })

    it('(xi) ucreti odeyen BASKA: kisa(feePayer) gosterilir ve ucret kullanicidan dusulmus SAYILMAZ', async () => {
        solanaRpc.mockImplementation(async (method) => (method === 'getBalance' ? { value: 100 } : { value: [] }))
        const odeyen = Keypair.generate().publicKey
        const { html, s } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)], odeyen)])
        expect(html).toContain('Fee paid by')
        expect(html).toContain('another account')
        expect(html).toContain(`${SOL_ADRES(odeyen).slice(0, 4)}...${SOL_ADRES(odeyen).slice(-4)}`)
        expect(html).not.toMatch(/>You</)
        // 100 lamport < iki imzanin 10000 lamport ucreti OLSA da: ucreti kullanici odemiyor.
        expect(s.bakiyeYetersiz).toBe(false)
        expect(html).not.toContain('does not cover')
    })

    it('okunamayan oncelik ucreti uydurulmaz, "okunamadi" olarak kalir (mevcut durustluk korunur)', async () => {
        const base64 = txB64([new TransactionInstruction({ programId: new PublicKey(COMPUTE_BUDGET_PROGRAM_ID), keys: [], data: Buffer.from([3]) })])
        const { html, s } = await ac([base64])
        expect(s.oncelikUcretiOkunamadi).toBe(true)
        expect(html).toContain('could not be read')
    })
})

describe('SolanaSignTx.vue (SSR) -- Gorev 9 memo ve dapp metni', () => {
    it('Memo: sabit memoUntrusted etiketi, tirnak icinde, tek satir; HTML metin olarak cizilir', async () => {
        const { html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000), memoIx('<img src=x onerror=alert(1)>\nikinci satir')])])
        expect(html).toContain('Text written by the dApp, not verified')
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        expect(html).not.toContain('<img src=x')
        // Satir sonu tek satira katlanir.
        expect(html).toContain('ikinci satir')
        expect(html).not.toMatch(/alert\(1\)&gt;\nikinci/)
    })

    it('Memo 140 karakterden uzunsa kirpilir ve memoTruncated gosterilir', async () => {
        const { html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000), memoIx('x'.repeat(300))])])
        expect(html).toContain('x'.repeat(140))
        expect(html).not.toContain('x'.repeat(141))
        expect(html).toContain('text shortened')
    })

    it('dapp adi (appMeta.name) HTML icerse metin olarak cizilir', async () => {
        const { html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])], {
            appMeta: { name: '<b>Evil</b>', icon: null, url: 'https://cdn.example.com' },
        })
        expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;')
        expect(html).not.toContain('<b>Evil</b>')
    })

    it('(xii) kaynak taramasi: ham HTML enjeksiyonu yok ve $t cagrilarinda adres parametresi gecmez', () => {
        for (const dosya of ['SolanaSignTx.vue', 'SolanaTxCard.vue']) {
            const kaynak = readFileSync(new URL(`./${dosya}`, import.meta.url), 'utf8')
            expect(kaynak, dosya).not.toMatch(/v-html/)
            // $t('anahtar', { ... }) / t('anahtar', { ... }) parametre adlari
            const parametreler = [...kaynak.matchAll(/\$?\bt\(\s*(['"`])[^'"`]+\1\s*,\s*\{([^}]*)\}/g)]
                .flatMap((m) => m[2].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean))
            // Izinli: sayac (n) ve dapp adi (name, yalniz iddia pilinde). Adres/alici/spender/mint/program YASAK.
            for (const p of parametreler) expect(['n', 'name'], `${dosya}: $t parametresi ${p}`).toContain(p)
        }
    })
})

describe('SolanaSignTx.vue (SSR) -- Gorev 9 cozumleme akisi', () => {
    it('cozumleme surerken (decode/ATA kira) onayKilitli true; bitince serbest', async () => {
        let ulasildi
        const ulasti = new Promise((r) => { ulasildi = r })
        let kapiyiAc
        const kapi = new Promise((r) => { kapiyiAc = r })
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getMinimumBalanceForRentExemption') { ulasildi(); await kapi; return 2039280 }
            if (method === 'getBalance') return { value: 5_000_000_000 }
            return { value: [] }
        })
        const { app } = setup({ ...ISTEK, transactions: [ataTx()] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const renderSoz = render(app)
        await ulasti
        expect(holder.instance.setupState.cozumlemeBitti).toBe(false)
        expect(holder.instance.setupState.onayKilitli).toBe(true)
        kapiyiAc()
        await renderSoz
        expect(holder.instance.setupState.onayKilitli).toBe(false)
    })

    it('cozumleme hatasi (bozuk islem) onayKilitli true tutar', async () => {
        const { s } = await ac(['AAAA'])
        expect(s.cozumlemeHatasi).toBe(true)
        expect(s.onayKilitli).toBe(true)
    })

    it('signAll: kartlar kendi onizlemesini tasir; biri bilinmeyen program ise TUM ekran kilitli', async () => {
        const { s } = await ac([
            txOdeyenli([sol(Keypair.generate().publicKey, 1000)]),
            txOdeyenli([yabanciIx()]),
        ], { mode: 'signAll' })
        expect(s.kartlar).toHaveLength(2)
        expect(s.kartlar[0].preview.hasUnknown).toBe(false)
        expect(s.kartlar[1].preview.hasUnknown).toBe(true)
        expect(s.onayKilitli).toBe(true)
    })
})

describe('SolanaSignTx.vue (SSR) -- Gorev 9 ek vakalar (patron devirleri)', () => {
    it('kind:other satiri (FreezeAccount): genel "ozetlenmeyen talimat" basligi + sabit tip adi, ham anahtar GORUNMEZ', async () => {
        const { html, s } = await ac([txOdeyenli([
            createFreezeAccountInstruction(Keypair.generate().publicKey, USDC, CUZDAN.publicKey),
        ])])
        expect(html).toContain('Instruction the wallet does not summarize')
        expect(html).toContain('FreezeAccount')
        expect(html).not.toMatch(HAM_ANAHTAR)
        expect(s.kartlar[0].preview.rows[0].titleKey).toBeNull()
    })

    // Gorev 10: `simulasyonSonucuVar` artik GERCEK simulasyon sonucuna bagli (eskiden yer tutucuydu, hep false;
    // test onu elle true yapiyordu). Sonuc simulateTransaction yanitindan gelir.
    it('Constraint 23 kilit tablosu: kirmizi bayrak simulasyon sonucundan BAGIMSIZ kutu ister; hasUnknown kutusu yalniz simulasyon sonucu YOKKEN', async () => {
        // (a) kirmizi bayrak, bilinmeyen YOK (Assign): simulasyon BASARILI olsa da kilit KALKMAZ.
        // Yeni sahip BILINEN program (System): bilinmeyen sahibe Assign artik hasUnknown'dur (final SU-1).
        const assignTx = txOdeyenli([SystemProgram.assign({ accountPubkey: CUZDAN.publicKey, programId: SystemProgram.programId })])
        solanaRpc.mockImplementation(async (method) => (method === 'getBalance' ? { value: 5_000_000_000 } : { value: [] }))
        const kirmiziYok = await ac([assignTx])
        expect(kirmiziYok.s.simulasyonSonucuVar).toBe(false)
        expect(kirmiziYok.s.onayKilitli).toBe(true)
        simKur((b64) => simYaniti(b64))
        const kirmizi = await ac([assignTx])
        expect(kirmizi.s.kirmiziBayrakVar).toBe(true)
        expect(kirmizi.s.bilinmeyenVar).toBe(false)
        expect(kirmizi.s.simulasyonSonucuVar).toBe(true)
        expect(kirmizi.s.onayKilitli).toBe(true)

        // (b) yalniz hasUnknown (bilinmeyen program): sonuc yokken kilitli, sonuc gelince kilit kalkar.
        const bilinmeyenTx = txOdeyenli([yabanciIx()])
        solanaRpc.mockImplementation(async (method) => (method === 'getBalance' ? { value: 5_000_000_000 } : { value: [] }))
        const bilinmeyenYok = await ac([bilinmeyenTx])
        expect(bilinmeyenYok.s.kirmiziBayrakVar).toBe(false)
        expect(bilinmeyenYok.s.bilinmeyenVar).toBe(true)
        expect(bilinmeyenYok.s.simulasyonSonucuVar).toBe(false)
        expect(bilinmeyenYok.s.onayKilitli).toBe(true)
        simKur((b64) => simYaniti(b64))
        const bilinmeyen = await ac([bilinmeyenTx])
        expect(bilinmeyen.s.simulasyonSonucuVar).toBe(true)
        expect(bilinmeyen.s.onayKilitli).toBe(false)
    })

    it('user kaynagi: request.from yoksa hesabin solanaAddress i yedek olur ve onizleme AYNI user ile kurulur (ucreti odeyen "Sen")', async () => {
        const { html, s } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])], { from: undefined })
        expect(s.kullaniciAdresi).toBe(FROM)
        expect(s.kartlar[0].preview.feePayerIsUser).toBe(true)
        expect(html).toMatch(/>You</)
    })

    it('user kaynagi: EVM adresi (account.address) ASLA kullanici sayilmaz', async () => {
        // from yok VE hesabin solanaAddress i yok: user null kalir (fail-closed), 0x adresi devralmaz.
        const kimliksiz = { ...ACCOUNT, solanaAddress: undefined }
        const stub = installChromeStub({
            current_request: { ...ISTEK, from: undefined, transactions: [txOdeyenli([sol(Keypair.generate().publicKey, 1000)])] },
            active_account: kimliksiz,
            vaults: [{ id: 'v1', accounts: [kimliksiz] }],
        })
        stub.setSendMessage(async () => ({}))
        const app = createApp(SolanaSignTx)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'solana_sign_tx'
        const holder = captureInstance(app, 'SolanaSignTx')
        await render(app)
        expect(holder.instance.setupState.kullaniciAdresi).toBeNull()
        expect(holder.instance.setupState.kartlar[0].preview.feePayerIsUser).toBe(false)
    })

    it('mint i okunamayan saglayici yanitindan gelen token tutari SOL toplamina KARISMAZ (ozet yalniz gercek SOL)', async () => {
        const sahip = Keypair.generate().publicKey
        solanaRpc.mockImplementation(async (method, params) => {
            if (method === 'getBalance') return { value: 5_000_000_000 }
            if (method === 'getMultipleAccounts' && params?.[1]?.encoding === 'jsonParsed') {
                return { value: params[0].map(() => ({
                    data: { program: 'spl-token', parsed: { type: 'account', info: { mint: 'bozuk-mint', owner: SOL_ADRES(sahip), tokenAmount: { decimals: 6 } } } },
                })) }
            }
            return { value: [] }
        })
        const { html, s } = await ac([txOdeyenli([
            sol(Keypair.generate().publicKey, 1_000_000_000),
            createTransferInstruction(Keypair.generate().publicKey, Keypair.generate().publicKey, CUZDAN.publicKey, 5_000_000n),
        ])])
        expect(html).toContain('-1 SOL')
        expect(html).not.toContain('1.005')
        expect(s.statikOzet).toHaveLength(1)
        // mint cozulemedi -> kilit (hasUnknown), simulasyon yok
        expect(s.onayKilitli).toBe(true)
    })

    it('token baglami 4 sn icinde gelmezse istek GERCEKTEN iptal edilir (signal), ekran acilir ve kilit kalkmaz', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            let sinyal = null
            solanaRpc.mockImplementation((method, params, secenek) => {
                if (method === 'getBalance') return Promise.resolve({ value: 5_000_000_000 })
                if (method === 'getMultipleAccounts') {
                    sinyal = secenek?.signal ?? null
                    return new Promise((_, reject) => {
                        sinyal?.addEventListener('abort', () => reject(new Error('SOLANA_RPC_ABORTED')))
                    })
                }
                return Promise.resolve({ value: [] })
            })
            const { app } = setup({ ...ISTEK, transactions: [txOdeyenli([
                createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, Keypair.generate().publicKey, CUZDAN.publicKey, 5_000_000n, 6),
            ])] })
            const holder = captureInstance(app, 'SolanaSignTx')
            const render1 = render(app)
            for (let i = 0; i < 200 && sinyal === null; i += 1) await new Promise((r) => setImmediate(r))
            expect(sinyal).not.toBeNull()
            expect(sinyal.aborted).toBe(false)
            await vi.advanceTimersByTimeAsync(4000)
            expect(sinyal.aborted).toBe(true)
            await render1
            expect(holder.instance.setupState.cozumlemeBitti).toBe(true)
            // alici sahibi cozulemedi: fail-open ama KILITLI (kor-imza kutusu)
            expect(holder.instance.setupState.onayKilitli).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it('ham anahtar taramasi: tum yeni satir/uyari/alan turleri tek ekranda cizilince hicbir dapps.solana. anahtari gorunmez', async () => {
        const sahip = Keypair.generate().publicKey
        const ata = getAssociatedTokenAddressSync(USDC, sahip)
        const { html } = await ac([txOdeyenli([
            // Durable nonce: AdvanceNonceAccount ILK talimat olmak zorunda (calisma zamani kurali).
            SystemProgram.nonceAdvance({ noncePubkey: Keypair.generate().publicKey, authorizedPubkey: CUZDAN.publicKey }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
            createAssociatedTokenAccountInstruction(CUZDAN.publicKey, ata, sahip, USDC),
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, ata, CUZDAN.publicKey, 100_000_000n, 6),
            createApproveInstruction(Keypair.generate().publicKey, Keypair.generate().publicKey, CUZDAN.publicKey, 2n ** 64n - 1n),
            createFreezeAccountInstruction(Keypair.generate().publicKey, USDC, CUZDAN.publicKey),
            yabanciIx(),
            memoIx('merhaba'),
        ])])
        expect(html).not.toMatch(HAM_ANAHTAR)
        expect(html).toContain('Unlimited')
        expect(html).toContain('This program is not recognized')
        expect(html).toContain('This transaction may stay valid indefinitely')
    })
})

// ---------------------------------------------------------------------------
// ALT (v0) -- statik katman: cozulen ALT kilidi acar, cozulemeyen ALT (talimat
// alanlari tam okunsa bile) kilitler (Constraint 23).
// ---------------------------------------------------------------------------
// Zincirdeki ALT hesap duzeni: 56 bayt baslik (typeIndex u32=1, deactivationSlot u64=max, ...) + 32 bayt adresler.
const tabloVerisi = (adresler) => {
    const baslik = Buffer.alloc(56)
    baslik.writeUInt32LE(1, 0)
    baslik.writeBigUInt64LE(2n ** 64n - 1n, 4)
    return Buffer.concat([baslik, ...adresler.map((a) => a.toBuffer())]).toString('base64')
}
const altTablosu = (adresler) => new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedStartIndex: 0, authority: undefined, addresses: adresler },
})
const v0Tx = (ix, tablo) => Buffer.from(new VersionedTransaction(new TransactionMessage({
    payerKey: CUZDAN.publicKey, recentBlockhash: BLOCKHASH, instructions: [ix],
}).compileToV0Message([tablo])).serialize()).toString('base64')
const altYaniti = (tablo) => async (method, params) => {
    if (method === 'getBalance') return { value: 5_000_000_000 }
    if (method === 'getMinimumBalanceForRentExemption') return 2039280
    if (method === 'getMultipleAccounts' && params?.[1]?.encoding === 'base64') {
        return { value: [{ data: [tabloVerisi(tablo.state.addresses), 'base64'] }] }
    }
    return { value: [] }
}

describe('SolanaSignTx.vue (SSR) -- Gorev 9 ALT (v0) statik katman', () => {
    it('ALT BASARIYLA cozulunce alici ALT ten okunur, TAM adresle gorunur ve kutu CIKMAZ', async () => {
        const hedef = Keypair.generate().publicKey
        const tablo = altTablosu([hedef])
        solanaRpc.mockImplementation(altYaniti(tablo))
        const { html, s } = await ac([v0Tx(sol(hedef, 1_000_000_000), tablo)])
        expect(s.altCozulemedi).toBe(false)
        expect(html).toContain(SOL_ADRES(hedef))
        expect(html).toContain('-1 SOL')
        expect(s.onayKilitli).toBe(false)
        expect(html).not.toContain('cannot fully check this transaction')
    })

    it('ALT yaniti tabloda OLMAYAN indeksi gosteriyorsa cozulmedi sayilir (altCozulemedi + uyari metni + kutu)', async () => {
        const hedef = Keypair.generate().publicKey
        const tablo = altTablosu([hedef])
        // Zincirden donen tablo bos: islemin gosterdigi indeks tabloda yok.
        solanaRpc.mockImplementation(altYaniti(altTablosu([])))
        const { html, s } = await ac([v0Tx(sol(hedef, 1000), tablo)])
        expect(s.altCozulemedi).toBe(true)
        expect(html).toContain('lookup table the wallet could not read')
        expect(s.onayKilitli).toBe(true)
    })

    it('ALT cozulemedi ama talimat alanlari statik anahtarlardan TAM okundu: kutu yine zorunlu (cozulemeyen ALT adresi = hasUnknown)', async () => {
        const hedef = Keypair.generate().publicKey
        const ekstra = Keypair.generate().publicKey
        const tablo = altTablosu([ekstra])
        // System Transfer + ALT te yatan ucuncu (kullanilmayan) hesap: alici/tutar statik, ALT adresi talimat alanlarina GIRMEZ.
        const ix = new TransactionInstruction({
            programId: SystemProgram.programId,
            keys: [
                { pubkey: CUZDAN.publicKey, isSigner: true, isWritable: true },
                { pubkey: hedef, isSigner: false, isWritable: true },
                { pubkey: ekstra, isSigner: false, isWritable: false },
            ],
            data: sol(hedef, 1000).data,
        })
        solanaRpc.mockRejectedValue(new Error('SOLANA_RPC_TIMEOUT'))
        const { html, s } = await ac([v0Tx(ix, tablo)])
        expect(s.altCozulemedi).toBe(true)
        expect(s.kartlar[0].preview.hasUnknown).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain('cannot fully check this transaction')
    })
})

// ---------------------------------------------------------------------------
// S9-G9-S2: CloseAccount hedefe hesaptaki SOL'un TAMAMINI yollar (native/wSOL
// hesapta kira + sarili bakiye). Eskiden ekran yalniz "kira" diyor ve tutari
// hic gostermiyordu; kullanicinin 50 wSOL'luk hesabi "kira" gibi gosterilerek
// alinabiliyordu (kutu isaretlenirse).
// ---------------------------------------------------------------------------
describe('SolanaSignTx.vue (SSR) -- CloseAccount tutari (S9-G9-S2)', () => {
    const KAPATILAN = Keypair.generate().publicKey
    const wsolYaniti = (lamports, { native = true } = {}) => ({
        lamports,
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        data: {
            program: 'spl-token',
            space: 165,
            parsed: {
                type: 'account',
                info: {
                    isNative: native,
                    mint: native ? NATIVE_MINT.toBase58() : Keypair.generate().publicKey.toBase58(),
                    owner: FROM,
                    state: 'initialized',
                    tokenAmount: { amount: native ? String(lamports - 2_039_280) : '0', decimals: 9, uiAmountString: '0' },
                },
            },
        },
    })
    const rpcYaniti = (yanit) => async (method, params) => {
        if (method === 'getBalance') return { value: 5_000_000_000 }
        if (method === 'getMinimumBalanceForRentExemption') return 2039280
        if (method === 'getMultipleAccounts' && params?.[1]?.encoding === 'jsonParsed') return yanit(params[0])
        return { value: [] }
    }
    const kapat = (hedef) => createCloseAccountInstruction(KAPATILAN, hedef, CUZDAN.publicKey)

    it('kullanicinin 50 wSOL luk hesabi saldirgana kapatiliyor: tutar + TAM adres + kirmizi + kutu, statik ozette giden', async () => {
        const saldirgan = Keypair.generate().publicKey
        const sorulan = []
        solanaRpc.mockImplementation(rpcYaniti((adresler) => {
            sorulan.push(adresler)
            return { value: [wsolYaniti(50_002_039_280)] }
        }))
        const { html, s } = await ac([txOdeyenli([kapat(saldirgan)])])

        // Kapatilan hesap getMultipleAccounts(jsonParsed) ile sorulur (yeni RPC metodu yok).
        expect(sorulan).toEqual([[KAPATILAN.toBase58()]])
        expect(html).toContain('50.00203928 SOL')
        expect(html).toContain(SOL_ADRES(saldirgan))
        // Dogru metin: "yalniz kira" izlenimi YOK, sarili SOL acikca soylenir.
        expect(html).toContain('wrapped SOL')
        expect(html).toContain('All SOL in the account now')
        expect(html).not.toContain('Sends the remaining rent of this account to another address.')
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain('cannot fully check this transaction')
        // Statik ozet bu tutari GIDEN sayar.
        expect(html).toContain('-50.00203928 SOL')
        expect(s.statikOzet.map((o) => o.tutar)).toEqual(['50.00203928'])
        expect(html).not.toMatch(HAM_ANAHTAR)
    })

    it('RPC reddedilir: tutar okunamadi, "tum SOL gidebilir" + kirmizi + kutu (fail-closed), sahte tutar YOK', async () => {
        const saldirgan = Keypair.generate().publicKey
        solanaRpc.mockImplementation(async (method, params) => {
            if (method === 'getMultipleAccounts' && params?.[1]?.encoding === 'jsonParsed') throw new Error('403')
            if (method === 'getBalance') return { value: 5_000_000_000 }
            if (method === 'getMinimumBalanceForRentExemption') return 2039280
            return { value: [] }
        })
        const { html, s } = await ac([txOdeyenli([kapat(saldirgan)])])
        expect(html).toContain('could not be read; all the SOL in this account may be sent')
        // ALT'ye ozgu "cozulemedi (adres arama tablosu)" metni bu durumda yaniltici olurdu.
        expect(html).not.toContain('address lookup table')
        expect(html).toContain(SOL_ADRES(saldirgan))
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.bilinmeyenVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(s.statikOzet).toEqual([])
        expect(html).not.toMatch(HAM_ANAHTAR)
    })

    it('hesap zincirde bulunamadi (null) -> ayni "tum SOL gidebilir" yolu', async () => {
        const saldirgan = Keypair.generate().publicKey
        solanaRpc.mockImplementation(rpcYaniti(() => ({ value: [null] })))
        const { html, s } = await ac([txOdeyenli([kapat(saldirgan)])])
        expect(html).toContain('all the SOL in this account may be sent')
        expect(s.onayKilitli).toBe(true)
    })

    it('native olmayan bos hesap: yalniz kira tutari (kira etiketiyle), kirmizi + kutu kalir', async () => {
        const saldirgan = Keypair.generate().publicKey
        solanaRpc.mockImplementation(rpcYaniti(() => ({ value: [wsolYaniti(2_039_280, { native: false })] })))
        const { html, s } = await ac([txOdeyenli([kapat(saldirgan)])])
        expect(html).toContain('0.00203928 SOL')
        expect(html).toContain('SOL in the account now (rent')
        expect(html).not.toContain('All SOL in the account now')
        expect(html).toContain(SOL_ADRES(saldirgan))
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(s.statikOzet.map((o) => o.tutar)).toEqual(['0.00203928'])
    })

    it('hedef = kullanici (Jupiter wSOL kapatmasi): tutar satiri YOK, kirmizi YOK, kutu CIKMAZ', async () => {
        solanaRpc.mockImplementation(rpcYaniti(() => ({ value: [wsolYaniti(50_002_039_280)] })))
        const { html, s } = await ac([txOdeyenli([kapat(CUZDAN.publicKey)])])
        expect(s.kirmiziBayrakVar).toBe(false)
        expect(s.onayKilitli).toBe(false)
        expect(html).not.toContain('50.00203928')
        expect(html).not.toContain('cannot fully check this transaction')
        expect(s.statikOzet).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// Gorev 10: simulasyon bakiye ozeti, ucret karti, oncelik ucreti ust siniri (E2, K1).
// Constraint 16: simulasyon sonucu imza KARARINI baglamaz; tek etkisi kor-imza kutusu
// kosulunu KALDIRABILMEKTIR (hasUnknown + sonuc var), asla eklemek.
// ---------------------------------------------------------------------------
describe('SolanaSignTx.vue (SSR) -- Gorev 10 simulasyon bakiye ozeti', () => {
    it('(i) System Transfer + basarili simulasyon: kirmizi "-0.5 SOL" kahraman ozeti; statik ozet de gorunur kalir', async () => {
        const b64 = txOdeyenli([sol(Keypair.generate().publicKey, 500_000_000)])
        simKur((tx) => simYaniti(tx, { sol: -500_000_000n }))
        const { html, s } = await ac([b64])

        expect(html).toContain('Estimated balance change')
        expect(html).toMatch(/class="[^"]*text-red-600[^"]*">-0\.5 SOL</)
        // S10-T10-SEC-1b: statik ozet simulasyon basarili olsa da bos degilse GORUNUR KALIR.
        expect(html).toContain('Changes read from the instructions')
        expect(html).not.toContain(HESAPLANAMADI)
        expect(s.simulasyonSonucuVar).toBe(true)
        expect(s.onayKilitli).toBe(false)
        expect(html).not.toMatch(HAM_ANAHTAR)
    })

    it('(ii) USDC TransferChecked: "-100 USDC" kirmizi, kurasyonlu "+12.3 JUP" yesil', async () => {
        const hedef = getAssociatedTokenAddressSync(USDC, Keypair.generate().publicKey)
        const b64 = txOdeyenli([createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, hedef, CUZDAN.publicKey, 100_000_000n, 6)])
        simKur((tx) => simYaniti(tx, {
            pre: [tokenKaydi(USDC_MINT, 150_000_000, 6), tokenKaydi(JUP, 0, 6)],
            post: [tokenKaydi(USDC_MINT, 50_000_000, 6), tokenKaydi(JUP, 12_300_000, 6)],
        }))
        const { html, s } = await ac([b64])

        expect(html).toMatch(/class="[^"]*text-red-600[^"]*">-100 USDC</)
        expect(html).toMatch(/class="[^"]*text-emerald-600[^"]*">\+12\.3 JUP</)
        expect(s.onayKilitli).toBe(false)
    })

    it('kurasyonlu OLMAYAN mint: kisaltilmis mint + "unverified token", ham simulasyon sembolu ekrana SIZMAZ', async () => {
        const b64 = txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => simYaniti(tx, {
            post: [{ ...tokenKaydi(SAHTE_MINT, 5_000_000, 6), symbol: 'USDC' }],
        }))
        const { html } = await ac([b64])
        expect(html).toContain(`+5 ${kisaAdres(SAHTE_MINT)}`)
        expect(html).toContain('unverified token')
        expect(html).not.toContain('+5 USDC')
    })

    it('kurasyonlu mint ama simulasyonun decimals i farkli: sembol VERILMEZ (dogrulanmamis)', async () => {
        const b64 = txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(USDC_MINT, 10, 9)], post: [] }))
        const { html } = await ac([b64])
        expect(html).not.toContain(' USDC<')
        expect(html).toContain(`-0.00000001 ${kisaAdres(USDC_MINT)}`)
        expect(html).toContain('unverified token')
    })

    it('(iv) takas benzeri: "-1 SOL" + dogrulanmamis token, bilinmeyen TEK grup, kilit YOK, uyari VAR', async () => {
        const b64 = txOdeyenli([yabanciIx([1]), yabanciIx([2]), sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => simYaniti(tx, { sol: -1_000_000_000n, post: [tokenKaydi(SAHTE_MINT, 150_000_000, 6)] }))
        const { html, s } = await ac([b64])

        expect(html).toMatch(/>-1 SOL</)
        expect(html).toContain(`+150 ${kisaAdres(SAHTE_MINT)}`)
        expect((html.match(/2 more instructions the wallet cannot read/g) || []).length).toBe(1)
        expect(s.bilinmeyenVar).toBe(true)
        expect(s.onayKilitli).toBe(false)
        expect(html).toContain('This program is not recognized')
    })

    it('(v) simulasyon 403/zaman asimi + tam cozulen transfer: amber, onay SERBEST, statik tutar gorunur', async () => {
        for (const hata of ['SOLANA_RPC_TIMEOUT', 'SOLANA_RPC_ERROR_403']) {
            simKur(() => new Error(hata))
            const { html, s } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1_500_000_000)])])
            expect(html).toContain(HESAPLANAMADI)
            expect(html).toContain('Changes read from the instructions')
            expect(html).toContain('-1.5 SOL')
            expect(s.onayKilitli).toBe(false)
            expect(dugmeKilitli(html)).toBe(false)
            expect(html).not.toContain(KUTU_METNI)
            expect(html).not.toContain('found no change')
        }
    })

    it('(vi) simulasyon yok + bilinmeyen program: kutu zorunlu, kutu yokken onayla() IPTAL (403 ve zaman asimi)', async () => {
        for (const hata of ['SOLANA_RPC_TIMEOUT', 'SOLANA_RPC_ERROR_403']) {
            simKur(() => new Error(hata))
            const { html, s, gonderilen } = await ac([txOdeyenli([yabanciIx()])])
            expect(s.simulasyonSonucuVar).toBe(false)
            expect(s.onayKilitli).toBe(true)
            expect(html).toContain(KUTU_METNI)
            expect(dugmeKilitli(html)).toBe(true)
            await s.onayla()
            expect(imzaGonderildi(gonderilen)).toBe(false)
            s.korImzaOnayi = true
            expect(s.onayKilitli).toBe(false)
            await s.onayla()
            expect(imzaGonderildi(gonderilen)).toBe(true)
        }
    })

    it('(vii) err:{InstructionError} = "sonuc yok": ayni kutu kurali, simFailedWarning, token bakiyeleri GOSTERILMEZ', async () => {
        const err = { InstructionError: [0, { Custom: 17 }] }
        simKur((tx) => simYaniti(tx, { err, post: [tokenKaydi(SAHTE_MINT, 7_000_000, 6)] }))
        const bilinmeyen = await ac([txOdeyenli([yabanciIx()])])
        expect(bilinmeyen.html).toContain('The simulation reported an error')
        expect(bilinmeyen.html).not.toContain(kisaAdres(SAHTE_MINT))
        expect(bilinmeyen.s.simulasyonSonucuVar).toBe(false)
        expect(bilinmeyen.s.onayKilitli).toBe(true)
        expect(bilinmeyen.html).toContain(KUTU_METNI)

        // Tam cozulen transferde err kutu EKLEMEZ (yalniz uyari), statik tutar gorunur.
        const duz = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 2_000_000_000)])])
        expect(duz.html).toContain('The simulation reported an error')
        expect(duz.html).toContain('-2 SOL')
        expect(duz.s.onayKilitli).toBe(false)
        expect(duz.html).not.toContain(KUTU_METNI)
    })

    it('(ix) signAll 3 islem: uc kart + ustte toplam + simSeparateNote; biri zaman asimi -> YALNIZ o kart "hesaplanamadi"', async () => {
        const t = [
            txOdeyenli([sol(Keypair.generate().publicKey, 100_000_000)]),
            txOdeyenli([sol(Keypair.generate().publicKey, 200_000_000)]),
            txOdeyenli([sol(Keypair.generate().publicKey, 300_000_000)]),
        ]
        const farklar = [-100_000_000n, -200_000_000n, -300_000_000n]
        simKur((tx) => simYaniti(tx, { sol: farklar[t.indexOf(tx)] }))
        const tam = await ac(t, { mode: 'signAll' })
        expect(tam.s.kartlar).toHaveLength(3)
        expect(tam.html).toContain('>-0.1 SOL<')
        expect(tam.html).toContain('>-0.2 SOL<')
        expect(tam.html).toContain('>-0.3 SOL<')
        // Ustte toplam: -0.6 SOL, tek kahraman karti + simSeparateNote.
        expect(tam.html).toContain('>-0.6 SOL<')
        expect((tam.html.match(/Estimated balance change/g) || []).length).toBe(1)
        expect(tam.html).toContain('The simulation is a separate estimate')
        expect(simCagrilari()).toHaveLength(3)

        simKur((tx) => (tx === t[1] ? new Error('SOLANA_RPC_TIMEOUT') : simYaniti(tx, { sol: farklar[t.indexOf(tx)] })))
        const kismi = await ac(t, { mode: 'signAll' })
        expect((kismi.html.match(/The simulation is not available/g) || []).length).toBe(1)
        expect(kismi.html).toContain('>-0.1 SOL<')
        expect(kismi.html).toContain('>-0.3 SOL<')
        // Eksik bir toplam "tam" gibi gosterilmez: kahraman karti (simulasyon toplami) YOK.
        // (Statik "talimatlardan okunan" ozet ayri ve simulasyonsuz bir kaynaktir.)
        expect(kismi.html).not.toContain('Estimated balance change')
        expect(kismi.html).not.toContain('>-0.4 SOL<')
        expect(kismi.html).toContain('Changes read from the instructions')
        expect(kismi.s.simulasyonSonucuVar).toBe(false)
    })

    it('signAll: hasUnknown kilidi KART bazinda; baska kartin simulasyon sonucu bilinmeyen kartin kutusunu KALDIRMAZ, zararsiz kartin eksik sonucu kutu EKLEMEZ', async () => {
        const bil = txOdeyenli([yabanciIx()])
        const duz = txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => (tx === bil ? new Error('SOLANA_RPC_TIMEOUT') : simYaniti(tx)))
        const a = await ac([bil, duz], { mode: 'signAll' })
        expect(a.s.simulasyonSonucuVar).toBe(false)
        expect(a.s.onayKilitli).toBe(true)

        simKur((tx) => (tx === duz ? new Error('SOLANA_RPC_TIMEOUT') : simYaniti(tx)))
        const b = await ac([bil, duz], { mode: 'signAll' })
        expect(b.s.simulasyonSonucuVar).toBe(false)
        expect(b.s.onayKilitli).toBe(false)
    })

    it('(x) SOL fiyati varsa ucret satirinda yaklasik dolar karsiligi, yoksa satir HIC yok; simulasyon ucreti "en az" DEGIL kesin gosterilir', async () => {
        const b64 = txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => simYaniti(tx, { fee: 5_000_000 }))
        FIYAT.sol = 150
        const fiyatli = await ac([b64])
        expect(fiyatli.html).toContain('Total network fee')
        expect(fiyatli.html).toContain('0.005000000 SOL')
        expect(fiyatli.html).not.toMatch(/at least 0\.005000000/)
        expect(fiyatli.html).toMatch(/≈ \$0\.75/)

        FIYAT.sol = null
        const fiyatsiz = await ac([b64])
        // Vue sablon yorumlarini HTML yorumu olarak basar: yalniz GORUNEN metne bakilir.
        const gorunen = fiyatsiz.html.replace(/<!--[\s\S]*?-->/g, '')
        expect(gorunen).not.toContain('≈')
        expect(gorunen).not.toContain('$0.00')
    })

    it('ucret: simulasyon fee yoksa getFeeForMessage, o da yoksa "en az" taban ucret; balanceEstimateNote HER ZAMAN gorunur', async () => {
        const b64 = txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => simYaniti(tx, { fee: null }), { feeYaniti: { value: 7000 } })
        const yedek = await ac([b64])
        expect(yedek.html).toContain('0.000007000 SOL')
        expect(yedek.html).not.toMatch(/at least 0\.000007000/)
        expect(yedek.html).toContain('This is an estimate. The real result can differ.')

        simKur((tx) => simYaniti(tx, { fee: null }), { feeYaniti: { value: null } })
        const enAz = await ac([b64])
        expect(enAz.html).toMatch(/at least 0\.000005000 SOL/)
        expect(enAz.html).toContain('This is an estimate. The real result can differ.')

        simKur(() => new Error('SOLANA_RPC_TIMEOUT'))
        const yok = await ac([b64])
        expect(yok.html).toContain('This is an estimate. The real result can differ.')
    })

    it('(xi) sinirsiz Approve + simulasyon BASARILI: kutu YINE zorunlu (kirmizi bayrak simulasyondan bagimsiz)', async () => {
        const b64 = txOdeyenli([createApproveInstruction(Keypair.generate().publicKey, Keypair.generate().publicKey, CUZDAN.publicKey, 2n ** 64n - 1n)])
        simKur((tx) => simYaniti(tx))
        const { html, s, gonderilen } = await ac([b64])
        expect(s.simulasyonSonucuVar).toBe(true)
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain(KUTU_METNI)
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(false)
    })

    it('(xii) bilinmeyen program + simulasyon basarili + fark 0: balanceNoChange YOK, izin notu + unknownProgramWarning VAR', async () => {
        simKur((tx) => simYaniti(tx))
        const { html, s } = await ac([txOdeyenli([yabanciIx()])])
        expect(s.onayKilitli).toBe(false)
        expect(html).not.toContain('found no change to your balances')
        expect(html).toContain('does not show permission or ownership changes')
        expect(html).toContain('This program is not recognized')
    })

    it('fark 0 + hasUnknown=false VE hasRedFlag=false (kullaniciyi etkileyen satir YOK): balanceNoChange gorunur, izin notu GORUNMEZ', async () => {
        simKur((tx) => simYaniti(tx))
        // Memo-only islem, ucreti baskasi oduyor: kullaniciyi etkileyen satir ve statik tutar yok.
        const { html } = await ac([txOdeyenli([memoIx('merhaba')], Keypair.generate().publicKey)])
        expect(html).toContain('found no change to your balances')
        expect(html).not.toContain('does not show permission or ownership changes')
    })

    it('kirmizi bayrak + fark 0: balanceNoChange HIC yazilmaz, izin notu yazilir', async () => {
        simKur((tx) => simYaniti(tx))
        const { html } = await ac([txOdeyenli([SystemProgram.assign({ accountPubkey: CUZDAN.publicKey, programId: YABANCI_PROGRAM })])])
        expect(html).not.toContain('found no change to your balances')
        expect(html).toContain('does not show permission or ownership changes')
    })

    it('(xiv) AdvanceNonceAccount + simulasyon err: "sonuc yok" sayilir ve durableNonceWarning gorunur', async () => {
        simKur((tx) => simYaniti(tx, { err: { InstructionError: [0, 'InvalidAccountData'] } }))
        const nonceTx = txOdeyenli([
            SystemProgram.nonceAdvance({ noncePubkey: Keypair.generate().publicKey, authorizedPubkey: CUZDAN.publicKey }),
            sol(CUZDAN.publicKey, 1),
        ])
        const { html, s } = await ac([nonceTx])
        expect(s.simulasyonSonucuVar).toBe(false)
        expect(html).toContain('This transaction may stay valid indefinitely')
        expect(html).toContain('The simulation reported an error')
    })

    it('(xv) simulasyon basarili + bilinmeyen program + "-1 SOL": ozet gorunur, kilit YOK ama unknownProgramWarning VAR (kabul edilen risk)', async () => {
        simKur((tx) => simYaniti(tx, { sol: -1_000_000_000n }))
        const { html, s } = await ac([txOdeyenli([yabanciIx(), sol(Keypair.generate().publicKey, 1)])])
        expect(html).toMatch(/>-1 SOL</)
        expect(s.onayKilitli).toBe(false)
        expect(html).toContain('This program is not recognized')
        // "dogrulandi/guvenli" iddiasi YOK (Constraint 24).
        expect(html).not.toMatch(/\b(verified safe|is safe|guvenli)\b/i)
    })

    it('Gorev 7 devri (a)/(b): simulasyon, gosterilen ve imzalanacak AYNI baytlardan; accountKeys base58 DIZE dizisi (kullanici 2. indekste)', async () => {
        // Ucreti baska hesap oder; kullanici alicidir ve hesap listesinde 1. INDEKSTE durur.
        const odeyen = Keypair.generate()
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = odeyen.publicKey
        tx.add(SystemProgram.transfer({ fromPubkey: odeyen.publicKey, toPubkey: CUZDAN.publicKey, lamports: 1_000_000_000 }))
        const b64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
        simKur((x) => simYaniti(x, { sol: 1_000_000_000n, fee: null }), { feeYaniti: { value: 9000 } })

        const { html, gonderilen, s } = await ac([b64])
        // PublicKey[] gecseydi computeBalanceDelta `unusable` derdi: ozet var = dize dizisi.
        expect(html).toMatch(/class="[^"]*text-emerald-600[^"]*">\+1 SOL</)

        const sim = simCagrilari()
        expect(sim).toHaveLength(1)
        expect(sim[0][1][0]).toBe(b64)
        const ucret = solanaRpc.mock.calls.find((c) => c[0] === 'getFeeForMessage')
        expect(ucret[1][0]).toBe(Transaction.from(Buffer.from(b64, 'base64')).serializeMessage().toString('base64'))

        s.korImzaOnayi = true
        await s.onayla()
        const imza = gonderilen.find((m) => m.type === 'SOLANA_DAPP_SIGN_TX')
        expect(imza.message.transactions[0]).toBe(b64)
    })

    // v0 + adres arama tablosu: simulasyon yaniti [static, yazilabilir yuklenen, salt-okunur yuklenen]
    // sirasinda gelir; alici tabloda oldugu icin kullanici disinda kalir ama anahtar listesi uzunlugu
    // preBalances ile eslesmeli (aksi halde ozet `unusable` olurdu).
    function v0AltCozulmus() {
        const hedef = Keypair.generate().publicKey
        const tabloKey = Keypair.generate().publicKey
        const veri = Buffer.alloc(56 + 32)
        veri.writeUInt32LE(1, 0)
        veri.writeBigUInt64LE(2n ** 64n - 1n, 4)
        Buffer.from(hedef.toBytes()).copy(veri, 56)
        const tablo = new AddressLookupTableAccount({
            key: tabloKey,
            state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: [hedef] },
        })
        const message = new TransactionMessage({
            payerKey: CUZDAN.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: CUZDAN.publicKey, toPubkey: hedef, lamports: 1_000_000 })],
        }).compileToV0Message([tablo])
        const b64 = Buffer.from(new VersionedTransaction(message).serialize()).toString('base64')
        return { b64, hedef: hedef.toBase58(), altVeri: veri.toString('base64'), statik: message.staticAccountKeys.map((k) => k.toBase58()) }
    }

    it('v0 + ALT COZULDU: accountKeys tam liste (static + yuklenen) dize dizisi, ozet dogru indekste okunur', async () => {
        const { b64, hedef, altVeri, statik } = v0AltCozulmus()
        const tam = [...statik, hedef]
        solanaRpc.mockImplementation(async (method, params) => {
            if (method === 'getMultipleAccounts') return { value: [{ data: [altVeri, 'base64'] }] }
            if (method === 'simulateTransaction') return simYaniti(params[0], { sol: -1_000_000n, anahtarlar: tam })
            if (method === 'getBalance') return { value: 5_000_000_000 }
            return { value: [] }
        })
        const { html, s } = await ac([b64])
        expect(s.altCozulemedi).toBe(false)
        expect(html).toMatch(/>-0\.001 SOL</)
        expect(s.simulasyonSonucuVar).toBe(true)
        expect(s.kartlar[0].simGirdisi.accountKeys).toEqual(tam)
        expect(s.kartlar[0].simGirdisi.base64Tx).toBe(b64)
    })

    it('v0 + ALT COZULEMEDI: static anahtarlar gider, saglayicinin loadedAddresses i yalniz ozet eslemesini tamamlar; hasUnknown (uyari) KALIR', async () => {
        const { b64, hedef, statik } = v0AltCozulmus()
        solanaRpc.mockImplementation(async (method, params) => {
            if (method === 'getMultipleAccounts') throw new Error('SOLANA_RPC_TIMEOUT')
            if (method === 'simulateTransaction') {
                const y = simYaniti(params[0], { sol: -1_000_000n, anahtarlar: [...statik, hedef] })
                y.value.loadedAddresses = { writable: [hedef], readonly: [] }
                return y
            }
            if (method === 'getBalance') return { value: 5_000_000_000 }
            return { value: [] }
        })
        const { html, s } = await ac([b64])
        expect(s.altCozulemedi).toBe(true)
        expect(s.kartlar[0].simGirdisi.accountKeys).toEqual(statik)
        expect(html).toMatch(/>-0\.001 SOL</)
        // Preview'in hasUnknown'u saglayici verisiyle SILINMEZ; kutu yalniz "sonuc var" kuraliyla (b) kalkar.
        expect(s.bilinmeyenVar).toBe(true)
        // Gercek bilinmeyen program YOK: "program taninmiyor" DENMEZ, genel metin gorunur (final SU-8).
        expect(html).not.toContain('This program is not recognized')
        expect(html).toContain('Some parts of this transaction could not be checked')
        expect(html).toContain('lookup table the wallet could not read')
        expect(s.onayKilitli).toBe(false)
    })

    it('Gorev 7 devri (c): gecersiz user ile simulasyon CAGRILMAZ, sonuc "yok" sayilir, ASLA "degisim yok" denmez', async () => {
        simKur((tx) => simYaniti(tx))
        for (const from of ['bu-bir-solana-adresi-degil', ` ${FROM}`, `${FROM}x`]) {
            solanaRpc.mockClear()
            const { html, s } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])], { from })
            expect(simCagrilari(), from).toHaveLength(0)
            expect(s.simulasyonSonucuVar, from).toBe(false)
            expect(html, from).toContain(HESAPLANAMADI)
            expect(html, from).not.toContain('found no change to your balances')
        }
    })

    it('Gorev 9 devri 3: kapatilan (post te olmayan) token hesabi post=0 sayilir: saldirgana kapatilan 50 wSOL hesabi ozette "-50 wSOL" gorunur', async () => {
        const saldirgan = Keypair.generate().publicKey
        const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, CUZDAN.publicKey)
        const b64 = txOdeyenli([createCloseAccountInstruction(wsol, saldirgan, CUZDAN.publicKey)])
        // Simulasyon: hesap pre de 50 wSOL, post ta YOK (kapandi).
        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(NATIVE_MINT.toBase58(), 50_000_000_000, 9)], post: [] }))
        const { html, s } = await ac([b64])
        // S10-T10-SEC-1d: wSOL 'wSOL' etiketi ve 9 decimals ile gorunur, 'dogrulanmamis token' DENMEZ.
        expect(html).toContain('-50 wSOL')
        expect(html).not.toContain(kisaAdres(NATIVE_MINT.toBase58()))
        expect(html).not.toContain('unverified token')
        // Kirmizi bayrak (baskasina CloseAccount): simulasyon sonucu kutuyu KALDIRMAZ.
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).not.toContain('found no change to your balances')
    })
})

describe('SolanaSignTx.vue (SSR) -- Gorev 10 SIM_WAIT_MS zamanlayicisi (simulateTx ic zaman asimlarindan BAGIMSIZ)', () => {
    afterEach(() => { vi.useRealTimers() })

    // rpc taklidi simulateTransaction'a HIC yanit vermez (signal/timeoutMs yok sayilir): ekranin KENDI
    // zamanlayicisi calismazsa render sonsuza dek asili kalirdi.
    async function askidaKos(b64, { sonra = null } = {}) {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let coz
        let basladi
        const baslangic = new Promise((r) => { basladi = r })
        solanaRpc.mockImplementation(async (method, params) => {
            if (method === 'simulateTransaction') {
                basladi()
                return new Promise((resolve) => { coz = () => resolve(sonra ? sonra(params[0]) : simYaniti(params[0], { sol: -1_000_000_000n })) })
            }
            if (method === 'getBalance') return { value: 5_000_000_000 }
            if (method === 'getMinimumBalanceForRentExemption') return 2039280
            return { value: [] }
        })
        const { app, gonderilen } = setup({ ...ISTEK, transactions: [b64] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const bekleyen = render(app)
        await baslangic
        await vi.advanceTimersByTimeAsync(6000)
        const html = await bekleyen
        return { html, s: holder.instance.setupState, coz, gonderilen }
    }

    it('6 sn icinde sonuc gelmezse "hesaplanamadi"; gec gelen sonuc paneli gunceller ve hasUnknown kutusunu KALDIRIR', async () => {
        const { html, s, coz } = await askidaKos(txOdeyenli([yabanciIx()]))
        expect(html).toContain(HESAPLANAMADI)
        expect(html).toContain(KUTU_METNI)
        expect(s.simulasyonSonucuVar).toBe(false)
        expect(s.onayKilitli).toBe(true)

        coz()
        await vi.advanceTimersByTimeAsync(0)
        expect(s.simulasyonSonucuVar).toBe(true)
        expect(s.onayKilitli).toBe(false)
    })

    it('gec gelen BASARISIZ sonuc kutuyu EKLEMEZ (zararsiz transfer serbest kalir)', async () => {
        const { html, s, coz } = await askidaKos(txOdeyenli([sol(Keypair.generate().publicKey, 1000)]), {
            sonra: (tx) => simYaniti(tx, { err: { InstructionError: [0, 'Custom'] } }),
        })
        expect(html).toContain(HESAPLANAMADI)
        expect(s.onayKilitli).toBe(false)
        coz()
        await vi.advanceTimersByTimeAsync(0)
        expect(s.simulasyonSonucuVar).toBe(false)
        expect(s.onayKilitli).toBe(false)
    })

    it('sonuc bekleniyorken (6 sn dolmadan) cozumleme bitmis ve zararsiz transferde onay SERBEST; 6. sn de "hesaplanamadi"', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let basladi
        const baslangic = new Promise((r) => { basladi = r })
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'simulateTransaction') { basladi(); return new Promise(() => {}) }
            if (method === 'getBalance') return { value: 5_000_000_000 }
            return { value: [] }
        })
        const { app } = setup({ ...ISTEK, transactions: [txOdeyenli([sol(Keypair.generate().publicKey, 1000)])] })
        const holder = captureInstance(app, 'SolanaSignTx')
        const bekleyen = render(app)
        await baslangic
        await vi.advanceTimersByTimeAsync(5999)
        // SSR cikti zamanlayici dolana dek uretilmez; durumu dogrudan oku.
        expect(holder.instance.setupState.cozumlemeBitti).toBe(true)
        expect(holder.instance.setupState.onayKilitli).toBe(false)
        expect(holder.instance.setupState.kahraman.durum).toBe('bekliyor')
        await vi.advanceTimersByTimeAsync(1)
        const html = await bekleyen
        expect(holder.instance.setupState.kahraman.durum).toBe('yok')
        expect(html).toContain(HESAPLANAMADI)
    })
})

describe('SolanaSignTx.vue (SSR) -- Gorev 10 oncelik ucreti ust siniri (S9-G9-S1 devri)', () => {
    const fiyatLimit = (fiyat, limit) => [
        ...(limit === null ? [] : [ComputeBudgetProgram.setComputeUnitLimit({ units: limit })]),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fiyat }),
    ]
    const tx1 = (fiyat, limit, odeyen = CUZDAN.publicKey) => txOdeyenli([...fiyatLimit(fiyat, limit), sol(Keypair.generate().publicKey, 1)], odeyen)
    const simYokKur = () => simKur(() => new Error('SOLANA_RPC_TIMEOUT'))

    it('limit 1.4M + fiyat 1e12 uL: "at most 1400 SOL" + uyari + kutu zorunlu', async () => {
        simYokKur()
        const { html, s, gonderilen } = await ac([tx1(1_000_000_000_000, 1_400_000)])
        expect(html).toContain('at most 1400 SOL')
        expect(html).toContain('The priority fee is unusually high')
        expect(s.onayKilitli).toBe(true)
        // Yalniz oncelik ucreti nedeniyle kutu: ucret onay cumlesi, kor-imza cumlesi DEGIL (final E-e).
        expect(html).toContain(ONCELIK_ONAY_METNI)
        expect(html).not.toContain(KUTU_METNI)
        expect(dugmeKilitli(html)).toBe(true)
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(false)
        s.korImzaOnayi = true
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(true)
    })

    it('limit 1.4M + fiyat 3e9: en fazla 4.2 SOL + uyari + kutu', async () => {
        simYokKur()
        const { html, s } = await ac([tx1(3_000_000_000, 1_400_000)])
        expect(html).toContain('at most 4.2 SOL')
        expect(html).toContain('The priority fee is unusually high')
        expect(s.onayKilitli).toBe(true)
    })

    it('limit talimati YOK + fiyat 3e9: runtime tavani 1.4M CU ile en fazla 4.2 SOL + uyari + kutu (limit atlama saldirisi)', async () => {
        simYokKur()
        const { html, s } = await ac([tx1(3_000_000_000, null)])
        expect(html).toContain('at most 4.2 SOL')
        expect(html).toContain('The priority fee is unusually high')
        expect(s.onayKilitli).toBe(true)
    })

    it('SetComputeUnitLimit(4294967295) runtime tavani 1.4M ile SINIRLANIR', async () => {
        simYokKur()
        const { html, s } = await ac([tx1(3_000_000_000, 4_294_967_295)])
        expect(html).toContain('at most 4.2 SOL')
        expect(s.onayKilitli).toBe(true)
    })

    it('limit 200_000 + fiyat 50_000: en fazla 0.00001 SOL, uyari YOK, kutu YOK', async () => {
        simYokKur()
        const { html, s } = await ac([tx1(50_000, 200_000)])
        expect(html).toContain('at most 0.00001 SOL')
        expect(html).not.toContain('The priority fee is unusually high')
        expect(html).not.toContain(KUTU_METNI)
        expect(s.onayKilitli).toBe(false)
    })

    it('4.2 SOL vektoru ama ucreti BASKA adres oder: kutu YOK ve uyari YOK (ucret kullanicidan dusmez), "at most" satiri YINE gorunur', async () => {
        simYokKur()
        const { html, s } = await ac([tx1(3_000_000_000, 1_400_000, Keypair.generate().publicKey)])
        expect(html).toContain('at most 4.2 SOL')
        expect(html).not.toContain('The priority fee is unusually high')
        expect(html).not.toContain(KUTU_METNI)
        expect(s.onayKilitli).toBe(false)
    })

    it('ucreti odeyen BILINMIYORKEN (feePayer null) esikler UYGULANIR (kutu zorunlu)', async () => {
        simYokKur()
        const { s } = await ac([tx1(3_000_000_000, 1_400_000, Keypair.generate().publicKey)])
        expect(s.onayKilitli).toBe(false)
        // Gercek ayristirma her zaman bir ucret odeyen verir; bilinmeyen durumu dogrudan kuruyoruz.
        s.kartlar[0].preview.feePayer = null
        s.kartlar[0].preview.feePayerIsUser = false
        expect(s.oncelikKutu).toBe(true)
        expect(s.onayKilitli).toBe(true)
    })

    it('esikler ayri ayri: 0.05 SOL yalniz amber uyari (kutu YOK); 0.2 SOL kutu zorunlu', async () => {
        simYokKur()
        // 250e6 uL x 200_000 CU / 1e6 = 5e7 lamport = 0.05 SOL
        const uyari = await ac([tx1(250_000_000, 200_000)])
        expect(uyari.html).toContain('at most 0.05 SOL')
        expect(uyari.html).toContain('The priority fee is unusually high')
        expect(uyari.html).not.toContain(KUTU_METNI)
        expect(uyari.s.onayKilitli).toBe(false)
        // 1e9 uL x 200_000 CU / 1e6 = 2e8 lamport = 0.2 SOL
        const kutu = await ac([tx1(1_000_000_000, 200_000)])
        expect(kutu.html).toContain('at most 0.2 SOL')
        expect(kutu.s.onayKilitli).toBe(true)
    })

    it('plan (xiii): fiyat 5e9 + limit 1.4M + simulasyon reject -> "at most 7 SOL" + uyari + kutu; fiyat 5e6 ise 0.007 SOL ve esik altinda', async () => {
        simYokKur()
        const buyuk = await ac([tx1(5_000_000_000, 1_400_000)])
        expect(buyuk.html).toContain('at most 7 SOL')
        expect(buyuk.html).toContain('The priority fee is unusually high')
        expect(buyuk.s.onayKilitli).toBe(true)
        const kucuk = await ac([tx1(5_000_000, 1_400_000)])
        expect(kucuk.html).toContain('at most 0.007 SOL')
        expect(kucuk.html).not.toContain('The priority fee is unusually high')
        expect(kucuk.s.onayKilitli).toBe(false)
    })

    it('simulasyon BASARILI olsa da oncelik ucreti kutusu KALKMAZ (kosul statik talimatlardan, simulasyondan bagimsiz)', async () => {
        simKur((tx) => simYaniti(tx))
        const { s } = await ac([tx1(3_000_000_000, 1_400_000)])
        expect(s.simulasyonSonucuVar).toBe(true)
        expect(s.onayKilitli).toBe(true)
    })

    it('signAll: iki islemin ust sinirlari TOPLANIR (her biri esik altinda, toplam kutu esigini asar)', async () => {
        simYokKur()
        // Her biri 0.06 SOL (300e6 uL x 200_000 CU / 1e6 = 6e7 lamport); toplam 0.12 SOL > 0.1.
        const { s } = await ac([tx1(300_000_000, 200_000), tx1(300_000_000, 200_000)], { mode: 'signAll' })
        expect(s.onayKilitli).toBe(true)
    })

    it('feeDetails: ComputeBudget ayrintilari TEK acilirda; ana kartta ham uL satiri YOK', async () => {
        simYokKur()
        const { html } = await ac([tx1(50_000, 200_000)])
        expect(html).toContain('Fee details')
        expect((html.match(/<details/g) || []).length).toBe(1)
        expect(html).toContain('Compute unit limit')
        expect(html).toContain('Compute unit price')
    })
})

// ---------------------------------------------------------------------------
// Gorev 10 DUZELTME TURU 1 (S10-T10-SEC-1, S10-T10-SEC-2, V10-2)
// ---------------------------------------------------------------------------
const gorunenMetin = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const DEGISIM_YOK = 'found no change to your balances'
const KAPSAM_NOTU = 'Covers only the SOL and token balances of your wallet address itself'
const IZIN_NOTU = 'does not show permission or ownership changes'
const STATIK_KUTU = 'solana-sign-tx-static-summary'
const SALDIRGAN = Keypair.generate().publicKey
// signAll ust (kahraman) karti: kartlarin kendi ozetleri bu dilimin DISINDADIR.
const ustKart = (html) => html.slice(html.indexOf('id="solana-sim-summary"'), html.indexOf('class="flex flex-col gap-2.5"'))

describe('SolanaSignTx.vue (SSR) -- S10-T10-SEC-1: kapsam daraltma ve "degisim yok" yasagi', () => {
    it('A1 TransferWithSeed (tohumdan turetilmis hesaptan 5 SOL, ucreti saldirgan oduyor, sim kullanici farki 0): "degisim yok" YOK, statik ozet gorunur, daraltilmis not var', async () => {
        const seed = 'vault1'
        const turetilmis = await PublicKey.createWithSeed(CUZDAN.publicKey, seed, SystemProgram.programId)
        const b64 = txOdeyenli([SystemProgram.transfer({
            fromPubkey: turetilmis, basePubkey: CUZDAN.publicKey, toPubkey: SALDIRGAN, lamports: 5_000_000_000, seed, programId: SystemProgram.programId,
        })], SALDIRGAN)
        simKur((tx) => simYaniti(tx, { sol: 0n }))
        const { html, s } = await ac([b64])

        expect(s.simulasyonSonucuVar).toBe(true)
        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain(IZIN_NOTU)
        expect(html).toContain(KAPSAM_NOTU)
        expect(html).toContain(STATIK_KUTU)
        expect(gorunenMetin(html)).toMatch(/-5 SOL/)
    })

    it('A2 WithdrawNonceAccount (nonce yetkilisi kullanici, 4 SOL saldirgana): "degisim yok" YOK, statik ozet "-4 SOL" gorunur', async () => {
        const nonce = Keypair.generate().publicKey
        const b64 = txOdeyenli([SystemProgram.nonceWithdraw({
            noncePubkey: nonce, authorizedPubkey: CUZDAN.publicKey, toPubkey: SALDIRGAN, lamports: 4_000_000_000,
        })], SALDIRGAN)
        simKur((tx) => simYaniti(tx, { sol: 0n }))
        const { html } = await ac([b64])

        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain(IZIN_NOTU)
        expect(html).toContain(STATIK_KUTU)
        expect(gorunenMetin(html)).toMatch(/-4 SOL/)
    })

    it('nonce hesabindan kullanicinin KENDI adresine cekim statik ozete "-X SOL" olarak YAZILMAZ', async () => {
        const b64 = txOdeyenli([SystemProgram.nonceWithdraw({
            noncePubkey: Keypair.generate().publicKey, authorizedPubkey: CUZDAN.publicKey, toPubkey: CUZDAN.publicKey, lamports: 4_000_000_000,
        })])
        simKur((tx) => simYaniti(tx, { sol: 4_000_000_000n - 5000n }))
        const { html } = await ac([b64])
        expect(html).not.toContain(STATIK_KUTU)
    })

    it('A5 bilinmeyen program (Stake Withdraw benzeri 4 SOL) + simulasyon basarili, fark yalniz ucret: kilit YOK (Constraint 24) ama "degisim yok" YOK, kapsam notu + unknownProgramWarning VAR', async () => {
        const ix = new TransactionInstruction({
            programId: YABANCI_PROGRAM,
            keys: [
                { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
                { pubkey: SALDIRGAN, isSigner: false, isWritable: true },
                { pubkey: CUZDAN.publicKey, isSigner: true, isWritable: false },
            ],
            data: Buffer.from([4, 0, 0, 0, 0x00, 0x28, 0x6b, 0xee, 0, 0, 0, 0]),
        })
        simKur((tx) => simYaniti(tx, { sol: -5000n }))
        const { html, s } = await ac([txOdeyenli([ix])])

        expect(s.simulasyonSonucuVar).toBe(true)
        expect(s.onayKilitli).toBe(false) // kilit tablosu DEGISMEZ (plan xv)
        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain(IZIN_NOTU)
        expect(html).toContain(KAPSAM_NOTU)
        expect(html).toContain('This program is not recognized')
    })

    it('kapsam notu sonuc durumundan bagimsiz sabit gorunur (ok, hesaplanamadi, program hatasi)', async () => {
        for (const sim of [(tx) => simYaniti(tx), () => new Error('SOLANA_RPC_TIMEOUT'), (tx) => simYaniti(tx, { err: { InstructionError: [0, 'x'] } })]) {
            simKur(sim)
            const { html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])])
            expect(html).toContain(KAPSAM_NOTU)
        }
    })

    it('zararsiz transfer + basarili simulasyon: kilit YOK, gercek fark ozette (kilit tablosu degismedi)', async () => {
        simKur((tx) => simYaniti(tx, { sol: -1_000_000n - 5000n }))
        const { html, s } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1_000_000)])])
        expect(s.onayKilitli).toBe(false)
        expect(html).not.toContain(DEGISIM_YOK)
        expect(gorunenMetin(html)).toContain('-0.001005 SOL')
    })

    it('wSOL (native mint, 9 decimals): "wSOL" etiketi, "dogrulanmamis token" DENMEZ; decimals 9 degilse etiket VERILMEZ', async () => {
        const wsol = NATIVE_MINT.toBase58()
        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(wsol, 2_000_000_000, 9)], post: [] }))
        let r = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])])
        expect(r.html).toContain('-2 wSOL')
        expect(r.html).not.toContain('unverified token')

        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(wsol, 2_000_000, 6)], post: [] }))
        r = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000)])])
        expect(r.html).not.toContain('wSOL')
        expect(r.html).toContain('unverified token')
    })

    it('wSOL kurasyonlu tabloya EKLENMEDI (Constraint 27 esitlik kilidi): etiket gosterim katmaninda', () => {
        const kaynak = readFileSync(new URL('../../data/solanaCuratedMints.js', import.meta.url), 'utf8')
        expect(kaynak).not.toContain('So11111111111111111111111111111111111111112')
    })
})

describe('SolanaSignTx.vue (SSR) -- S10-T10-SEC-2: signAll ust karti NETLEMEZ', () => {
    const solGelen = (miktar) => txOdeyenli([SystemProgram.transfer({ fromPubkey: SALDIRGAN, toPubkey: CUZDAN.publicKey, lamports: miktar })], SALDIRGAN)
    const solGiden = (miktar) => txOdeyenli([SystemProgram.transfer({ fromPubkey: CUZDAN.publicKey, toPubkey: SALDIRGAN, lamports: miktar })], SALDIRGAN)

    it('A3 islem1 +1 SOL, islem2 -1 SOL (ucreti saldirgan oduyor): ustte "giden 1 SOL" ve "gelen 1 SOL" AYRI, "degisim yok" YOK', async () => {
        const a = solGelen(1_000_000_000)
        const b = solGiden(1_000_000_000)
        simKur((tx) => simYaniti(tx, { sol: tx === a ? 1_000_000_000n : -1_000_000_000n, fee: 5000 }))
        const { html, s } = await ac([a, b], { mode: 'signAll' })

        const ust = html.slice(html.indexOf('id="solana-sim-summary"'), html.indexOf('class="flex flex-col gap-2.5"'))
        expect(ust).toContain('Total outgoing')
        expect(ust).toContain('Total incoming')
        expect(ust.indexOf('Total outgoing')).toBeLessThan(ust.indexOf('-1 SOL'))
        expect(ust.indexOf('-1 SOL')).toBeLessThan(ust.indexOf('Total incoming'))
        expect(ust.indexOf('Total incoming')).toBeLessThan(ust.indexOf('+1 SOL'))
        expect(ust).not.toContain(DEGISIM_YOK)
        expect(html).not.toContain(DEGISIM_YOK)
        expect(ust).toContain('separate estimate')
        expect(ust).toContain('independently of each other')
        expect(s.kahraman.degisimYok).toBe(false)
        expect(s.kahraman.satirlar.map((x) => [x.grup, x.metin])).toEqual([['giden', '-1 SOL'], ['gelen', '+1 SOL']])
        expect(s.onayKilitli).toBe(false) // kilit tablosu degismedi
    })

    it('A4 token: +100 USDC / -100 USDC ayri giden ve gelen satirlari (net sifir gosterilmez)', async () => {
        const hedef = getAssociatedTokenAddressSync(USDC, SALDIRGAN)
        const ata = getAssociatedTokenAddressSync(USDC, CUZDAN.publicKey)
        const a = txOdeyenli([createTransferCheckedInstruction(hedef, USDC, ata, SALDIRGAN, 100_000_000n, 6)], SALDIRGAN)
        const b = txOdeyenli([createTransferCheckedInstruction(ata, USDC, hedef, CUZDAN.publicKey, 100_000_000n, 6)], SALDIRGAN)
        simKur((tx) => (tx === a
            ? simYaniti(tx, { pre: [tokenKaydi(USDC_MINT, 0, 6)], post: [tokenKaydi(USDC_MINT, 100_000_000, 6)] })
            : simYaniti(tx, { pre: [tokenKaydi(USDC_MINT, 100_000_000, 6)], post: [tokenKaydi(USDC_MINT, 0, 6)] })))
        const { html, s } = await ac([a, b], { mode: 'signAll' })

        expect(s.kahraman.satirlar.map((x) => [x.grup, x.metin])).toEqual([['giden', '-100 USDC'], ['gelen', '+100 USDC']])
        expect(s.kahraman.degisimYok).toBe(false)
        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain('Total outgoing')
        expect(html).toContain('Total incoming')
    })

    it('ayni varlik birden cok islemde: giden toplami ve gelen toplami ayri toplanir', async () => {
        const a = solGiden(1_000_000_000)
        const b = solGiden(2_000_000_000)
        const c = solGelen(500_000_000)
        simKur((tx) => simYaniti(tx, { sol: tx === a ? -1_000_000_000n : tx === b ? -2_000_000_000n : 500_000_000n }))
        const { s } = await ac([a, b, c], { mode: 'signAll' })
        expect(s.kahraman.satirlar.map((x) => [x.grup, x.metin])).toEqual([['giden', '-3 SOL'], ['gelen', '+0.5 SOL']])
    })

    it('coklu modda "degisim yok" YALNIZ her kartin kendi farki bossa ve kosullar saglaniyorsa yazilir', async () => {
        const memoTx = () => txOdeyenli([memoIx('merhaba')], Keypair.generate().publicKey)
        simKur((tx) => simYaniti(tx))
        const bos = await ac([memoTx(), memoTx()], { mode: 'signAll' })
        expect(ustKart(bos.html)).toContain(DEGISIM_YOK)

        // Bir kart kullaniciyi etkileyen satir tasiyorsa (sim farki 0 olsa da) yazilmaz.
        const etkili = await ac([memoTx(), txOdeyenli([sol(Keypair.generate().publicKey, 1000)])], { mode: 'signAll' })
        expect(ustKart(etkili.html)).not.toContain(DEGISIM_YOK)
        expect(ustKart(etkili.html)).toContain(IZIN_NOTU)
    })
})

describe('SolanaSignTx.vue (SSR) -- V10-2: simulasyon token alanlari fail-closed', () => {
    const memoTx = () => txOdeyenli([memoIx('merhaba')], Keypair.generate().publicKey)
    const tokenDizisiz = (tx) => {
        const y = simYaniti(tx)
        delete y.value.preTokenBalances
        delete y.value.postTokenBalances
        return y
    }
    const TOKEN_NOTU = 'Token changes could not be read completely'

    it('pre/postTokenBalances yok: "degisim yok" YOK, token okunamadi notu VAR', async () => {
        simKur(tokenDizisiz)
        const { html } = await ac([memoTx()])
        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain(TOKEN_NOTU)
    })

    it('diziler null iken de ayni; SOL farki etkilenmez', async () => {
        simKur((tx) => {
            const y = simYaniti(tx, { sol: -500_000n })
            y.value.preTokenBalances = null
            y.value.postTokenBalances = null
            return y
        })
        const { html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 495_000)])])
        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain(TOKEN_NOTU)
        expect(gorunenMetin(html)).toContain('-0.0005 SOL')
    })

    it('owner alani olmayan token kaydi: sonuc kismi, "degisim yok" YOK, bilinen satirlar yine gorunur', async () => {
        simKur((tx) => {
            const sahipsiz = tokenKaydi(USDC_MINT, 100_000_000, 6)
            delete sahipsiz.owner
            return simYaniti(tx, { pre: [sahipsiz, tokenKaydi(JUP, 3_000_000, 6)], post: [] })
        })
        const { html } = await ac([memoTx()])
        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain(TOKEN_NOTU)
        expect(html).toContain('-3 JUP')
    })

    it('diziler tam (bos) ve owner li kayitlar: not YOK, "degisim yok" yazilir (eski davranis korunur)', async () => {
        simKur((tx) => simYaniti(tx))
        const { html } = await ac([memoTx()])
        expect(html).toContain(DEGISIM_YOK)
        expect(html).not.toContain(TOKEN_NOTU)
    })

    it('signAll: bir kartin token dizileri yoksa kartta ve ustte not, "degisim yok" yok', async () => {
        const a = memoTx()
        const b = memoTx()
        simKur((tx) => (tx === a ? tokenDizisiz(tx) : simYaniti(tx)))
        const { html } = await ac([a, b], { mode: 'signAll' })
        expect(ustKart(html)).not.toContain(DEGISIM_YOK)
        expect(ustKart(html)).toContain(TOKEN_NOTU)
        expect((html.match(new RegExp(TOKEN_NOTU, 'g')) || []).length).toBeGreaterThanOrEqual(2)
    })
})

// ---------------------------------------------------------------------------
// FINAL DUZELTME DALGASI (dapp-ozet alani)
// ---------------------------------------------------------------------------
const TOKEN_EKSIK_NOTU = 'Token changes could not be read completely'
const BILINMEYEN_PROGRAM_UYARISI = 'This program is not recognized'
const GENEL_OKUNAMADI_UYARISI = 'Some parts of this transaction could not be checked by the wallet'
// Metnin kalani kesme isareti tasir (SSR'da `&#39;` olur): yalniz oncesi aranir.
const YETERSIZ_SOL = 'Your SOL balance does not cover this transaction'

// dapp-imza-guvenlik-1 (ACILISI ENGELLER): ayni hesabi kapatip baska sahiple yeniden yaratan islem
// "To: You" gostermemeli. Zincir ustu gecerlilik OLCULMEDI; ekran fail-closed.
describe('SolanaSignTx.vue (SSR) -- dapp-imza-guvenlik-1: kapat-yeniden-yarat saldirisi', () => {
    const usdcMint = new PublicKey(USDC_MINT)
    const saldirgan = Keypair.generate().publicKey

    it('Init3(A,kullanici) -> Close(A) -> Init3(A,saldirgan) -> TransferChecked(A): alici "You" DEGIL cozulemedi, kutu ZORUNLU (simulasyonsuz)', async () => {
        const a = Keypair.generate().publicKey
        const { html, s } = await ac([txOdeyenli([
            createInitializeAccount3Instruction(a, usdcMint, CUZDAN.publicKey),
            createCloseAccountInstruction(a, CUZDAN.publicKey, CUZDAN.publicKey),
            createInitializeAccount3Instruction(a, usdcMint, saldirgan),
            createTransferCheckedInstruction(Keypair.generate().publicKey, usdcMint, a, CUZDAN.publicKey, 100_000_000n, 6),
        ])])
        const transfer = s.kartlar[0].preview.rows.find((r) => r.kind === 'tokenTransfer')
        const to = transfer.fields.find((f) => f.labelKey === 'dapps.solana.f.to')
        expect(to.value).toBeNull()
        expect(to.tokenAccount).toBe(a.toBase58())
        expect(s.kartlar[0].preview.hasUnknown).toBe(true)
        // Hicbir "to" hucresi kullaniciyi gostermez; saldirgan Init satirinda TAM adresle gorunur.
        expect(html).toContain(saldirgan.toBase58())
        expect(html).toContain('could not be read')
        expect(html).not.toContain('address lookup table')
        expect(html).toContain(a.toBase58())
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain(KUTU_METNI)
    })

    it('PATRON PoC (gercek System + Token talimatlari): CreateAccount(A) -> Init3(A,kullanici) -> Close(A) -> CreateAccount(A) -> Init3(A,saldirgan) -> TransferChecked(A): "To: You" YOK', async () => {
        const a = Keypair.generate().publicKey
        const tokenPid = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
        const yarat = () => SystemProgram.createAccount({
            fromPubkey: CUZDAN.publicKey, newAccountPubkey: a, lamports: 2_039_280, space: 165, programId: tokenPid,
        })
        const { html, s } = await ac([txOdeyenli([
            yarat(),
            createInitializeAccount3Instruction(a, usdcMint, CUZDAN.publicKey),
            createCloseAccountInstruction(a, CUZDAN.publicKey, CUZDAN.publicKey),
            yarat(),
            createInitializeAccount3Instruction(a, usdcMint, saldirgan),
            createTransferCheckedInstruction(Keypair.generate().publicKey, usdcMint, a, CUZDAN.publicKey, 100_000_000n, 6),
        ])])
        const transfer = s.kartlar[0].preview.rows.find((r) => r.kind === 'tokenTransfer')
        expect(transfer.fields.find((f) => f.labelKey === 'dapps.solana.f.to').value).toBeNull()
        // Hicbir satirin "to" hucresi kullaniciyi ("You") gostermez.
        const alicilar = s.kartlar[0].preview.rows.flatMap((r) => r.fields).filter((f) => f.labelKey === 'dapps.solana.f.to').map((f) => f.value)
        expect(alicilar).not.toContain(FROM)
        expect(s.kartlar[0].preview.hasUnknown).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain(KUTU_METNI)
    })

    it('SALDIRI simulasyon basariliyken: alici hala "You" gorunmez, hero "-100 USDC" der ama bilinmeyen uyarisi gorunur', async () => {
        const a = Keypair.generate().publicKey
        const b64 = txOdeyenli([
            createInitializeAccount3Instruction(a, usdcMint, CUZDAN.publicKey),
            createCloseAccountInstruction(a, CUZDAN.publicKey, CUZDAN.publicKey),
            createInitializeAccount3Instruction(a, usdcMint, saldirgan),
            createTransferCheckedInstruction(Keypair.generate().publicKey, usdcMint, a, CUZDAN.publicKey, 100_000_000n, 6),
        ])
        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(USDC_MINT, 150_000_000, 6)], post: [tokenKaydi(USDC_MINT, 50_000_000, 6)] }))
        const { html, s } = await ac([b64])
        const transfer = s.kartlar[0].preview.rows.find((r) => r.kind === 'tokenTransfer')
        expect(transfer.fields.find((f) => f.labelKey === 'dapps.solana.f.to').value).toBeNull()
        expect(s.kartlar[0].preview.hasUnknown).toBe(true)
        // Gercek bilinmeyen program yok (alici cozulemedi): genel metin, "program taninmiyor" DEGIL (final SU-8).
        expect(html).toContain(GENEL_OKUNAMADI_UYARISI)
        expect(html).not.toContain(BILINMEYEN_PROGRAM_UYARISI)
    })

    it('REGRESYON: ayni hesap ayni sahiple tekrar yaratilirsa (idempotent) alici SAHIBI cozulur ve kilit cikmaz', async () => {
        const a = Keypair.generate().publicKey
        const { s } = await ac([txOdeyenli([
            createInitializeAccount3Instruction(a, usdcMint, saldirgan),
            createInitializeAccount3Instruction(a, usdcMint, saldirgan),
            createTransferCheckedInstruction(Keypair.generate().publicKey, usdcMint, a, CUZDAN.publicKey, 1_000_000n, 6),
        ])])
        const to = s.kartlar[0].preview.rows.find((r) => r.kind === 'tokenTransfer').fields.find((f) => f.labelKey === 'dapps.solana.f.to')
        expect(to.value).toBe(saldirgan.toBase58())
    })
})

// dapp-imza-guvenlik-2 (Constraint 23(b) yorumu): kilit acisindan "simulasyon sonucu var" = TAM sonuc.
describe('SolanaSignTx.vue (SSR) -- dapp-imza-guvenlik-2: eksik/kismi token sonucu kilit icin "sonuc yok" sayilir', () => {
    const bilinmeyen = () => txOdeyenli([yabanciIx()])
    const zararsiz = () => txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
    const dizisiz = (tx) => {
        const y = simYaniti(tx)
        delete y.value.preTokenBalances
        delete y.value.postTokenBalances
        return y
    }
    const dizilerNull = (tx) => {
        const y = simYaniti(tx)
        y.value.preTokenBalances = null
        y.value.postTokenBalances = null
        return y
    }
    const sahipsiz = (tx) => {
        const kayit = tokenKaydi(JUP, 3_000_000, 6)
        delete kayit.owner
        return simYaniti(tx, { pre: [kayit], post: [] })
    }

    it.each([
        ['pre/postTokenBalances alanlari yok (tokensUnreadable)', dizisiz],
        ['diziler null (tokensUnreadable)', dizilerNull],
        ['owner siz token kaydi (partial)', sahipsiz],
    ])('bilinmeyen program + %s: kutu ZORUNLU, imza kutusuz gitmez; hero notu ve uyari AYNEN kalir', async (_ad, sim) => {
        simKur(sim)
        const { html, s, gonderilen } = await ac([bilinmeyen()])

        expect(s.bilinmeyenSimsiz).toBe(true)
        expect(s.onayKilitli).toBe(true)
        expect(dugmeKilitli(html)).toBe(true)
        expect(html).toContain(KUTU_METNI)
        // Hero karti / metin davranisi degismez (V10-2 notlari): sonuc "ok", token notu ve sabit uyari gorunur.
        expect(s.kahraman.durum).toBe('ok')
        expect(html).toContain(TOKEN_EKSIK_NOTU)
        expect(html).toContain(BILINMEYEN_PROGRAM_UYARISI)

        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(false)
        s.korImzaOnayi = true
        expect(s.onayKilitli).toBe(false)
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(true)
    })

    it('REGRESYON: bilinmeyen program + TAM sonuc (diziler var, owner var): kilit YOK, uyari gorunur (mevcut davranis)', async () => {
        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(JUP, 3_000_000, 6)], post: [] }))
        const { html, s } = await ac([bilinmeyen()])
        expect(s.bilinmeyenSimsiz).toBe(false)
        expect(s.onayKilitli).toBe(false)
        expect(html).not.toContain(KUTU_METNI)
        expect(html).toContain(BILINMEYEN_PROGRAM_UYARISI)
    })

    it('signAll KART BAZINDA: bilinmeyen kartin sonucu eksikse kilit (diger kartin TAM sonucu onu serbest birakmaz)', async () => {
        const a = bilinmeyen()
        const b = zararsiz()
        simKur((tx) => (tx === a ? dizisiz(tx) : simYaniti(tx)))
        const { html, s } = await ac([a, b], { mode: 'signAll' })
        expect(s.onayKilitli).toBe(true)
        expect(html).toContain(KUTU_METNI)
    })

    it('signAll: bilinmeyen kartin sonucu TAM, eksik sonuc zararsiz (hasUnknown olmayan) kartta: kilit YOK', async () => {
        const a = bilinmeyen()
        const b = zararsiz()
        simKur((tx) => (tx === b ? dizisiz(tx) : simYaniti(tx)))
        const { s } = await ac([a, b], { mode: 'signAll' })
        expect(s.bilinmeyenSimsiz).toBe(false)
        expect(s.onayKilitli).toBe(false)
    })
})

// SU-6: ATA Create/CreateIdempotent kirasi YALNIZ funder kullaniciysa kullanicinin kirasina eklenir.
describe('SolanaSignTx.vue (SSR) -- SU-6: ATA kirasi funder a bakilarak eklenir', () => {
    const dusukBakiye = () => solanaRpc.mockImplementation(async (method) => {
        if (method === 'getBalance') return { value: 1000 }
        if (method === 'getMinimumBalanceForRentExemption') return 2039280
        return { value: [] }
    })
    const rentCagrilari = () => solanaRpc.mock.calls.filter((c) => c[0] === 'getMinimumBalanceForRentExemption')

    it('funder BASKASI (ucreti de o oduyor): kira kullanicininkine eklenmez, bakiye uyarisi yanlis-pozitif vermez', async () => {
        const funder = Keypair.generate().publicKey
        const sahip = Keypair.generate().publicKey
        const ata = getAssociatedTokenAddressSync(USDC, sahip)
        dusukBakiye()
        const { html, s } = await ac([txOdeyenli([createAssociatedTokenAccountInstruction(funder, ata, sahip, USDC)], funder)])
        expect(s.kiraLamports).toBe(0)
        expect(s.kiraCozulemedi).toBe(false)
        expect(s.bakiyeYetersiz).toBe(false)
        expect(html).not.toContain(YETERSIZ_SOL)
        expect(rentCagrilari()).toHaveLength(0)
    })

    it('REGRESYON: funder KULLANICI: kira eklenir ve dusuk bakiyede uyari cikar', async () => {
        const sahip = Keypair.generate().publicKey
        const ata = getAssociatedTokenAddressSync(USDC, sahip)
        dusukBakiye()
        const { html, s } = await ac([txOdeyenli([createAssociatedTokenAccountInstruction(CUZDAN.publicKey, ata, sahip, USDC)])])
        expect(s.kiraLamports).toBe(2039280)
        expect(s.bakiyeYetersiz).toBe(true)
        expect(html).toContain(YETERSIZ_SOL)
    })

    it('ayni islemde iki ATA: yalniz kullanicinin funder oldugu ATA nin kirasi sayilir', async () => {
        const baskasi = Keypair.generate().publicKey
        const sahip = Keypair.generate().publicKey
        const { s } = await ac([txOdeyenli([
            createAssociatedTokenAccountInstruction(CUZDAN.publicKey, getAssociatedTokenAddressSync(USDC, sahip), sahip, USDC),
            createAssociatedTokenAccountInstruction(baskasi, getAssociatedTokenAddressSync(new PublicKey(JUP), sahip), sahip, new PublicKey(JUP)),
        ])])
        expect(s.kiraLamports).toBe(2039280)
    })
})

// SU-7: kucuk duzeltmeler.
describe('SolanaSignTx.vue (SSR) -- SU-7: hero :key benzersizligi, tutar tasmasi, memo kirpma', () => {
    // SSR cikti HTML'i v-for anahtarlarini tasimaz (anahtar yalniz istemci yamasinda kullanilir): anahtar
    // baglamasi sablon kaynagindan, benzersizlik on kosulu veriden dogrulanir.
    it('coklu modda giden ve gelen ayni varligi (SOL) ayri gruplarda tasir: key tek basina CAKISIR, sablon grup on ekini tasir', async () => {
        const a = txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        const b = txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => simYaniti(tx, { sol: tx === a ? -1_000_000_000n : 500_000_000n, fee: 0 }))
        const { s } = await ac([a, b], { mode: 'signAll' })
        const satirlar = s.kahraman.satirlar
        expect(satirlar.map((x) => x.grup)).toEqual(['giden', 'gelen'])
        // Veri duzeyinde ayni varlik anahtari iki grupta tekrarlanir...
        expect(new Set(satirlar.map((x) => x.key)).size).toBeLessThan(satirlar.length)
        // ...bu yuzden sablondaki :key grup ile birlesik olmak ZORUNDA.
        const kaynak = readFileSync(new URL('./SolanaSignTx.vue', import.meta.url), 'utf8')
        const heroDongusu = kaynak.match(/<template v-for="\(s, i\) in kahraman\.satirlar"[^>]*>/)?.[0]
        expect(heroDongusu).toBeTruthy()
        expect(heroDongusu).toMatch(/:key="s\.grup \+ ':' \+ s\.key"/)
    })

    it('decimals=255 mint: tutar span lari tasmaz (min-w-0 + break-all): kahraman, statik ozet ve kart tutari', async () => {
        const mint = Keypair.generate().publicKey
        const hedef = getAssociatedTokenAddressSync(mint, Keypair.generate().publicKey)
        const b64 = txOdeyenli([createTransferCheckedInstruction(Keypair.generate().publicKey, mint, hedef, CUZDAN.publicKey, 5n, 255)])
        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(mint.toBase58(), 5, 255)], post: [] }))
        const { html } = await ac([b64])
        const uzunTutarlar = [...html.matchAll(/<span class="([^"]*)">[-+]?0\.0{100,}5(?: [^<]*)?<\/span>/g)].map((m) => m[1])
        // kahraman (-0.000..5 <mint>), statik ozet (-0.000..5 <mint>), kart tutari (0.000..5)
        expect(uzunTutarlar.length).toBe(3)
        for (const sinif of uzunTutarlar) {
            expect(sinif).toContain('break-all')
            expect(sinif).toContain('min-w-0')
        }
    })

    it('signAll: karttaki simulasyon ozeti tutar span i da tasmaz', async () => {
        const mint = Keypair.generate().publicKey
        const b64 = () => txOdeyenli([sol(Keypair.generate().publicKey, 1000)])
        simKur((tx) => simYaniti(tx, { pre: [tokenKaydi(mint.toBase58(), 5, 255)], post: [] }))
        const { html } = await ac([b64(), b64()], { mode: 'signAll' })
        const uzunTutarlar = [...html.matchAll(/<span class="([^"]*)">-0\.0{100,}[1-9][0-9]* [^<]*<\/span>/g)].map((m) => m[1])
        // ust toplam (5 + 5 = 10 ham birim) + iki kartin kendi ozeti
        expect(uzunTutarlar.length).toBe(3)
        for (const sinif of uzunTutarlar) {
            expect(sinif).toContain('break-all')
            expect(sinif).toContain('min-w-0')
        }
    })

    it('memo: gorunmez karakter etiketleri 140 kod noktasini asar ama kart ikinci kez KIRPMAZ (hicbir etiket yarida kesilmez)', async () => {
        const { html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000), memoIx('​'.repeat(100))])])
        // 100 kod noktasi < 140: decoder kirpmaz (memoTruncated false); her biri "[U+200B]" etiketi olur (800 karakter).
        expect(html).toContain('[U+200B]'.repeat(100))
        expect(html).not.toContain('text shortened')
    })

    it('memo: decoder kirptiginda (300 karakter) not gorunur ve kart ayrica kirpmaz', async () => {
        const { html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1000), memoIx('y'.repeat(300))])])
        expect(html).toContain('y'.repeat(140))
        expect(html).not.toContain('y'.repeat(141))
        expect(html).toContain('text shortened')
    })
})

// test-kalitesi-4: statik ozet toplama ve ozetKur dallari. Her test, kapsadigi uretim satiri gecici
// bozularak kirmiziya dondugu gozlemlenerek dogrulandi (bkz. final-duzeltme-dapp-ozet.md, mutasyon tablosu).
describe('SolanaSignTx.vue (SSR) -- test-kalitesi-4: statik ozet toplama', () => {
    const tutarlar = (s) => s.statikOzet.map((o) => o.tutar)
    // Statik ozet kutusunun gorunen metni (kartlar kapsayicisina kadar).
    const statikMetin = (html) => {
        const bas = html.indexOf(`id="${STATIK_KUTU}"`)
        if (bas < 0) return null
        return gorunenMetin(html.slice(bas, html.indexOf('class="flex flex-col gap-2.5"', bas)))
    }
    const hedefAta = () => getAssociatedTokenAddressSync(USDC, Keypair.generate().publicKey)
    const usdcTransfer = (miktar, hedef = hedefAta()) => createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, hedef, CUZDAN.publicKey, miktar, 6)

    it('ayni varligin birden cok satiri TOPLANIR: iki SOL transferi (1+2) tek satir "-3 SOL"', async () => {
        const { s, html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 1_000_000_000), sol(Keypair.generate().publicKey, 2_000_000_000)])])
        expect(tutarlar(s)).toEqual(['3'])
        const metin = statikMetin(html)
        expect(metin).toContain('-3 SOL')
        expect(metin).not.toContain('-1 SOL')
        expect(metin).not.toContain('-2 SOL')
    })

    it('iki USDC TransferChecked (100 + 50) tek satir "-150 USDC"', async () => {
        const { s, html } = await ac([txOdeyenli([usdcTransfer(100_000_000n), usdcTransfer(50_000_000n)])])
        expect(tutarlar(s)).toEqual(['150'])
        expect(statikMetin(html)).toContain('-150 USDC')
    })

    it('signAll: iki kartin ayni varligi ekran capinda TEK toplam satir olur (1 + 1 = 2 SOL)', async () => {
        const { s, html } = await ac([
            txOdeyenli([sol(Keypair.generate().publicKey, 1_000_000_000)]),
            txOdeyenli([sol(Keypair.generate().publicKey, 1_000_000_000)]),
        ], { mode: 'signAll' })
        expect(tutarlar(s)).toEqual(['2'])
        expect(statikMetin(html)).toContain('-2 SOL')
    })

    it('ayni mint FARKLI decimals: ham birimler TOPLANMAZ, her olcek ayri satir (yanlis "1001 USDC" uretilmez)', async () => {
        const hedef = hedefAta()
        const { s } = await ac([txOdeyenli([
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, hedef, CUZDAN.publicKey, 1_000_000n, 6),
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, hedef, CUZDAN.publicKey, 1_000_000_000n, 9),
        ])])
        expect(tutarlar(s).sort()).toEqual(['1', '1'])
        expect(s.statikOzet).toHaveLength(2)
    })

    it('CreateAccount fon aktarimi dali: createAccount(50 SOL, space 0) -> ["49.99910912"] (kira DAHIL DEGIL)', async () => {
        const { s, html } = await ac([txOdeyenli([SystemProgram.createAccount({
            fromPubkey: CUZDAN.publicKey, newAccountPubkey: Keypair.generate().publicKey, lamports: 50_000_000_000, space: 0, programId: SystemProgram.programId,
        })])])
        expect(tutarlar(s)).toEqual(['49.99910912'])
        expect(statikMetin(html)).toContain('-49.99910912 SOL')
    })

    it('Burn dali: createBurnChecked(100 USDC) -> ["100"] ve statik ozet kutusu gorunur', async () => {
        const { s, html } = await ac([txOdeyenli([
            createBurnCheckedInstruction(Keypair.generate().publicKey, USDC, CUZDAN.publicKey, 100_000_000n, 6),
        ])])
        expect(tutarlar(s)).toEqual(['100'])
        expect(html).toContain(STATIK_KUTU)
        expect(statikMetin(html)).toContain('-100 USDC')
    })

    it('sifir tutar filtresi: sifir lamport transferi satir uretmez ("-0 SOL" yok), kutu cizilmez', async () => {
        const { s, html } = await ac([txOdeyenli([sol(Keypair.generate().publicKey, 0)])])
        expect(tutarlar(s)).toEqual([])
        expect(html).not.toContain(STATIK_KUTU)
        expect(html).not.toContain('-0 SOL')
    })

    it('affectsUser filtresi: ucreti VE kaynagi baskasi olan transfer kullanicinin ozetine girmez', async () => {
        const { s, html } = await ac([txOdeyenli([
            SystemProgram.transfer({ fromPubkey: SALDIRGAN, toPubkey: Keypair.generate().publicKey, lamports: 5_000_000_000 }),
        ], SALDIRGAN)])
        expect(tutarlar(s)).toEqual([])
        expect(html).not.toContain(STATIK_KUTU)
    })
})

describe('SolanaSignTx.vue (SSR) -- test-kalitesi-4: kartEtkili ve izin notu (ozetKur)', () => {
    // Tutar TASIMAYAN ama kullaniciyi etkileyen satir + ucreti BASKASI oduyor + bos simulasyon farki:
    // ekran "degisim yok" DEMEMELI (satirin kendisi kartEtkili'nin `rows.some(affectsUser)` kolundan gelir).
    const ata = () => getAssociatedTokenAddressSync(USDC, Keypair.generate().publicKey)
    it.each([
        ['Revoke', () => createRevokeInstruction(Keypair.generate().publicKey, CUZDAN.publicKey)],
        ['FreezeAccount', () => createFreezeAccountInstruction(Keypair.generate().publicKey, USDC, CUZDAN.publicKey)],
        ['ATA Create (funder kullanici)', () => createAssociatedTokenAccountInstruction(CUZDAN.publicKey, ata(), Keypair.generate().publicKey, USDC)],
        ['InitializeAccount3 (sahip kullanici)', () => createInitializeAccount3Instruction(Keypair.generate().publicKey, USDC, CUZDAN.publicKey)],
    ])('%s + ucreti baskasi + bos sim farki: "degisim yok" YOK, izin notu VAR', async (_ad, ix) => {
        simKur((tx) => simYaniti(tx, { sol: 0n }))
        const { html, s } = await ac([txOdeyenli([ix()], SALDIRGAN)])
        expect(s.simulasyonSonucuVar).toBe(true)
        expect(s.kahraman.satirlar).toEqual([])
        expect(html).not.toContain(DEGISIM_YOK)
        expect(html).toContain(IZIN_NOTU)
    })

    it('REGRESYON: kullaniciyi HIC etkilemeyen satir (yalniz baskasinin Memo su) + bos fark: "degisim yok" yazilir', async () => {
        simKur((tx) => simYaniti(tx))
        const { html } = await ac([txOdeyenli([memoIx('merhaba')], SALDIRGAN)])
        expect(html).toContain(DEGISIM_YOK)
        expect(html).not.toContain(IZIN_NOTU)
    })

    it('kirmizi bayrak (bilinmeyen YOK) + DOLU fark + basarili sim: balanceNoPermissionNote gorunur, "degisim yok" asla', async () => {
        simKur((tx) => simYaniti(tx, { sol: -5000n }))
        // ApproveChecked: mint + decimals talimatta, hasUnknown OLMAZ; yalniz kirmizi bayrak izin notunu tasir.
        const { html, s } = await ac([txOdeyenli([
            createApproveCheckedInstruction(Keypair.generate().publicKey, USDC, Keypair.generate().publicKey, CUZDAN.publicKey, 10n, 6),
        ])])
        expect(s.kirmiziBayrakVar).toBe(true)
        expect(s.bilinmeyenVar).toBe(false)
        expect(s.kahraman.satirlar.length).toBeGreaterThan(0)
        expect(html).toContain(IZIN_NOTU)
        expect(html).not.toContain(DEGISIM_YOK)
    })
})

// ---------------------------------------------------------------------------
// FINAL DUZELTME DALGASI (metin alani): nedene yansiz uyari/onay metinleri
// ---------------------------------------------------------------------------
describe('SolanaSignTx.vue (SSR) -- final metin: SU-8 neden-yansiz uyari', () => {
    it('SU-8: legacy TransferChecked + alici sahibi okunamadi (getMultipleAccounts 403): ALT ve "program taninmiyor" DEMEZ, genel metin VAR, kilit AYNEN', async () => {
        solanaRpc.mockImplementation(async (method) => {
            if (method === 'getMultipleAccounts') throw new Error('403')
            if (method === 'getBalance') return { value: 5_000_000_000 }
            return { value: [] }
        })
        const hedefHesap = Keypair.generate().publicKey
        const { html, s } = await ac([txOdeyenli([
            createTransferCheckedInstruction(Keypair.generate().publicKey, USDC, hedefHesap, CUZDAN.publicKey, 5_000_000n, 6),
        ])])
        expect(s.kartlar[0].preview.hasUnknown).toBe(true)
        expect(s.altCozulemedi).toBe(false)
        expect(html).not.toContain('lookup table')
        expect(html).not.toContain(BILINMEYEN_PROGRAM_UYARISI)
        expect(html).toContain(GENEL_OKUNAMADI_UYARISI)
        expect(html).toContain('could not be read')
        // Kilit davranisi DEGISMEZ.
        expect(s.onayKilitli).toBe(true)
    })

    it('SU-8: GERCEK bilinmeyen program -> "program taninmiyor" VAR, genel metin YOK', async () => {
        const { html, s } = await ac([txOdeyenli([yabanciIx()])])
        expect(html).toContain(BILINMEYEN_PROGRAM_UYARISI)
        expect(html).not.toContain(GENEL_OKUNAMADI_UYARISI)
        expect(s.onayKilitli).toBe(true)
    })

    it('SU-8: "address lookup table" ifadesi YALNIZ lookupUnresolved bandinda (ALT cozulemedi, bilinmeyen program yok)', async () => {
        solanaRpc.mockRejectedValue(new Error('SOLANA_RPC_TIMEOUT'))
        const { html, s } = await ac([v0AltTx()])
        expect(s.altCozulemedi).toBe(true)
        expect(html).toContain('lookup table the wallet could not read')
        expect((html.match(/lookup table/g) || []).length).toBe(1)
        expect(html).not.toContain(BILINMEYEN_PROGRAM_UYARISI)
        expect(html).toContain(GENEL_OKUNAMADI_UYARISI)
    })
})

describe('SolanaSignTx.vue (SSR) -- final metin: E-e kutu onay cumlesi nedene gore', () => {
    const YUKSEK_UCRET = () => [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000_000 }),
    ]
    const simYok = () => simKur(() => new Error('SOLANA_RPC_TIMEOUT'))

    it('E-e: yalniz oncelik ucreti -> priorityFeeAck, blindAck YOK', async () => {
        simYok()
        const { html, s } = await ac([txOdeyenli([...YUKSEK_UCRET(), sol(Keypair.generate().publicKey, 1)])])
        expect(s.oncelikKutu).toBe(true)
        expect(s.korImzaNedeniVar).toBe(false)
        expect(html).toContain(ONCELIK_ONAY_METNI)
        expect(html).not.toContain(KUTU_METNI)
        expect(s.onayKilitli).toBe(true)
    })

    it('E-e: yalniz bilinmeyen program (ucret normal) -> blindAck, priorityFeeAck YOK', async () => {
        simYok()
        const { html, s } = await ac([txOdeyenli([yabanciIx()])])
        expect(s.oncelikKutu).toBe(false)
        expect(html).toContain(KUTU_METNI)
        expect(html).not.toContain(ONCELIK_ONAY_METNI)
    })

    it('E-e: ikisi birden -> iki cumle, TEK kutu (tek onay kutusu)', async () => {
        simYok()
        const { html, s, gonderilen } = await ac([txOdeyenli([...YUKSEK_UCRET(), yabanciIx()])])
        expect(html).toContain(KUTU_METNI)
        expect(html).toContain(ONCELIK_ONAY_METNI)
        expect((html.match(/id="solana-sign-tx-blind-ack"/g) || []).length).toBe(1)
        // Tek isaretleme ikisini birden karsilar; kilit mantigi degismedi.
        expect(s.onayKilitli).toBe(true)
        s.korImzaOnayi = true
        expect(s.onayKilitli).toBe(false)
        await s.onayla()
        expect(imzaGonderildi(gonderilen)).toBe(true)
    })
})

describe('SolanaSignTx.vue (SSR) -- final metin: SU-18 sinirli Approve metni', () => {
    it('SU-18: sinirli ApproveChecked de "gosterilen tutara kadar" der, sinirsiz mevcut metni korur', async () => {
        const mint = Keypair.generate().publicKey
        const cuzdanHesabi = Keypair.generate().publicKey
        const harca = Keypair.generate().publicKey
        const sinirli = await ac([txOdeyenli([
            createApproveCheckedInstruction(cuzdanHesabi, mint, harca, CUZDAN.publicKey, 5_000_000n, 6),
        ])])
        expect(sinirli.html).toContain('spend up to the amount shown')
        expect(sinirli.html).not.toContain('open-ended allowance')

        const sinirsiz = await ac([txOdeyenli([
            createApproveCheckedInstruction(cuzdanHesabi, mint, harca, CUZDAN.publicKey, 2n ** 64n - 1n, 6),
        ])])
        expect(sinirsiz.html).toContain('open-ended allowance')
        expect(sinirsiz.html).not.toContain('spend up to the amount shown')
    })
})

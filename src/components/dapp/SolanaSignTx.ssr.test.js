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

import {
    AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, Transaction,
    TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js'
import { createApproveInstruction, createAssociatedTokenAccountInstruction } from '@solana/spl-token'
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
        expect(html).toContain('Grants a third party an open-ended allowance over this token account')
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

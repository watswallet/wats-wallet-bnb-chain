<template>
    <!-- GERCEK origin EN BASKIN eleman (K5, kabuktaki buyuk h2). Wallet
         Standard'da manifest YOKTUR, yani sayfanin verdigi ad TAMAMEN
         saldirgan kontrolundedir ve baskin oge OLAMAZ -- kabugun iddia
         pilinde, `claimedLabel` cevirisiyle (SolanaConnectApprove.vue'deki
         AYNI kalip) ikincil ve soluk gosterilir. -->
    <ApprovalShell
        chain="solana"
        :title="$t('dapps.solana.signTxTitle')"
        :origin="hostname"
        :claimed-name="iddiaEdilenAd ? $t('dapps.solana.claimedLabel', { name: iddiaEdilenAd }) : ''"
    >
        <template #header-extra>
            <!-- DURUSTLUK KURALI (obligation 4/K5): "yayinlanacak" YALNIZCA
                 mode==='signAndSend' iken cizilir -- sign/signAll'da yayini
                 dapp yapar, aksini soylemek daha guclu bir iddiadir. -->
            <div v-if="yayinlanacak" class="flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-full bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/50 transition-colors duration-300">
                <span class="text-[10px] font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider">{{ $t('dapps.solana.broadcastBadge') }}</span>
            </div>
            <div v-if="durableNonce" class="flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 transition-colors duration-300">
                <span class="text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">{{ $t('dapps.solana.durableNonceBadge') }}</span>
            </div>
        </template>

        <div v-if="kirmiziBayrakVar" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed">{{ $t('dapps.solana.redFlagTitle') }}</p>
        </div>

        <!-- C1 fix (task-31 review): decode+bakiye HENUZ bitmemisken (bkz.
             script'teki cozumlemeBitti) kart alani ve maliyet paneli HIC
             cizilmez -- aksi halde bu pencerede dugme etkindi ve ekran
             "0.000000000 SOL" gibi UYDURULMUS bir sifir maliyet gosteriyordu. -->
        <div v-if="requestData && !cozumlemeBitti" class="flex flex-col items-center gap-2 text-slate-400 dark:text-zinc-500">
            <p class="text-xs">{{ $t('dapps.solana.resolving') }}</p>
        </div>

        <template v-if="cozumlemeBitti">
        <div class="flex flex-col gap-2.5">
            <div v-for="kart in kartlar" :key="kart.index" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.txLabel', { n: kart.index + 1 }) }}</span>
                    <span v-if="kart.isDurableNonce" class="text-[10px] text-sky-600 dark:text-sky-400">{{ $t('dapps.solana.durableNonce') }}</span>
                </div>

                <!-- DURUSTLUK KURALI (obligation 6): talimat listesi GERCEKTEN
                     bossa bu "temiz" bir kart DEGILDIR -- decodeInstructions
                     hem "parsed yoktu" hem "gercekten sifir talimat" icin AYNI
                     bos diziyi dondurur (Task 27). Sessizce hicbir sey
                     gostermemek "burada tehlikeli bir sey yok" IZLENIMI
                     verirdi; bu yuzden acikca soylenir. -->
                <div v-if="kart.talimatlar.length === 0" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5">
                    <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.noInstructions') }}</p>
                </div>

                <div v-for="ix in kart.talimatlar" :key="ix.index" class="flex flex-col gap-1 border-t border-slate-100 dark:border-white/5 pt-2 first:border-t-0 first:pt-0">
                    <div v-if="ix.type" class="flex justify-between items-center">
                        <span class="text-xs font-medium" :class="ix.redFlag ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-zinc-300'">{{ ix.type }}</span>
                        <span class="text-[10px] font-mono text-slate-400 dark:text-zinc-500">{{ kisa(ix.programId) }}</span>
                    </div>
                    <p v-if="ix.redFlag" class="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">{{ $t('dapps.solana.redFlag_' + ix.type) }}</p>

                    <!-- DURUSTLUK KURALI (K5): cozemedigimiz talimat icin ozet
                         UYDURULMAZ. Ham baytlarin SHA-256'si gosterilir --
                         dogrulanabilir, ama YANILTMAZ (TonSignData.vue emsali). -->
                    <!-- M1 fix (task-31 review): BAGIMSIZ v-if, `v-if="ix.redFlag"`
                         (bir ust satir) zincirine BAGLI degil -- v-else-if olsaydi
                         ikisi arasina yeni bir eleman girdiginde bu panel
                         SESSIZCE kaybolurdu. -->
                    <div v-if="!ix.type" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5 flex flex-col gap-1">
                        <p class="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.undecodable') }}</p>
                        <span class="text-[10px] font-mono text-amber-800 dark:text-amber-300 break-all">{{ $t('dapps.solana.instructionHashLabel') }}: {{ kisaHash(ix.hash) }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- C3.1: kartKur cozumleme hatasi VERDIYSE (cozumlemeHatasi) bu
             panel HIC cizilmez -- kartlar.value bos/eksik kaldigi icin
             asagidaki taban ucret/kira hesaplari UYDURULMUS bir
             "0.000000000 SOL" gosterirdi. -->
        <div v-if="!cozumlemeHatasi" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-1.5">
            <div class="flex justify-between items-center">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.baseFeeLabel') }}</span>
                <span class="text-sm font-bold tabular-nums">{{ tabanUcretSol }} SOL</span>
            </div>
            <div class="flex justify-between items-center">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.priorityFeeLabel') }}</span>
                <!-- I2 fix (task-31 review): "yok" ile "var ama okunamadi"
                     AYRISTIRILIR -- ikisi de null'dan geliyordu (bkz.
                     oncelikUcretiOkunamadi tanimi), "yok" digerine dusseydi
                     okunamayan bir deger OLUMLU bir iddiaya donusurdu. -->
                <span class="text-sm tabular-nums">{{ oncelikUcretiOkunamadi ? $t('dapps.solana.rentUnknown') : (butce.unitPriceMicroLamports === null ? $t('dapps.solana.noPriorityFee') : butce.unitPriceMicroLamports + ' µL') }}</span>
            </div>
            <!-- §5.2'nin ucuncu maliyet kalemi: OLUSTURULAN hesaplarin
                 kirasi. Okunamadiysa rakam UYDURULMAZ (K5), acikca
                 "okunamadi" yazilir. -->
            <div class="flex justify-between items-center">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('dapps.solana.rentLabel') }}</span>
                <span class="text-sm tabular-nums">{{ kiraCozulemedi ? $t('dapps.solana.rentUnknown') : kiraSol + ' SOL' }}</span>
            </div>
        </div>
        </template>

        <!-- §5.2'nin dorduncu kalemi: bakiye taban ucret + kirayi
             karsilamiyorsa KIRMIZI uyari. Uyari BILGILENDIRIR, istegi
             REDDETMEZ -- yayini yapacak olan da (bu turda) dapp'tir. -->
        <div v-if="bakiyeYetersiz" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed">{{ $t('dapps.solana.insufficientSol') }}</p>
        </div>

        <!-- ALT cozumlemesi basarisiz olduysa istek REDDEDILMEZ; yalnizca
             durustce soylenir (§5.2). -->
        <div v-if="altCozulemedi" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3">
            <p class="text-[10px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.lookupUnresolved') }}</p>
        </div>

        <div v-if="hata" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed">{{ hata }}</p>
        </div>

        <template #footer>
            <button @click="reddet" :disabled="loading" class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 cursor-pointer">
                {{ $t('dapps.solana.btn_reject') }}
            </button>
            <!-- KOD INCELEMESI (obligation 1, Gorev 14'un SolanaConnectApprove'da
                 bulunan bulgusu buraya da uygulanir): dugme yalniz `loading`e
                 bagli olsaydi sablon, onMounted'in TEK await'i cozulmeden ONCE
                 zaten cizilmis olacagindan GORSEL olarak etkin gorunurdu; tiklama
                 onayla()'nin kendi kilidine SESSIZCE carpar ve kullaniciya HICBIR
                 geri bildirim gitmezdi. `!requestData` ekleyerek dugme, gonderecegi
                 seyi GERCEKTEN bilene kadar devre disi kalir. -->
            <button
                id="solana-sign-tx-approve"
                @click="onayla"
                :disabled="loading || !requestData || !cozumlemeBitti || cozumlemeHatasi || gonderildi"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white cursor-pointer disabled:opacity-50"
            >
                {{ loading ? '…' : $t('dapps.solana.btn_sign') }}
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
// bufferGlobal ILK IMPORT: bu bilesen @solana/* grafigine giriyor ve o grafik
// modul degerlendirmesinde serbest `Buffer` global'ini okuyor.
import '../../utils/solana/bufferGlobal.js'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AddressLookupTableAccount } from '@solana/web3.js'
import { pageStore } from '../../store/pageStore'
import { shortenAddress } from '../../utils/shortenAddress'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { sha256, toHex } from '../../utils/crypto-utils'
import { parseDappTransaction } from '../../utils/solana/parseDappTransaction'
import { gorunurKil } from '../../utils/solana/visibleText.js'
import { decodeInstructions, computeBudgetSummary, hasRedFlag } from '../../utils/solana/decodeInstructions'
import { resolveSolanaSendError } from '../../utils/solana/sendErrors'
import { solanaRpc } from '../../utils/solana/client'
import { LAMPORTS_PER_SOL } from '../../utils/solana/constants'
import ApprovalShell from './ApprovalShell.vue'

const { t } = useI18n()
const page = pageStore()

// Adres arama tablosu (ALT) cozumlemesine tanidigimiz UST SINIR. Yaniti hic
// vermeyen bir sunucu suresiz beklense onay ekrani ACILIR ama HIC dolmaz ve
// dapp'in promise'i beraberinde asili kalir.
const ALT_TIMEOUT_MS = 4000
const IMZA_UCRETI_LAMPORTS = 5000
// SPL token hesabinin sabit boyutu -- ATA kirasi bu boyutla sorulur. send.js'te
// AYNI sayi var ama modul ICINDE, disa acilmamis; ikinci bir sabit ADI acmak
// yerine deger burada tekrarlaniyor (sorgunun tek parametresi).
const ATA_HESAP_BOYUTU = 165

const requestData = ref(null)

// Yayini KIM yapacak? `mode` olmadan ekran ile arka plan anlasamaz (§4.5):
// ayni ekran uc semantik islemi tasiyor ve yalniz signAndSend'de ucret ONAY
// ANINDA odenir.
const yayinlanacak = computed(() => requestData.value?.mode === 'signAndSend')

// Durable nonce'ta blockhash tazeligi kontrolu ATLANIR (§6.5): bu islemin
// gecerlilik suresi normal bir blockhash gibi ~2 dakikada dolmaz.
const durableNonce = computed(() => !!requestData.value?.isDurableNonce)

const account = ref(null)
const loading = ref(false)
// Gorev 39 Minor 6: SEND_TX_SUCCESS'i gonderdikten SONRA current_request'in
// diskten silinmesi resolvePendingRequest icinde ASENKRON yapilir
// (dappFunctions.js: chrome.storage.local.remove('current_request') await'i)
// VE arka plan bu mesaj icin sendResponse HIC cagirmaz (background.js:
// SEND_TX_SUCCESS/SEND_TX_REJECTED `ignoredResponses` dalinda `return`,
// `return true` DEGIL) -- yani onayla()'nin `await
// chrome.runtime.sendMessage({ type: 'SEND_TX_SUCCESS', ... })`'i o silme
// islemini HIC BEKLEMEZ. Ekran, kaydin o an diskten silinmis oldugunu
// VARSAYAMAZ: kisa bir pencerede current_request HALA orada olabilir ve bu
// pencerede ikinci bir onayla() cagrisi signAndSendFromApproval'i TEKRAR
// calistirip TEKRAR yayinlayabilir (cift harcama DEGIL, ed25519
// deterministik, ama gereksiz bir ikinci ag cagrisi + ikinci bir
// SEND_TX_SUCCESS). `loading` YALNIZCA istek surerken korur, tamamlaninca
// sifirlanir (retry'ye izin vermek icin BILEREK boyle -- bkz. asagidaki hata
// dali). `gonderildi` ise BIR KEZ basariyla gonderildikten sonra HIC
// sifirlanmaz: ikinci bir onayla() cagrisi (ikinci tiklama ya da programatik
// cagri) buradan YENI bir SOLANA_DAPP_SIGN_TX gonderemez.
const gonderildi = ref(false)
const hata = ref('')
const kartlar = ref([])
// C1 fix (task-31 review): onMounted'in kartKur/getBalance await'leri surerken
// (ALT cozumlemesi ALT_TIMEOUT_MS=4000'e kadar surebilir) requestData ZATEN
// dolu ve onay dugmesi ONCEDEN SADECE ona bagliydi -- bu, hicbir kart
// cozulmemisken ve maliyet paneli UYDURULMUS bir "0.000000000 SOL"
// gosterirken etkin bir onay dugmesi sunuyordu. `cozumlemeBitti` bu pencereyi
// kapatir.
const cozumlemeBitti = ref(false)
// C3.1 (nihai inceleme, Task 31'in ERTELEDIGI ikinci kapi): kartKur bir
// istisna FIRLATIRSA (orn. parseDappTransaction TX_DESERIALIZE_FAILED) yukaridaki
// try/finally onu YUTUP `cozumlemeBitti`i yine true yapardi -- kartlar.value
// ATANMADAN once dongu kirilir, ekran SIFIR kartla "cozumleme bitti" sanir ve
// maliyet paneli UYDURULMUS "0.000000000 SOL" gosterirken onay dugmesi
// ETKIN kalirdi. Bu bayrak o pencereyi kapatir: hem dugmeyi kilitler hem
// maliyet ozetini gizler.
const cozumlemeHatasi = ref(false)
const altCozulemedi = ref(false)
// §5.2'nin kalan maliyet kalemleri. Hepsi FAIL-OPEN: zincirden okunamayan bir
// kalem istegi REDDETMEZ, yalnizca "okunamadi" olarak gosterilir.
const kiraLamports = ref(0)
const kiraCozulemedi = ref(false)
const ataKirasi = ref(null)
const bakiyeLamports = ref(null)

// GLOBAL KISIT: sayfa kontrolundeki HER metin (appMeta, cozulen adresler/
// program id'leri) `utils/solana/visibleText.js`'teki PAYLASILAN
// gorunmezlik/homoglif helper'inden (gorunurKil) gecer -- Task 23/31'in SIWS
// `uri` alani icin duzelttigi bicimin AYNISI (C3.2: eskiden bu dosya ve
// SolanaSignMessage.vue AYNI mantigi BAGIMSIZ kopyalar halinde tasiyordu,
// biri guncellenip digeri unutulursa yeni bir sinif TEK ekranda kapanirdi).
// `origin`/hostname burada BILEREK helper'dan GECMEZ: `new URL(...)
// .hostname` zaten IDNA/punycode uygulayarak Kiril/Yunan homoglif harflerini
// gorunumde AYRISTIRICI bir 'xn--' onekine cevirir (dogrulandi -- bkz. task-31
// rapor notlari); helper'i BURAYA da uygulamak sifir-genislik gibi bazi kod
// noktalarini SESSIZCE yutan (yine dogrulandi) URL ayristirmasindan SONRA
// calisacagi icin yanlis bir guven duygusu verirdi, gercek bir koruma EKLEMEZ.
const hostname = computed(() => {
    try { return new URL(requestData.value?.origin || '').hostname } catch (e) { return requestData.value?.origin || '' }
})
const iddiaEdilenAd = computed(() => gorunurKil(String(requestData.value?.appMeta?.name || '').slice(0, 64)))
// programId/adresler base58 -- bu 58 karakterlik alfabede homoglif ya da
// gorunmez bir kod noktasi hicbir zaman OLUSAMAZ (base58Encode.js). Helper yine
// de uygulanir: asiri-isaretleme ZARARSIZDIR, decodeInstructions.js'in DISINDA
// (bozuk/beklenmedik) bir girdi gelirse eksik-isaretlemeye DUSMEMEK icindir.
const kisa = (v) => gorunurKil(shortenAddress(v || '', 4, 4))
const kisaHash = (v) => shortenAddress(v || '', 16, 8)

const tumTalimatlar = computed(() => kartlar.value.flatMap((k) => k.talimatlar))
const kirmiziBayrakVar = computed(() => hasRedFlag(tumTalimatlar.value))
const butce = computed(() => computeBudgetSummary(tumTalimatlar.value))
// Cuzdan dapp isleminin ComputeBudget'ini DEGISTIRMEZ ve talimat EKLEMEZ
// (§5.2): oyle bir mudahale dapp'in islemini gecersiz kilar. Burada yalnizca
// OKUNAN degerler gosteriliyor.
const tabanUcretLamports = computed(
    () => kartlar.value.reduce((n, k) => n + k.imzaciSayisi, 0) * IMZA_UCRETI_LAMPORTS,
)
const tabanUcretSol = computed(() => (tabanUcretLamports.value / LAMPORTS_PER_SOL).toFixed(9))
const kiraSol = computed(() => (kiraLamports.value / LAMPORTS_PER_SOL).toFixed(9))
// I2 fix (task-31 review): unitPriceMicroLamports===null AYNI sekilde HEM
// "SetComputeUnitPrice talimati hic yok" HEM "var ama verisi kirpilmis,
// microLamports okunamadi" (readU64LE null doner, decodeInstructions.js)
// durumlarinda gelir. Ikisini AYIRT ETMEDEN "yok" gostermek, "okunamadi"yi
// OLUMLU bir iddiaya cevirir -- K5'in yasakladigi TAM O sinif.
const oncelikUcretiOkunamadi = computed(() => tumTalimatlar.value.some((ix) => ix.type === 'SetComputeUnitPrice')
    && butce.value.unitPriceMicroLamports === null)
// Bakiye OKUNAMADIYSA uyari HIC cikmaz: bir RPC hatasi yuzunden "bakiyen
// yetmiyor" demek, kullaniciya gercek olmayan bir engel gostermek olurdu. Kira
// okunamadiysa toplam EKSIK tahmin edilir -- bu yondeki hata yalnizca uyariyi
// kacirir, ASLA uydurmaz.
const bakiyeYetersiz = computed(() => bakiyeLamports.value !== null
    && bakiyeLamports.value < tabanUcretLamports.value + kiraLamports.value)

/**
 * v0 islemlerinde adreslerin bir kismi ADRES ARAMA TABLOSUNDADIR ve zincirden
 * okunmadan cozulemez. Basarisizlik istegi REDDETMEZ (§5.2): sunucu bir
 * saniyeligine yavasladi diye mesru bir islemi oldurmek yerine ekran "bu
 * adresleri cozemedim" der.
 */
async function altAdresleri(parsed) {
    if (parsed.version !== 0) return null
    const lookups = parsed.tx.message.addressTableLookups || []
    if (lookups.length === 0) return null

    const keys = lookups.map((l) => l.accountKey.toBase58())
    const zamanAsimi = new Promise((_, reject) => setTimeout(() => reject(new Error('SOLANA_RPC_TIMEOUT')), ALT_TIMEOUT_MS))
    const res = await Promise.race([
        solanaRpc('getMultipleAccounts', [keys, { encoding: 'base64' }]),
        zamanAsimi,
    ])

    const writable = []
    const readonly = []
    ;(res?.value || []).forEach((hesap, i) => {
        if (!hesap?.data?.[0]) throw new Error('ALT_NOT_FOUND')
        const table = AddressLookupTableAccount.deserialize(Uint8Array.from(Buffer.from(hesap.data[0], 'base64')))
        for (const idx of lookups[i].writableIndexes) writable.push(table.addresses[idx]?.toBase58() ?? null)
        for (const idx of lookups[i].readonlyIndexes) readonly.push(table.addresses[idx]?.toBase58() ?? null)
    })
    return { writable, readonly }
}

/**
 * Hex dizgeden little-endian u64. CreateAccount'un veri duzeni
 * [u32 ayirici][u64 lamports][u64 space][32 bayt sahip]; kira icin lamports
 * 4. bayttan okunur. Task 27'nin cozucusu bu alani YALNIZCA Transfer icin
 * dolduruyor, bu yuzden deger ham baytlardan aliniyor. BigInt kullanilir:
 * Number 2^53 ustunde hassasiyet kaybeder ve ekranda kullanicinin hic
 * onaylamadigi bir tutar olusurdu.
 */
function u64Oku(dataHex, bayt) {
    const parca = String(dataHex || '').slice(bayt * 2, bayt * 2 + 16)
    // I3 fix (task-31 review): kirpilmis/bozuk veriden SESSIZCE 0n UYDURMAK,
    // ayni fonksiyonun cagirani olan kartKur'daki ATA kira kontrolunun
    // (!Number.isFinite -> throw) uyguladigi disiplinle CELISIYORDU. Burada da
    // FIRLATILIR; kartKur'u saran try/catch bunu zaten kiraCozulemedi=true'ya
    // cevirir (K5: okunamayan bir kalem asla 0 olarak gosterilmez).
    if (parca.length < 16) throw new Error('RENT_FIELD_UNREADABLE')
    let deger = 0n
    for (let i = 7; i >= 0; i -= 1) deger = (deger << 8n) | BigInt(parseInt(parca.slice(i * 2, i * 2 + 2), 16))
    return deger
}

async function kartKur(base64, index) {
    const parsed = parseDappTransaction(base64)

    let lookups = null
    try {
        lookups = await altAdresleri(parsed)
    } catch (e) {
        // Fail-open: cozumleme yoksa adresler null kalir, istek AYAKTA kalir.
        altCozulemedi.value = true
    }

    const talimatlar = decodeInstructions(parsed, { lookups: lookups || undefined })
    for (const ix of talimatlar) {
        // Cozulemeyen talimatta bir ozet UYDURMAK yerine dogrulanabilir bir
        // hash gosterilir. SADECE GOSTERIM icindir; imzada kullanilmaz.
        if (ix.type === null) {
            ix.hash = toHex(await sha256(Uint8Array.from(ix.dataHex.match(/../g)?.map((h) => parseInt(h, 16)) || [])))
        }
    }

    // §5.2'nin ucuncu maliyet kalemi: OLUSTURULAN hesaplarin kirasi. ATA
    // kirasi zincirden gelir ve TEK SEFER sorulup onbellege alinir (her kart
    // icin yeniden sormak, uc islemlik bir toplu imzada uc gereksiz RPC
    // demekti). ALT ile AYNI fail-open disiplini: bir RPC hatasi mesru islemi
    // REDDETMEZ, yalnizca kalemi "okunamadi" birakir.
    try {
        let kira = 0
        for (const ix of talimatlar) {
            if (ix.program === 'system' && ix.type === 'CreateAccount') {
                kira += Number(u64Oku(ix.dataHex, 4))
            }
            if (ix.program === 'ata' && (ix.type === 'Create' || ix.type === 'CreateIdempotent')) {
                if (ataKirasi.value === null) {
                    ataKirasi.value = Number(await solanaRpc('getMinimumBalanceForRentExemption', [ATA_HESAP_BOYUTU]))
                }
                // Bicimsiz bir yanit (dizge/null/NaN) SESSIZCE 0 kira olarak
                // gosterilmemeli; kalem acikca "okunamadi" olur.
                if (!Number.isFinite(ataKirasi.value)) throw new Error('RENT_UNAVAILABLE')
                kira += ataKirasi.value
            }
        }
        kiraLamports.value += kira
    } catch (e) {
        kiraCozulemedi.value = true
    }

    return {
        index,
        talimatlar,
        isDurableNonce: parsed.isDurableNonce,
        imzaciSayisi: parsed.requiredSigners.length,
    }
}

onMounted(async () => {
    const { current_request, active_account, vaults } = await chrome.storage.local.get(['current_request', 'active_account', 'vaults'])
    if (!current_request || current_request.type !== 'SOLANA_SIGN_TX') return

    requestData.value = current_request

    // ONAYLANAN HESABA KILIT (TonSendTx.vue'deki AYNI desen): accountKey
    // oturum kurulurken sabitlendi. Aktif hesaba SESSIZCE dusmek, kullanici
    // bagliyken hesap degistirmisse YANLIS cuzdandan imzalatmaya calisirdi --
    // background'un §6.1 kilidi bunu sonradan yakalar, ama arayuzun GONDERDIGI
    // hesap zaten dogru olmali.
    const accounts = flattenVaultAccounts(vaults)
    account.value = accounts.find((a) => a.key === current_request.accountKey) || active_account || null

    // C1 fix (task-31 review): butun kart cozumleme + bakiye okuma isi bu
    // try/finally'e alinir. `finally` ile HER durumda (basarili ya da
    // beklenmedik bir istisna) `cozumlemeBitti` sonunda true olur -- aksi
    // halde bir istisna ekrani SONSUZA dek "yukleniyor" durumunda kilitlerdi.
    try {
        const liste = []
        for (let i = 0; i < current_request.transactions.length; i += 1) {
            // C3.1: kartKur'un cozumleme hatasi (parseDappTransaction firlatirsa)
            // digerlerinden AYRI yakalanir -- disaridaki try/finally bunu
            // yutup dongu KESILMEDEN devam etseydi ya da hic yakalamasaydi,
            // asagidaki `kartlar.value = liste` HIC calismaz, `finally`
            // yine de `cozumlemeBitti`yi true yapar ve ekran sifir kartla
            // "hazir" gorunurdu.
            try {
                liste.push(await kartKur(current_request.transactions[i], i))
            } catch (e) {
                cozumlemeHatasi.value = true
                hata.value = t(resolveSolanaSendError('TX_DESERIALIZE_FAILED'))
                break
            }
        }
        kartlar.value = liste

        // §5.2'nin dorduncu kalemi: SOL bakiyesi. Okunamazsa null KALIR ve
        // uyari hic gorunmez -- fail-open, ALT ile ayni gerekce.
        try {
            const bakiye = await solanaRpc('getBalance', [current_request.from])
            const lamports = Number(bakiye?.value)
            bakiyeLamports.value = Number.isFinite(lamports) ? lamports : null
        } catch (e) {
            bakiyeLamports.value = null
        }
    } finally {
        cozumlemeBitti.value = true
    }
})

const onayla = async () => {
    // Gorev 39 Minor 6: `gonderildi` basarili bir gonderimden sonra HIC
    // sifirlanmaz (bkz. tanimindaki not) -- `loading` gibi `finally`de geri
    // ACILMAZ, boylece ikinci bir onayla() cagrisi (ikinci tiklama ya da
    // programatik cagri) buradan ASLA gecemez.
    if (!requestData.value || loading.value || gonderildi.value) return
    loading.value = true
    hata.value = ''
    try {
        const res = await chrome.runtime.sendMessage({
            type: 'SOLANA_DAPP_SIGN_TX',
            // YENI -- UST DUZEYDE: arka planin signAndSend dali bunlari
            // `message.requestId` ve `message?.mode` olarak okuyor (Gorev 39,
            // signAndSendFromApproval'in icerik kilidi -- solanaDappFunctions.js:
            // `!message.requestId || current_request.requestId !== message.requestId`).
            // `.requestId` okunur, `.id` DEGIL --
            // asagidaki `message.message.requestId` (Task 30'un sign/signAll
            // kilidi) ile AYNI alan adi kullanilir; ikisi URETIMDE ayni
            // UUID'den geldigi icin bugun esit ama alan adi TESADUFEN degil
            // BILEREK eslenir.
            requestId: requestData.value.requestId,
            // `mode` ARKA PLANIN yayin dalini secer. Gonderilmezse yayin HIC
            // yapilmaz ve kullanicinin gordugu "yayinlanacak" rozeti yalan olur.
            // Arka plan bu degeri ayrica DISKTEKI kayitla karsilastirir.
            mode: requestData.value.mode,
            // M3 Gorev 31'de kurulan govde AYNEN KALIR -- sign/signAll yolu
            // hala BU alanlardan okuyor.
            message: {
                mode: requestData.value.mode,
                origin: requestData.value.origin,
                chain: requestData.value.chain,
                transactions: requestData.value.transactions,
                account: account.value,
                // §6.1'in birinci kilidi: bu alan eksik gonderilirse arka
                // plandaki karsilastirma sessizce devre disi kalir.
                from: requestData.value.from,
                // Obligation 4 (task-31): Task 30'un icerik baglama kilidi
                // `current_request.requestId` ile bu alani karsilastirir --
                // eksik gonderilirse HER onay SOLANA_DAPP_FROM_MISMATCH ile
                // kapali basarisiz olur.
                requestId: requestData.value.requestId,
            },
        })

        // signAndSend yaniti: `success` alani YOK, dogrudan `result` var.
        // Yanit OLDUGU GIBI iletilir (§3.3): `signature` legacy seridin,
        // `signatureBytes` Wallet Standard seridinin isine yarar; birini
        // burada yeniden kurmak seritlerden birini sessizce kirar. Belirsiz
        // yayinlarda (broadcastStatusUnknown) da AYNI dal kullanilir --
        // `res.result` zaten o alanlari tasir, ayrica IS UYDURULMAZ.
        if (res?.result) {
            await chrome.runtime.sendMessage({
                type: 'SEND_TX_SUCCESS',
                requestId: requestData.value.id,
                status: 'success',
                data: { result: res.result },
            })
            gonderildi.value = true
            page.currentPage = 'home'
        } else if (res?.success) {
            await chrome.runtime.sendMessage({
                type: 'SEND_TX_SUCCESS',
                requestId: requestData.value.id,
                status: 'success',
                data: { result: { signedTransactions: res.signedTransactions } },
            })
            gonderildi.value = true
            page.currentPage = 'home'
        } else {
            // Arka plan ham KOD doner; kullaniciya ASLA ham kod gosterilmez
            // (§3.6). Ceviri TEK yerden, sendErrors.js tablosundan.
            hata.value = t(resolveSolanaSendError(res?.error))
        }
    } catch (e) {
        // Obligation 3 (task-31, Gorev 23 fix turunun AYNI bulgusu): sendMessage'in
        // KENDISI reddedebilir (uzanti baglami gecersiz kilindi, service worker
        // kapandi) -- bu, `res.success === false` dalindan FARKLI bir hattir ve
        // yakalanmazsa dugme Gorev 14'un kilit-yok-geri-bildirim-yok defektini
        // BASKA bir sekilde yeniden uretir. Ham istisna mesaji ASLA ekrana
        // yazilmaz (§3.6); resolveSolanaSendError(null) TABLO'nun jenerik
        // anahtarina duser. Basarisizlikta eve GECILMEZ.
        console.error('[solana-dapp] SOLANA_DAPP_SIGN_TX gonderilemedi:', e?.message)
        hata.value = t(resolveSolanaSendError(null))
    } finally {
        loading.value = false
    }
}

const reddet = async () => {
    if (!requestData.value) return
    try {
        // EVM ekranlarinin (Sign.vue) deseni: red bir HATADIR ve `status: 'error'`
        // ile gonderilir -- TON'un "red de bir yanittir" deseni Wallet Standard'da
        // GECERSIZDIR, orada hata FIRLATILIR ve dapp'in promise'i reject olur.
        await chrome.runtime.sendMessage({
            type: 'SEND_TX_REJECTED',
            requestId: requestData.value.id,
            status: 'error',
            error: { code: 4001, message: 'User rejected the request.' },
        })
        page.currentPage = 'home'
    } catch (e) {
        // Obligation 3 (task-31): onayla()'daki AYNI gerekce -- sendMessage
        // kendisi reddederse kullanici "reddettim" sanip ekrandan ayrilir ama
        // arka plan HABERSIZ kalir. page.currentPage BURADA 'home'a GECMEZ,
        // kullanici hatayi gorup TEKRAR deneyebilsin diye ayni ekranda kalir.
        console.error('[solana-dapp] SEND_TX_REJECTED gonderilemedi:', e?.message)
        hata.value = t(resolveSolanaSendError(null))
    }
}
</script>

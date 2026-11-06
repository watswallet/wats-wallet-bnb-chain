<template>
    <!-- embedded: ana ekranin "Gizli islemler" sekmesinde basliksiz ve kendi kaydirmasi
         olmadan cizilir (Home kaydirir). Tek basina sayfa olarak cizim korunur. -->
    <div :class="embedded
        ? 'flex-1 flex flex-col text-slate-900 dark:text-white'
        : 'w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden transition-colors duration-300'">
        <div v-if="!embedded" class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10">
            <Back page="home" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight">{{ $t('privacy.orders.title') }}</h1>
        </div>

        <div class="flex flex-col gap-3 relative z-10" :class="embedded ? 'px-4 pt-4 pb-6' : 'flex-1 overflow-y-auto custom-scrollbar px-6 pt-5 pb-6'">
            <p v-if="notice" class="w-full rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">{{ notice }}</p>
            <!-- Iadenin ag ucreti ATS ile odenir (native coin YOK): ATS yetmediyse ne kadar gerektigi soylenir, siparis iade edilebilir
                 KALIR. ATS Al dugmesi yalniz ucreti Gizli Hesap oduyorsa sunulur (Para yukle iadesini normal hesap oder; bu ekran gizli
                 modda oldugu icin orada alinacak ATS Gizli Hesap'a girerdi). Satis yolu kapaliysa bilesen kendi aciklamasini yazar. -->
            <div v-if="refundAtsShort" data-testid="refund-ats-short" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-3 flex flex-col gap-1.5">
                <p class="text-xs font-bold text-red-600 dark:text-red-400">{{ refundAtsShortText }}</p>
                <AtsBuyButton v-if="refundAtsShort.payerPrivate" />
            </div>
            <p v-if="loading && !loaded" class="text-sm text-slate-500 dark:text-zinc-400 text-center pt-8">{{ $t('privacy.orders.loading') }}</p>
            <p v-else-if="loaded && !error && !orders.length" class="text-sm text-slate-500 dark:text-zinc-400 text-center pt-8">{{ $t('privacy.orders.empty') }}</p>
            <article v-for="o in orders" :key="o.ticket" class="w-full rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#131315] p-4 flex flex-col gap-1.5">
                <!-- Islem turu (arka plan satira `kind` koyar: send / fund / swap / bridge): tur biliniyorsa ust satir turu yazar, tutar ve teslim agi
                     ikinci satira, "ne nereye gitti" ucuncu satira iner. Tur yoksa (eski kayit, okunamayan veri) kart ESKI haliyle cizilir: tutar ust satirda, ag rozeti,
                     adres + tarih. Renk yalniz anlam icin (durum simgesi/metni); gradyan, golge ve parlama yok. -->
                <div class="flex justify-between gap-3 text-sm">
                    <span v-if="kindKey(o)" data-testid="order-kind" class="font-bold min-w-0 truncate" :title="$t(kindKey(o))">{{ $t(kindKey(o)) }}</span>
                    <span v-else class="font-bold min-w-0 truncate" :title="amountTitle(o)">{{ amountLabel(o) }}</span>
                    <!-- Durum: simge + KISA etiket tek grupta, hic sarmaz ve kisalmaz (shrink-0, whitespace-nowrap): simge her zaman metnin hemen yaninda.
                         Uzun "Yatirma gonderildi, onay bekleniyor" cumlesi kartin altinda soluk ipucu satirina indi (hintKey). Simge susludur
                         (aria-hidden): erisilebilir etiket metindir. Renk metinle ayni (currentColor); donen halka yalniz hareket tercihi
                         serbestse doner (motion-safe), onay isareti bir kez cizilerek gelir (CSS, ayni kosul). -->
                    <span data-testid="order-status" class="inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
                        <svg :key="phaseIcon(o.phase).name" :data-phase-icon="phaseIcon(o.phase).name" class="w-3.5 h-3.5 shrink-0" :class="[phaseClass(o.phase), phaseIcon(o.phase).spin ? 'motion-safe:animate-spin' : '', phaseIcon(o.phase).draw ? 'po-draw' : '']" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <circle v-if="phaseIcon(o.phase).ring" cx="12" cy="12" r="9" :stroke-opacity="phaseIcon(o.phase).ring" />
                            <path v-for="d in phaseIcon(o.phase).paths" :key="d" :d="d" />
                        </svg>
                        <span class="text-xs font-medium" :class="phaseClass(o.phase)">{{ phaseShortLabel(o.phase) }}</span>
                    </span>
                </div>
                <!-- Teslim agi rozeti (spec 4.8): satirin deliveryChainId'si tablodaki bir aga denkse yerel logo + ad; yoksa rozet CIZILMEZ.
                     Tur biliniyorsa ikinci satir TEK SATIRDIR ve hic sarmaz: teslim tokeninin yerel logosu (ag rozetiyle) + tutar + ag adi. Tutar
                     kisalmaz onceligi tasir (once ag adi kisalir; sigmazsa tutar kesilir, tam deger title'da). Logo cozulemezse cipteki gibi yedek simge. -->
                <div v-if="kindKey(o)" class="flex items-center gap-2 min-w-0 whitespace-nowrap">
                    <PrivateTokenLogo v-if="assetOf(o)" small data-testid="order-token-logo" :logo="tokenLogoOf(o)" :badge="chainBadgeOf(o)" />
                    <span data-testid="order-amount" class="text-sm font-semibold tabular-nums truncate min-w-0" :title="amountTitle(o) ?? amountLabel(o)">{{ amountLabel(o) }}</span>
                    <span v-if="deliveryChain(o)" class="flex items-baseline gap-1 min-w-0 shrink-[4] text-[11px] text-slate-500 dark:text-zinc-400">
                        <span class="shrink-0" aria-hidden="true">&middot;</span>
                        <span data-testid="delivery-badge" class="truncate">{{ deliveryChain(o).name }}</span>
                    </span>
                </div>
                <span v-else-if="deliveryChain(o)" data-testid="delivery-badge" class="inline-flex items-center gap-1.5 self-start text-[11px] text-slate-500 dark:text-zinc-400"><img :src="deliveryChain(o).logo" alt="" decoding="async" @error="onLogoError" class="w-3.5 h-3.5 rounded-full shrink-0" />{{ deliveryChain(o).name }}</span>
                <div v-if="kindKey(o)" class="flex justify-between gap-3 text-[11px] text-slate-500 dark:text-zinc-500">
                    <span data-testid="order-detail" class="min-w-0 break-words">{{ detailText(o) }}</span>
                    <span class="shrink-0 whitespace-nowrap">{{ dateLabel(o.createdAt) }}</span>
                </div>
                <div v-else class="flex justify-between gap-3 text-[11px] text-slate-500 dark:text-zinc-500">
                    <span>{{ o.outputAddress ? shortenAddress(o.outputAddress) : '' }}</span>
                    <span>{{ dateLabel(o.createdAt) }}</span>
                </div>
                <p v-if="hintKey(o)" class="text-[11px] text-slate-500 dark:text-zinc-400">{{ $t(hintKey(o)) }}</p>
                <!-- Iade dugmesi grafit murekkebi, Home'daki Gonder ile ayni (kullanici karari 2026-10-26): amber zemin beyaz yaziyla
                     2.15:1'di (AA'nin altinda) ve gri ekrandaki tek renkli dolu dugmeydi. Murekkep ekranin en guclu dolgusu, dugme
                     gozden kacmaz; kirmizi renk "Sorunlu" faz etiketinde kalir. -->
                <button v-if="o.refundable" @click="refund(o.ticket)" :disabled="busy" class="mt-1 self-end px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-950 dark:hover:bg-zinc-300 cursor-pointer disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:focus-visible:outline-zinc-200">{{ $t('privacy.orders.refund') }}</button>
            </article>
            <div v-if="error" class="flex flex-col gap-2 items-start">
                <p class="text-xs font-medium text-red-600 dark:text-red-400">{{ error }}</p>
                <button v-if="loadError" @click="retry" :disabled="loading" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white cursor-pointer disabled:opacity-60">{{ $t('privacy.orders.retry') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Back from '../Back.vue'
import { pageStore } from '../../store/pageStore'
import { shortenAddress } from '../../utils/shortenAddress'
import { trimAmount } from '../../utils/privacy/displayAmount'
import { deliveryChainOf } from '../../utils/privacy/deliveryChains'
import { chainName } from '../../utils/chainLogo'
import { privateTokenLogo, privateChainBadge } from '../../utils/privacy/privateTokenLogo'
import { privacyErrorKey } from '../../utils/privacy/privacyErrors'
import AtsBuyButton from '../AtsBuyButton.vue'
import PrivateTokenLogo from './PrivateTokenLogo.vue'

// Gizli islemlerim (spec 4.2 akis 5). Yalniz gizli modda acilir; kayitlar cihazda.
// Arka plan ile yalniz mesajla konusur; eksik alan "yok" sayilir, basarisiz cevap hata olur.
const { t, te, locale } = useI18n()
defineProps({ embedded: { type: Boolean, default: false } })
const page = pageStore()
const orders = ref([])
const busy = ref(false)
// loading: istek ucusta. loaded: ilk cevap (basarili ya da hatali) geldi; ondan once bos metin YAZILMAZ.
const loading = ref(false)
const loaded = ref(false)
// Iki ayri hata: liste yuklenemedi (Tekrar dene sunar) ve iade reddedildi. Iade hatasi, ardindan gelen
// yukleme basarisiz olsa da gorunur kalir (ikisi de varsa iade hatasi onceliklidir).
// Omur kurali: liste hatasi sonraki BASARILI yuklemede ve Tekrar dene'de silinir. Iade hatasi ise
// SONRAKI IADE TIKLAMASINA kadar kalir; basarili yuklemeler (20 sn'lik tazeleme DAHIL, hatta reddedilen
// iadenin kendi yenilemesi) onu silmez: yoksa kullanici reddi okuyamadan kaybolurdu.
const loadError = ref('')
const refundError = ref('')
const error = computed(() => refundError.value || loadError.value)
// Iade ATS yetersizligi (arka plan PRIVATE_INSUFFICIENT_ATS + atsNeeded/atsBalance/payerPrivate doner): { needed, balance, payerPrivate }.
// Iade hatasi gibi SONRAKI IADE TIKLAMASINA kadar kalir.
const refundAtsShort = ref(null)
// Gereken yukari, bakiye asagi yuvarlanir (kullanici eksik kalmasin); okunamayan deger tire.
const atsText = (n, round) => (typeof n === 'number' && Number.isFinite(n) ? (round(n * 100) / 100).toFixed(2) : '\u2014')
const refundAtsShortText = computed(() => {
    const s = refundAtsShort.value
    if (!s) return ''
    return t(s.payerPrivate ? 'privacy.orders.refundAtsShort' : 'privacy.orders.refundAtsShortNormal', {
        needed: atsText(s.needed, Math.ceil), balance: atsText(s.balance, Math.floor),
    })
})
// Bir kerelik not, iki kaynaktan: (1) aktarma ekraninin biraktigi (belirsiz sonuc ya da zaten gonderilmis; onMounted'ta
// depodan okunur ve silinir), (2) bu ekranda iade tiklamasinin belirsiz sonucu (refund(): iade gonderilmis OLABILIR).
const notice = ref('')

// Acik liste periyodik tazelenir (arka plan yoklamasi depoyu zaten dakikalik gunceller).
const REFRESH_MS = 20000
// Duz degisken (ref degil): yalniz onUnmounted'ta okunur.
let refreshTimer = null
// Son istek kazanir: iade sonrasi yukleme ile periyodik yukleme ust uste binerse eski cevap yeniyi ezmez.
let loadSeq = 0

const PHASE_CLASS = {
    pending: 'text-slate-500 dark:text-zinc-400',
    processing: 'text-indigo-600 dark:text-indigo-400',
    done: 'text-emerald-600 dark:text-emerald-400',
    problem: 'text-red-600 dark:text-red-400',
    refunded: 'text-amber-600 dark:text-amber-400',
}
const phaseClass = (phase) => PHASE_CLASS[phase] || PHASE_CLASS.pending
// Faz -> durum simgesi (24x24, cizgi, currentColor). ring: halka opakligi (yoksa halka yok), spin: motion-safe ile doner,
// draw: bir kez cizilerek gelir (CSS .po-draw). Bilinmeyen faz phaseClass gibi 'pending' (donen halka) gorunumune duser.
const SPINNER = { name: 'spinner', ring: 0.25, spin: true, paths: ['M21 12a9 9 0 0 0-9-9'] }
const PHASE_ICON = {
    pending: SPINNER,
    processing: SPINNER,
    done: { name: 'check', draw: true, paths: ['M5 13l4 4L19 7'] },
    problem: { name: 'alert', ring: 1, paths: ['M12 8v5', 'M12 16h.01'] },
    refunded: { name: 'undo', paths: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] },
}
const phaseIcon = (phase) => (Object.hasOwn(PHASE_ICON, phase) ? PHASE_ICON[phase] : PHASE_ICON.pending)
// Durum etiketi KISADIR (satir hic sarmaz). Bilinmeyen faz anahtar yolu olarak degil, oldugu gibi yazilir (uydurma etiketten tanimsiz etiket iyidir).
// Uzun "Yatirma gonderildi, onay bekleniyor" cumlesi (privacy.orders.hintPending) kartin altinda soluk ipucu satiridir (hintKey), bilgi kaybolmaz.
const phaseShortLabel = (phase) => (te(`privacy.orders.phaseShort.${phase}`) ? t(`privacy.orders.phaseShort.${phase}`) : String(phase ?? ''))

// Satir ipucu: iadesi acik olmayan 'problem' siparis ne yapilacagini soylemeden birakilmaz; ipucu NEDENE gore
// secilir, hicbir zaman gerceklesmeyecek bir vaat yazilmaz:
//  - refundStatusUnknown (arka plan soyler): iade gonderildi, makbuzu yok VE 24 saatlik sorgu ufku asildi; durum artik
//    arkada izlenmiyor, ipucu destege yonlendirir (sonsuza dek "bekleniyor" yazilmaz).
//  - refundPending (arka plan soyler): iade aga iletildi (belirsiz yayin dahil: gonderildigi KESIN degil), makbuzu yok;
//    faz 'Iade edildi' dese de "aginin onayi bekleniyor".
//  - refundFailed + iade yeniden acik: son iade zincirde basarisiz oldu, Iade dugmesi nedeniyle birlikte gelir.
//  - depositFailed: yatirma zincirde dustu, hesaptan para cikmadi.
//  - pending: yatirma gonderildi, onay bekleniyor (durum etiketi kisa tutulur; uzun cumle burada).
//  - refundOpensLater (arka plan soyler): iade siparisin suresi dolunca ACILACAK.
//  - diger her sey (ABORTED ve yatirma sorunu yok, kayitli durum yok, 72 saat ufkuyla kapanmis): iade
//    acilmayacak; tarafsiz ipucu "tamamlanamadi, sonra tekrar bak ya da destege yaz" der.
function hintKey(o) {
    if (o.refundStatusUnknown === true) return 'privacy.orders.hintRefundUnknown'
    if (o.refundPending === true) return 'privacy.orders.hintRefundPending'
    if (o.refundFailed === true && o.refundable) return 'privacy.orders.hintRefundFailed'
    if (o.depositFailed === true) return 'privacy.orders.hintNotSent'
    // Bekleyen yatirma: durum etiketi kisa ("Onaylaniyor"), ne beklendigini bu satir soyler.
    if (o.phase === 'pending') return 'privacy.orders.hintPending'
    if (o.phase !== 'problem' || o.refundable) return null
    return o.refundOpensLater === true ? 'privacy.orders.hintProblem' : 'privacy.orders.hintUnfinished'
}

// Satir teslim varligina gore yazilir (arka plan projeksiyonu deliveryChainId / outputAsset / expectedAmount / estimated tasir).
// Tahmini teslim (surum 2 kayitlar ve dest'li eski kayitlar: beklenen tutar) "~" ile ve 6 ondalikla kisaltilir, tam deger
// title'da kalir. Eski dest'siz USDC kaydi kesin tutardir. "Tahmin" karari YALNIZ projeksiyonun estimated bayragindan gelir
// (sembole bakan BNB denetimi kalkti: yerel coin sembolu her agda farklidir).
const isEstimate = (o) => o.estimated === true
// Varlik projeksiyonun sembolu (secilen token: USDC, BNB, CAKE...). Eski dest'siz kayit projeksiyonda acik 'USDC'
// tasir; teslimi okunamayan satirda (bozuk surum-2, bilinmeyen surum, asset/decimals eksik) varlik null'dir ve
// USDC/BNB yedegi YOKTUR (K4/D5): notr tire cizilir, payoutUsdc o dalda kullanilmaz.
const UNKNOWN_LABEL = '—'
const assetOf = (o) => (typeof o.outputAsset === 'string' && o.outputAsset ? o.outputAsset : null)
function amountLabel(o) {
    const asset = assetOf(o)
    if (asset === null) return UNKNOWN_LABEL
    if (isEstimate(o)) return o.expectedAmount ? `~${trimAmount(o.expectedAmount).text} ${asset}` : asset
    const amount = o.expectedAmount ?? o.payoutUsdc
    return amount ? `${amount} ${asset}` : asset
}
const amountTitle = (o) => (isEstimate(o) && o.expectedAmount && assetOf(o) ? `${o.expectedAmount} ${assetOf(o)}` : undefined)
const deliveryChain = (o) => deliveryChainOf(o?.deliveryChainId)
// Teslim tokeninin yerel logosu (sembol + ag; kayit adres tasimaz) ve ag rozeti: ikisi de TEK cozucudan (privateTokenLogo), ag okunamiyorsa rozet yok.
const tokenLogoOf = (o) => privateTokenLogo({ chainId: o?.deliveryChainId, symbol: assetOf(o) })
const chainBadgeOf = (o) => privateChainBadge(o?.deliveryChainId)

// Islem turu (arka plan satira `kind` koyar, orderKind.js): tur -> baslik anahtari tek tabloda. Bilinmeyen ya da yok -> null: kart eski haliyle cizilir.
const KIND_KEY = {
    send: 'privacy.orders.kind.send',
    fund: 'privacy.orders.kind.fund',
    swap: 'privacy.orders.kind.swap',
    bridge: 'privacy.orders.kind.bridge',
}
const kindKey = (o) => (typeof o?.kind === 'string' && Object.hasOwn(KIND_KEY, o.kind) ? KIND_KEY[o.kind] : null)
const textOrNull = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
// Ucuncu satirin sol metni: ne nereye gitti. Ad yalniz arka planin verdigi KENDI hesabi adidir (yabanci adrese ad uydurulmaz: yalniz
// kisaltilmis adres). Eksik veri bos metin verir (satir bos kalir, tarih yerinde); hicbir yerde varsayim yazilmaz.
//  send: Alici: <ad> . <adres> | Alici: <adres>     fund: Kaynak: <ad> (ad yoksa kisaltilmis adres)
//  swap: <kaynak varlik> -> <teslim varligi>        bridge: [<kaynak varlik> . ]<kaynak ag> -> <teslim agi> (varlik oneki satira sigarsa)
const ROUTE_ASSET_MAX_CHARS = 32
function detailText(o) {
    const kind = o?.kind
    const counterpart = textOrNull(o.counterpartAddress)
    const name = textOrNull(o.counterpartName)
    if (kind === 'send') {
        // Gonder'de karsi taraf teslim adresidir (arka plan ayni degeri counterpartAddress'e de koyar).
        const address = counterpart ?? textOrNull(o.outputAddress)
        if (!address) return ''
        return name
            ? t('privacy.orders.detail.sendToNamed', { name, address: shortenAddress(address) })
            : t('privacy.orders.detail.sendTo', { address: shortenAddress(address) })
    }
    if (kind === 'fund') {
        // Para yukle'de teslim adresi Gizli Hesap'in kendisidir: karsi taraf YALNIZ kaynak hesaptir (outputAddress'e dusulmez).
        const from = name ?? (counterpart ? shortenAddress(counterpart) : null)
        return from ? t('privacy.orders.detail.fundFrom', { name: from }) : ''
    }
    const sourceAsset = textOrNull(o.sourceAsset)
    if (kind === 'swap') {
        const to = assetOf(o)
        return sourceAsset && to ? t('privacy.orders.detail.route', { from: sourceAsset, to }) : ''
    }
    if (kind === 'bridge') {
        const fromChain = deliveryChainOf(o.sourceChainId)?.name || chainName(o.sourceChainId)
        const toChain = deliveryChain(o)?.name
        if (!fromChain || !toChain) return ''
        const route = (from) => t('privacy.orders.detail.route', { from, to: toChain })
        // Kaynak varlik yalniz satira SIGARSA eklenir (tarih ayni satirin sagindadir; uzun ag adi cifti iki satira tasardi): sigmazsa yalniz ag rotasi.
        const withAsset = sourceAsset ? route(`${sourceAsset} · ${fromChain}`) : null
        return withAsset !== null && withAsset.length <= ROUTE_ASSET_MAX_CHARS ? withAsset : route(fromChain)
    }
    return ''
}
// Yerel logo yuklenemezse varsayilan simge (onerror once temizlenir, dongu olmasin).
function onLogoError(e) {
    e.target.onerror = null
    e.target.src = '/default-token.png'
}

function dateLabel(createdAt) {
    const d = new Date(createdAt)
    if (createdAt == null || Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Hizmet calisani yeniden baslarken sendMessage firlatabilir: ham metin gosterilmez, genel hata gelir.
async function ask(message) {
    try {
        return await chrome.runtime.sendMessage(message)
    } catch {
        return null
    }
}

const failureText = (res) => t(privacyErrorKey(res?.error, 'privacy.errors.PRIVATE_FAILED'))

async function load() {
    const seq = ++loadSeq
    loading.value = true
    const res = await ask({ type: 'PRIVATE_ORDERS' })
    if (seq !== loadSeq) return
    // Basarisiz yenilemede son iyi liste KORUNUR; yalniz hata eklenir.
    if (res?.success) {
        orders.value = Array.isArray(res.orders) ? res.orders : []
        loadError.value = ''
    } else {
        loadError.value = failureText(res)
    }
    loaded.value = true
    loading.value = false
}

// Ilk yukleme hatasindan sonra: bos metin degil, yukleniyor gorunsun. Eski liste hatasi da silinir
// (yoksa 'Yukleniyor...' ile eski kirmizi hata birlikte gorunurdu); basarisiz olursa yenisi yazilir.
function retry() {
    loaded.value = false
    loadError.value = ''
    return load()
}

// Cevap yok (servis calisani yeniden basliyor, port kapandi) ya da arka planin belirsiz-yayin kodu: iade
// gonderilmis OLABILIR. Hata degil NOT gosterilir ve liste yeniden okunur; arka plan hash'i yayindan once
// kaydettigi icin satir artik "iade aga iletildi, aginin onayi bekleniyor" der ve Iade dugmesi gelmez (T25 U:I-1).
const REFUND_MAYBE_SENT_KEY = 'privacy.errors.PRIVATE_REFUND_UNCONFIRMED'
const refundMaybeSent = (res) => res == null || res.error === 'PRIVATE_REFUND_UNCONFIRMED'

async function refund(ticket) {
    if (busy.value) return
    busy.value = true
    refundError.value = ''
    refundAtsShort.value = null
    notice.value = ''
    try {
        const res = await ask({ type: 'PRIVATE_REFUND', message: { ticket } })
        if (refundMaybeSent(res)) notice.value = t(REFUND_MAYBE_SENT_KEY)
        else if (res?.error === 'PRIVATE_INSUFFICIENT_ATS') {
            refundAtsShort.value = { needed: res.atsNeeded ?? null, balance: res.atsBalance ?? null, payerPrivate: res.payerPrivate === true }
        } else if (!res?.success) refundError.value = failureText(res)
        await load()
    } finally {
        busy.value = false
    }
}

onMounted(() => {
    // Zamanlayici ILK await'ten once kurulur (onUnmounted await sirasinda calismis olabilir).
    if (typeof window !== 'undefined') refreshTimer = window.setInterval(() => { if (!busy.value) load() }, REFRESH_MS)
    if (page.ordersNotice) {
        notice.value = te(page.ordersNotice) ? t(page.ordersNotice) : ''
        page.ordersNotice = null
    }
    return load()
})

onUnmounted(() => {
    if (refreshTimer !== null) {
        window.clearInterval(refreshTimer)
        refreshTimer = null
    }
})
</script>

<style scoped>
/* Onay isareti bir kez cizilerek gelir; hareket tercihi "azalt" ise bu blok hic uygulanmaz ve isaret dogrudan tam gorunur.
   Yol uzunlugu ~19.8: dasharray 20 + uzun bosluk, baslangic ofseti 22 ile cizgi yolun disinda bekler (yuvarlak uc sizmaz). */
@media (prefers-reduced-motion: no-preference) {
    .po-draw path { stroke-dasharray: 20 30; animation: po-draw 320ms ease-out both; }
}
@keyframes po-draw {
    from { stroke-dashoffset: 22; }
    to { stroke-dashoffset: 0; }
}
</style>

<template>
    <!-- HISSE ALIM KAPISI BANDI -- Swap, Kopru ve StockTrade'de TEK bilesen (AtsFeeCard emsali: gorunum birlesir,
         metin birlesmez). SADECE AYNADIR: karar arka plandadir (STOCK_GATE_STATUS), burada hicbir sey karar verilmez
         ve depoya dokunulmaz; bant hicbir eylem dugmesi tasimaz ve baska ekrana gitmez. `idle` (cikti hisse degil)
         iken HICBIR sey cizilmez; bugunku ekran aynen kalir.

         Veri kancalari (testler): data-stock-gate, data-stock-gate-reason, data-stock-gate-reminder,
         data-stock-gate-freeze-note, data-stock-card-open.
         K43 (2026-11-14): UYGUN ihracci icin ulke uyumluluk uyarisi YOK. Ihracci ya uygun degildir (kilit bandi) ya da
         uygundur ve yalniz kisa urun hatirlatmasi gorur; `warn` durumu (eski ya da onbellekteki bir kural tablosunda
         uyari listesi dolu olsa bile) `ok` ile AYNI cizilir, ek uyari satiri cizilmez.
         `openable` (yalniz StockTrade Al sekmesi, K38): tamam / uyari durumunda hatirlatma satiri salt okunur kartin
         (StockCardSheet) kalici giris dugmesi olur; bant yine kendi basina hicbir sey yapmaz, yalniz `open-card` olayi
         verir (karar ve kart ust bilesendedir). `openable` false iken (Swap / Kopru) duz metindir.
         Bolum 2 (ihracci kumesi acik): kalici hatirlatma metni yalniz kartli ihraccilarda (bstocks, xstocks) vardir; baska
         ihraccida tamam / uyari durumunda bant cizilmez (ham ceviri anahtari gorunmez). Kilit / hata / kontrol bantlari her
         ihraccida cizilir; ihracci adi yer tutucusu adi olmayan ihracci icin bas harfi buyuk kimliktir. -->
    <div v-if="visible" class="shrink-0 rounded-xl border p-3 flex flex-col gap-2 transition-colors duration-300"
         :class="toneClass"
         :role="tone === 'block' ? 'alert' : 'status'"
         :data-stock-gate="gate.state"
         :data-stock-gate-reason="reasonAttr">

        <!-- Kontrol ediliyor: kapi cevap verene kadar miktar ve ana dugme kilitli (fail-safe). -->
        <div v-if="gate.state === 'checking'" class="flex items-center gap-2">
            <svg class="w-3.5 h-3.5 animate-spin text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
            <span class="text-[10px] font-medium text-slate-500 dark:text-zinc-500">{{ $t('stockGate.band.checking') }}</span>
        </div>

        <!-- TAMAM (ve `warn`, K43: ayni cizim): tek satir kalici hatirlatma (K5). Ulke uyari satiri YOK. -->
        <template v-else-if="gate.state === 'ok' || gate.state === 'warn'">
            <button v-if="openable" type="button" data-stock-card-open class="text-left cursor-pointer text-[10px] leading-relaxed text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 transition-colors" @click="emit('open-card', issuer)">
                <span data-stock-gate-reminder>{{ $t(`stockGate.reminder.${issuer}`) }}</span>
                <span class="ms-1 font-bold text-indigo-600 dark:text-indigo-400 underline">{{ $t('stockGate.card.open') }}</span>
            </button>
            <span v-else class="text-[10px] leading-relaxed text-slate-600 dark:text-zinc-400" data-stock-gate-reminder>{{ $t(`stockGate.reminder.${issuer}`) }}</span>
        </template>

        <!-- ENGELLI / HATA: kilit metni (ulke bilinmiyorsa AMBER "yeniden denenecek", digerleri rose). Eylem dugmesi YOK. -->
        <template v-else>
            <span class="text-[10px] leading-relaxed font-medium" :class="tone === 'amber' ? 'text-amber-800 dark:text-amber-300' : 'text-rose-800 dark:text-rose-300'">{{ lockText }}</span>
            <!-- K22: yalniz bStocks + ihraccinin KENDI listesi. xStocks icin ve ihtiyat-yalniz nedenlerde GOSTERILMEZ. -->
            <span v-if="showFreezeNote" class="text-[10px] leading-relaxed text-rose-700/90 dark:text-rose-300/90" data-stock-gate-freeze-note>{{ $t('stockGate.band.freezeNote.bstocks') }}</span>
        </template>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { countryLabel } from '../../utils/stockGate/countryLabel'
import { STOCK_GATE_REASONS } from '../../utils/stockGate/errors'
import { isValidIssuer } from '../../utils/stockGate/rules'

const props = defineProps({
    // reactive(useStockGate(...)) ciktisi: { state, reason, ipCountry }
    gate: { type: Object, required: true },
    // Uygunluk tablosundaki bir ihracci adi ('bstocks', 'xstocks', 'coinbase', ...) | null (hisse olmayan cikti)
    issuer: { type: String, default: null },
    // Hatirlatma satiri kartin giris dugmesi mi (yalniz StockTrade Al sekmesi). Varsayilan false: Swap / Kopru'da degisiklik yok.
    openable: { type: Boolean, default: false },
})
const emit = defineEmits(['open-card'])

const { t, locale } = useI18n()

const CODE_RE = /^[A-Z]{2}$/
const FREEZE_NOTE_REASONS = ['IP_COUNTRY_ISSUER']

// Kalici urun hatirlatmasi (stockGate.reminder.<id>) ve salt okunur kart yalniz bu ihraccilarda vardir (bkz. StockCardSheet).
const REMINDER_ISSUERS = ['bstocks', 'xstocks']
// stockGate.issuerName.<id> metni olan ihraccilar (uygunluk tablosundaki ihraccilar); listede olmayan bicimi gecerli ad icin
// ham ceviri anahtari degil bas harfi buyuk kimlik gosterilir. Dizi uyeligi: 'constructor' gibi miras adlar kapsam disi kalir.
const NAMED_ISSUERS = ['bstocks', 'xstocks', 'ondo', 'coinbase', 'robinhood', 'st0x']

// Bant yalniz bicimi gecerli bir ihracci VE idle olmayan bir durum varken cizilir; tamam / uyari durumu ayrica hatirlatma metni
// olan (kartli) ihracci ister.
const visible = computed(() => {
    if (!isValidIssuer(props.issuer) || props.gate.state === 'idle') return false
    if (props.gate.state === 'ok' || props.gate.state === 'warn') return REMINDER_ISSUERS.includes(props.issuer)
    return true
})

// Kilit nedeni kapali kumeden gelir; kume disi her sey CHECK_FAILED (ham kod ekrana cikmaz).
const blockedReason = computed(() => {
    if (props.gate.state === 'error') return 'CHECK_FAILED'
    return STOCK_GATE_REASONS.includes(props.gate.reason) ? props.gate.reason : 'CHECK_FAILED'
})

const reasonAttr = computed(() => (props.gate.state === 'blocked' || props.gate.state === 'error' ? blockedReason.value : undefined))

// neutral: kontrol / tamam. amber: ulke bilinmiyor (gecici, yeniden denenecek). block: diger her kilit ve hata.
const tone = computed(() => {
    if (props.gate.state === 'blocked' || props.gate.state === 'error') return blockedReason.value === 'COUNTRY_UNKNOWN' ? 'amber' : 'block'
    return 'neutral'
})
const toneClass = computed(() => ({
    block: 'border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10',
    amber: 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10',
    neutral: 'border-slate-200 dark:border-white/5 bg-slate-100 dark:bg-zinc-900/60',
}[tone.value]))

const showFreezeNote = computed(() => props.issuer === 'bstocks' && props.gate.state === 'blocked' && FREEZE_NOTE_REASONS.includes(blockedReason.value))

// Ulke adi dile gore; kod yoksa '?' (bos kalan bir yer tutucu "Baglantin  uzerinden" gibi bozuk cumle olurdu).
const label = (code) => (typeof code === 'string' && CODE_RE.test(code) ? countryLabel(code, locale.value) : '')
const issuerLabel = (issuer) => (NAMED_ISSUERS.includes(issuer) ? t(`stockGate.issuerName.${issuer}`) : issuer.charAt(0).toUpperCase() + issuer.slice(1))
const placeholders = computed(() => ({
    issuer: isValidIssuer(props.issuer) ? issuerLabel(props.issuer) : '',
    country: label(props.gate.ipCountry) || '?',
}))

const lockText = computed(() => t(`stockGate.lock.${blockedReason.value}`, placeholders.value))
</script>

<template>
    <!-- Ihracci secici (spec 5.3). Yalniz sunum: secim mantigi ve ref yazimi
         useIssuerSwitch'te (cuzdan agi DEGISMEZ, kullanici karari 2026-10-23); bu bilesen sadece `pick` olayini yayar. Tek secenekte DOM'da yok.
         N secenek (bStocks, xStocks, LCX ihraccilari): izgara 2 sutunda sarar, tek kalan son dugme tum satiri kaplar. -->
    <div v-if="options.length > 1" data-issuer-switch class="flex flex-col gap-1.5">
        <div
            role="group"
            :aria-label="$t('stockIssuer.switchLabel')"
            class="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-200/60 dark:bg-white/5"
        >
            <button
                v-for="o in options"
                :key="o.issuer"
                type="button"
                :data-issuer-option="o.issuer"
                :aria-pressed="selected === o.issuer ? 'true' : 'false'"
                :aria-disabled="o.available === false ? 'true' : undefined"
                class="py-2 px-1 rounded-xl text-sm font-bold transition-colors odd:last:col-span-2"
                :class="[
                    selected === o.issuer ? 'bg-white dark:bg-[#202022] text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-zinc-400',
                    o.available === false ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                ]"
                @click="o.available === false || $emit('pick', o.issuer)"
            >
                <span class="flex items-center justify-center gap-1.5"><IssuerLogo :issuer="o.issuer" size="w-5 h-5" />{{ issuerName(o.issuer) }}</span>
                <span v-if="o.available === false" data-issuer-option-sub data-issuer-unavailable class="block mt-0.5 text-[10px] leading-tight font-medium opacity-70 break-words">{{ $t('stockIssuer.notOnNetwork') }}</span>
                <template v-else-if="isLocked(o)">
                    <span data-issuer-option-sub data-issuer-closed class="block mt-0.5 text-[10px] leading-tight font-medium opacity-70 break-words">{{ $t(lock.kind === 'weekend' ? 'stockIssuer.closedWeekend' : 'stockIssuer.closedMarket') }}</span>
                </template>
                <span v-else data-issuer-option-sub class="block mt-0.5 text-[10px] leading-tight font-medium opacity-70 break-words">{{ issuerSub(o) }}</span>
            </button>
        </div>
        <button
            type="button"
            data-issuer-diff-link
            aria-haspopup="dialog"
            :aria-expanded="infoOpen ? 'true' : 'false'"
            aria-controls="issuer-info-sheet"
            class="self-start px-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 cursor-pointer"
            @click="infoOpen = true"
        >
            {{ $t('stockIssuer.diffLink') }}
            <svg data-issuer-diff-chevron class="w-3 h-3 transition-transform duration-200 ease-out motion-reduce:transition-none" :class="infoOpen ? 'rotate-180' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <Transition name="issuer-sheet">
            <IssuerInfoSheet v-if="infoOpen" :issuers="issuerIds" :networks="xNetworks" :lcx-networks="lcxNetworks" :selected="selected" @close="infoOpen = false" />
        </Transition>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ALL_CHAINS } from '../../data/chains'
import { isSameChainId } from '../../utils/vm'
import { companyRows } from '../../utils/stocks/stockCompanies'
import { isLcxIssuer, issuerDisplayName } from '../../utils/stocks/issuerNames'
import IssuerLogo from './IssuerLogo.vue'
import IssuerInfoSheet from './IssuerInfoSheet.vue'

const props = defineProps({
    // issuerOptions(...) ciktisi: [{ issuer: 'bstocks'|'xstocks'|<LCX ihraccisi>, row }]
    options: { type: Array, default: () => [] },
    // Secili ihracci ('bstocks' | 'xstocks' | LCX ihraccisi | null)
    selected: { type: String, default: null },
    // Piyasa kapaliyken yalniz ALIM kapali notu (dugme aktif kalir): { issuer, kind: 'weekend'|'market', nextChangeAt } | null (useIssuerSwitch.xLock)
    lock: { type: Object, default: null },
})
defineEmits(['pick'])

const { t } = useI18n()
const isLocked = (o) => Boolean(props.lock) && props.lock.issuer === o.issuer
const infoOpen = ref(false)

// Ihracci adi ve alt metni. Ihracci kimligi sunucudan gelir ve `constructor` gibi miras adlar da gecerli bicimdir; bu yuzden
// ceviri anahtari `stockIssuer.<id>` / `stockIssuer.sub.<id>` kimlikle KOSULSUZ kurulmaz (vue-i18n miras adi "bulur" ve cokebilir):
// ad icin utils/stocks/issuerNames.js (acik liste, dizi uyeligi; adi olmayan ihracci bas harfi buyuk kimlik), alt metin icin asagidaki
// acik liste. Alt metni olmayan LCX ihraccisi `stockIssuer.sub.lcx` kullanir. Logo / harf rozeti IssuerLogo'nun isi.
const SUB_ISSUERS = ['bstocks', 'xstocks']
const issuerName = (issuer) => issuerDisplayName(issuer, t)
const issuerSub = (o) => (SUB_ISSUERS.includes(o.issuer)
    ? t(`stockIssuer.sub.${o.issuer}`, { network: chainName(o.row.chainId) })
    : t('stockIssuer.sub.lcx'))

function chainName(chainId) {
    return ALL_CHAINS.find((c) => isSameChainId(c.chainId, chainId))?.name ?? ''
}

// Pencere sutunlari: bu sirketin seceneklerindeki ihraccilar (secenek sirasi).
const issuerIds = computed(() => props.options.map((o) => o.issuer))

// LCX ihraccisi -> bu sirketin o ihraccideki aglari (katalog satirlarindan; secenek oldugu icin LCX satirlari zaten acik). Prototipsiz
// nesne (ihracci adi anahtar; `constructor` gibi adlar miras uye olmaz): pencereye prop olarak gider ve `Object.hasOwn` ile okunur.
const lcxNetworks = computed(() => {
    const out = Object.create(null)
    for (const o of props.options) {
        if (!isLcxIssuer(o.issuer)) continue
        const names = companyRows(o.row.underlying, { xstocksEnabled: false, lcxEnabled: true })
            .filter((r) => r.issuer === o.issuer)
            .map((r) => chainName(r.chainId))
            .filter(Boolean)
        out[o.issuer] = [...new Set(names)].join(', ')
    }
    return out
})

// Pencerede "Hisseye gore degisir: ..." icin bu sirketin xStocks aglari (katalog satirlarindan).
const xNetworks = computed(() => {
    const x = props.options.find((o) => o.issuer === 'xstocks')
    const names = x
        ? companyRows(x.row.underlying, { xstocksEnabled: true }).filter((r) => r.issuer === 'xstocks').map((r) => chainName(r.chainId)).filter(Boolean)
        : []
    return names.length ? [...new Set(names)].join(', ') : t('stockIssuer.diff.networksFallback')
})
</script>

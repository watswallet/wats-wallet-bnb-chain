<template>
    <!-- Ihracci marka logosu. bStocks / xStocks: <img> (yuvarlak cerceve, acik zeminli: karanlik temada da okunur). Digerleri (LCX ihraccilari):
         marka logosu hakki alinmadi; ihracci adinin bas harfi yuvarlak rozette (<img> ve src yok). Erisilebilir ad ikisinde de ihracci adi. -->
    <img
        v-if="src"
        :data-issuer-logo="issuer"
        :src="src"
        :alt="name"
        class="shrink-0 rounded-full object-cover bg-white ring-1 ring-black/5 dark:ring-white/20"
        :class="size"
    />
    <span
        v-else
        role="img"
        :data-issuer-logo="issuer"
        :aria-label="name"
        class="shrink-0 inline-flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/20 text-[11px] leading-none font-extrabold text-slate-600 dark:text-zinc-300 select-none"
        :class="size"
    >{{ initial }}</span>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { issuerDisplayName, issuerInitial } from '../../utils/stocks/issuerNames'

const props = defineProps({
    issuer: { type: String, required: true },
    size: { type: String, default: 'w-7 h-7' },
})
// Marka logosu dosyalari. Harita Map: ihracci kimligi sunucudan gelir ve `constructor` gibi miras adlar gecerli bicimdir (nesne anahtariyla
// arama miras uyeyi dondururdu).
const LOGOS = new Map([['bstocks', '/images/issuers/bstocks.png'], ['xstocks', '/images/issuers/xstocks.svg']])

const { t } = useI18n()
const src = computed(() => LOGOS.get(props.issuer) ?? null)
const name = computed(() => issuerDisplayName(props.issuer, t))
const initial = computed(() => issuerInitial(name.value))
</script>

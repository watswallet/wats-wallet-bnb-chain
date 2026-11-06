<template>
    <img v-if="current" :src="current" :alt="altText" decoding="async" @error="onError" @load="onLoad">
    <svg v-else data-token-monogram viewBox="0 0 40 40" role="img" :aria-label="altText" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="20" r="20" class="fill-slate-200 dark:fill-zinc-700" />
        <text x="20" y="20.5" text-anchor="middle" dominant-baseline="central" font-size="19" font-weight="700" class="fill-slate-600 dark:fill-zinc-200">{{ letter }}</text>
    </svg>
</template>

<script setup>
// NORMAL MODDA TOKEN LOGOSU. Kaynaklar tokenLogoSources.js'ten (paketli > uzak gorsel > Trust Wallet) ya da `sources` ile acikca verilir; <img> hata
// verince SIRADAKI kaynaga gecer, hepsi tukenince tokenin NOTR MONOGRAMI cizilir (gri yer tutucu, kirik resim ve renkli palet YOK: grafit zemin,
// tek harf, gradyan/parlama yok). Boyut ve sekil cagirandan gelir (class aktarilir: `w-full h-full rounded-full object-cover` gibi); monogram SVG oldugu
// icin ayni kutuyu yazi boyutu ayari olmadan doldurur. Sablonda YORUM YOK: SSR yorumlari HTML cikisina basar ve test iddialarini yaniltir.
// Gizli modun cozucusu BU DEGILDIR (privacy/PrivateTokenLogo.vue).
import { ref, computed, watch } from 'vue'
import { tokenLogoSources } from '../utils/tokenLogoSources'
import { reportLogoLoaded, reportLogoExhausted, isLogoMissing } from '../utils/tokenLogoState'
import { markLetter } from '../utils/tokenMark'

const props = defineProps({
    token: { type: Object, default: null },
    // Token kaydi chainId tasimiyorsa (ice aktarilmis kayitlar) aktif ag.
    chainId: { type: [Number, String], default: undefined },
    symbol: { type: String, default: '' },
    // Verilirse cozucu atlanir (ATS logosu, hisse gorseli gibi onceden bilinen kaynaklar). Sira korunur.
    sources: { type: Array, default: null },
    alt: { type: String, default: '' },
})

const list = computed(() => {
    if (Array.isArray(props.sources)) return [...new Set(props.sources.filter((s) => typeof s === 'string' && s.trim() !== ''))]
    return tokenLogoSources(props.token, { chainId: props.chainId })
})

const index = ref(0)
// Ayni token baska bir listede ZATEN tum kaynaklariyla yuklenemediyse (oturum kaydi) olu adresleri tekrar denemeden dogrudan monogram cizilir.
const knownDead = computed(() => !Array.isArray(props.sources) && props.token !== null && isLogoMissing(props.token, { chainId: props.chainId }))
const current = computed(() => (knownDead.value ? null : list.value[index.value] ?? null))

// Kaynak listesi degisince (secim degisti) basa don.
watch(() => list.value.join('\n'), () => { index.value = 0 })

const symbolText = computed(() => props.symbol || props.token?.symbol || props.token?.ticker || props.token?.name || '')
const letter = computed(() => markLetter(symbolText.value))
const altText = computed(() => props.alt || props.token?.name || symbolText.value)

const isRemote = (src) => /^(https?:)?\/\//i.test(src)

function onError() {
    if (index.value + 1 < list.value.length) {
        index.value += 1
        return
    }
    const tried = list.value
    index.value = tried.length
    reportLogoExhausted(props.token ?? { symbol: symbolText.value }, { chainId: props.chainId, triedRemote: tried.some(isRemote) })
}

function onLoad() {
    reportLogoLoaded(current.value)
}
</script>

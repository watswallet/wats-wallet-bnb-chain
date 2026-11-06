<template>
    <!-- Ihracci marka logosu (bStocks / xStocks). Yalniz <img>; yuvarlak cerceve, acik zeminli (karanlik temada da okunur). -->
    <img
        :data-issuer-logo="issuer"
        :src="SRC[issuer]"
        :alt="$t('stockIssuer.' + issuer)"
        class="shrink-0 rounded-full object-cover bg-white ring-1 ring-black/5 dark:ring-white/20"
        :class="size"
    />
</template>

<script setup>
defineProps({
    issuer: { type: String, required: true },
    size: { type: String, default: 'w-7 h-7' },
})
const SRC = { bstocks: '/images/issuers/bstocks.png', xstocks: '/images/issuers/xstocks.svg' }
</script>

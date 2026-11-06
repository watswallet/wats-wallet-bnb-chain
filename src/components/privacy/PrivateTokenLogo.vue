<template>
    <span class="relative shrink-0">
        <img :src="logo" alt="" decoding="async" referrerpolicy="no-referrer" :class="small ? 'w-5 h-5 rounded-full border border-slate-200 dark:border-transparent' : 'w-6 h-6 rounded-full border border-slate-200 dark:border-transparent'" @error="onImgError" />
        <img v-if="badge" :src="badge" alt="" decoding="async" referrerpolicy="no-referrer" :class="small ? 'absolute -bottom-0.5 -right-1 w-3 h-3 rounded-full bg-white dark:bg-zinc-900 p-[1px] border border-slate-200 dark:border-white/10' : 'absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-white/10'" @error="onImgError" />
    </span>
</template>

<script setup>
// Token logosu + zincir rozeti (PrivateAssetChip ve teslim ozet satiri ortak kullanir). Boyut: varsayilan 24 px / 16 px rozet
// (Takas cipi), `small` 20 px / 12 px rozet (kompakt cip ve ozet satiri). Gorseller yalnizca yerel yollardir.
defineProps({
    logo: { type: String, required: true },
    badge: { type: String, default: null },
    small: { type: Boolean, default: false },
})

const DEFAULT_LOGO = '/default-token.png'

// Logo yuklenemezse yedek simge (onerror once temizlenir, dongu olmasin).
function onImgError(e) {
    e.target.onerror = null
    e.target.src = DEFAULT_LOGO
}
</script>

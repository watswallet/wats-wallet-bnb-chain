<template>
    <!-- CUZDANI OLMAYAN KULLANICININ PANELDE GORDUGU EKRAN.
         Onboarding AYRI BIR SEKMEDE aciliyor; panel bos beyaz kalmasin diye bir
         sey gostermek gerekiyor, ama gosterilen sey KULLANICIYA DOGRU OLANI
         soylemeli. -->
    <div class="flex flex-col items-center justify-center h-full px-6 text-center gap-5">
        <div class="w-12 h-12 rounded-xl bg-slate-100 dark:bg-zinc-800/80 flex items-center justify-center shrink-0 transition-colors duration-300">
            <svg class="w-6 h-6 text-slate-400 dark:text-zinc-500 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
        </div>

        <div class="flex flex-col gap-1.5">
            <h1 class="text-base font-bold text-slate-900 dark:text-zinc-100 transition-colors duration-300">
                {{ $t('onboardingPending.title') }}
            </h1>
            <p class="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed max-w-[240px] transition-colors duration-300">
                {{ $t('onboardingPending.body') }}
            </p>
        </div>

        <!-- Sekme kazara kapatilirsa kullanicinin panelde YAPABILECEGI bir sey
             olmali. Aksi halde ekran bir cikmaz olur: uzantiyi kapatip yeniden
             acmaktan baska yolu kalmaz. -->
        <button
            type="button"
            @click="kurulumuAc"
            class="px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 dark:bg-zinc-100 text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white transition-colors cursor-pointer"
        >
            {{ $t('onboardingPending.reopen') }}
        </button>
    </div>
</template>

<script setup>
/**
 * KOK NEDEN (2026-09-14): cuzdani OLMAYAN kullanici panelde `Login` ekranini
 * goruyordu -- "Tekrar hos geldin / Devam etmek icin sifreni gir". Var olmayan bir
 * sifre soruluyor, "Kilidi ac" hicbir sey yapmiyor ve "Sifremi unuttum" da bir
 * cuzdan YOKKEN anlamsiz. Sol tarafta acilan onboarding sekmesi "Yeni Cuzdan
 * Olustur" derken panel "sifreni gir" diyordu: iki yuzey birbiriyle CELISIYORDU.
 *
 * Sebep bir ISIM: `popup/App.vue` cuzdan yokken paneli `'welcome'` sayfasina
 * gonderiyor ve yorumu "karsilama ekranina duser" diyor -- ama `'welcome'`
 * `Login.vue`yi cizer. Isim, yazani yaniltmis.
 */
const kurulumuAc = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
}

defineExpose({ kurulumuAc })
</script>

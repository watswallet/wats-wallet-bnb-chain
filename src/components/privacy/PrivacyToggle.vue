<template>
    <button
        type="button"
        @click="toggle"
        :disabled="busy"
        :title="privacy.active ? $t('privacy.toggle.disable') : $t('privacy.toggle.enable')"
        :aria-label="$t('privacy.toggle.label')"
        :aria-pressed="privacy.active ? 'true' : 'false'"
        class="ghost-toggle w-8 h-8 shrink-0 flex items-center justify-center bg-transparent transition-colors duration-300 cursor-pointer disabled:opacity-60"
        :class="privacy.active
            ? 'ghost-toggle--on text-zinc-900 dark:text-zinc-100'
            : 'text-slate-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-300'"
    >
        <svg data-icon="ghost" class="ghost-toggle__icon w-5.5 h-5.5" viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M12 2.75a7.25 7.25 0 0 0-7.25 7.25v10.6c0 .5.57.78.96.47l1.62-1.27 1.9 1.5a.75.75 0 0 0 .93 0L12 19.8l1.84 1.5a.75.75 0 0 0 .93 0l1.9-1.5 1.62 1.27c.4.31.96.03.96-.47V10A7.25 7.25 0 0 0 12 2.75z"
                :fill="privacy.active ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
            <!-- Gozler dolu govdenin TERSI renkte: koyu temada govde acik oldugu icin sabit beyaz goz kaybolurdu. -->
            <ellipse cx="9.4" cy="10.4" rx="1.25" ry="1.6" :class="privacy.active ? 'fill-white dark:fill-zinc-950' : 'fill-current'" />
            <ellipse cx="14.6" cy="10.4" rx="1.25" ry="1.6" :class="privacy.active ? 'fill-white dark:fill-zinc-950' : 'fill-current'" />
        </svg>
    </button>
    <!-- Header backdrop-blur tasiyor: backdrop-filter fixed cocuklar icin kapsayici blok
         olusturur, panel header'in icinde kalirdi. Bu yuzden body'ye tasinir. -->
    <Teleport to="body">
        <Transition name="pi-sheet" :duration="{ enter: 380, leave: 240 }">
            <PrivacyIntro v-if="showIntro" @close="closeIntro" />
        </Transition>
    </Teleport>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { privacyStore } from '../../store/privacy'
import { pageStore } from '../../store/pageStore'
import { cryptoStore } from '../../store/crypto'
import { switchPrivacyMode } from '../../utils/privacy/privacySwitch'
import { clearSwapBridgeSelection } from '../../utils/swapBridgeSelection'
import PrivacyIntro from './PrivacyIntro.vue'

// Header hayalet dugmesi (spec 4.2). aria-label SABIT (dugmenin adi), durum yalniz
// aria-pressed ile bildirilir: ikisi de duruma gore degisirse ekran okuyucu
// durumu iki kez duyurur. title (gorsel ipucu) eylemi anlatmaya devam eder.
// Ilk giriste bilgi paneli ZORUNLU: kullanici gizli modun neyi GIZLEMEDIGINI gormeden Gizli Hesap olusturulmaz.
// Panel ayri bir sayfa degil; mevcut ekranin uzerinde alttan acilir.
// Hata gosterimi: kod tabaninda kullaniciya hata gosteren bir toast/bildirim
// yardimcisi YOK; diger ekranlar gibi alert() kullanilir.
const privacy = privacyStore()
const page = pageStore()
const { t } = useI18n()
const busy = ref(false)
const showIntro = ref(false)

function closeIntro() {
    showIntro.value = false
}

async function toggle() {
    if (busy.value) return
    if (!privacy.active && !privacy.introSeen) {
        showIntro.value = true
        return
    }
    busy.value = true
    try {
        const exiting = privacy.active
        const res = await switchPrivacyMode(!exiting, {
            privacy,
            onApplied: () => {
                page.currentPage = 'home'
                // P5 (spec 4.9): cikista giris oncesi ag geri yuklenir (uiSync.adoptNetwork agi alir ama
                // secimleri temizlemez); gizli oturumda secilen Takas / Kopru token'lari o agda yoktur.
                if (exiting) clearSwapBridgeSelection(cryptoStore())
            },
        })
        if (!res.ok) alert(t(res.errorKey))
    } finally {
        busy.value = false
    }
}
</script>

<style scoped>
/* Arka plan ve parlama yok (grafit karari, 2026-10-26): aktif durum dolu, murekkep renkli hayaletle belli olur. */
.ghost-toggle--on .ghost-toggle__icon {
    animation: ghost-toggle-float 2.6s ease-in-out infinite;
}
.ghost-toggle:not(.ghost-toggle--on):hover .ghost-toggle__icon {
    animation: ghost-toggle-float 1.4s ease-in-out infinite;
}
@keyframes ghost-toggle-float {
    0%, 100% { transform: translateY(0.5px); }
    50% { transform: translateY(-1.5px); }
}
@media (prefers-reduced-motion: reduce) {
    .ghost-toggle__icon { animation: none !important; }
}
</style>

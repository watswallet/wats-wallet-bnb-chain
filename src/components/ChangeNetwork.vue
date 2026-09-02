<template>
    <Teleport to="body">
        <Transition
            :enter-active-class="'transition-all duration-200 ease-out'"
            :leave-active-class="'transition-all duration-200 ease-in'"
            :enter-from-class="'opacity-0'"
            :enter-to-class="'opacity-100'"
            :leave-from-class="'opacity-100'"
            :leave-to-class="'opacity-0'"
        >
            <NetworksPopup v-if="popups.network_popup" :bridge="props.bridge" :flow="props.flow" :all-vms="props.allVms"></NetworksPopup>
        </Transition>
    </Teleport>

    <button
        class="flex min-w-0 items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:border-slate-300 dark:hover:border-zinc-600 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none"
        :title="network.currentNetwork?.name"
        @click="popups.network_popup = true"
    >
        <img :src="network.currentNetwork?.logoURI" :alt="network.currentNetwork?.name" width="15" class="shrink-0 rounded-full">

        <!-- AG ADI HER SAYFADA GORUNUR (kod incelemesi, Bulgu 6).
             Eskiden `v-if="!['home'].includes(page.currentPage)"` vardi: chip
             YALNIZCA Takas'in icinde yasarken bu zararsizdi, ama artik cuzdanin
             TEK global ag anahtari bu ve ana ekranda ADSIZ duruyordu -- kullanici
             hangi agda oldugunu, agi DEGISTIREN kontrolden okuyamiyordu.
             Daralan bir baslikta (EVM'de yaninda ATS hapi + dapp dugmesi var)
             ad KIRPILIR, GIZLENMEZ: `min-w-0 truncate` + tam adi veren `title`.
             Solana'da o iki dugme gizli oldugu icin ad tam sigar. -->
        <p class="min-w-0 max-w-20 truncate font-medium text-xs text-slate-700 dark:text-zinc-300 transition-colors duration-300">
            {{ network.currentNetwork?.name }}
        </p>

        <svg class="w-3 h-3 shrink-0 text-slate-400 dark:text-zinc-500 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
    </button>
</template>

<script setup>
import { networkStore } from '../store/network'
import { popupStore } from '../store/popup'
import NetworksPopup from './popups/networksPopup.vue'

// IKI AYRI DARALTMA, IKI AYRI PROP -- ve ikisi de gerekli (birlestirme notu):
//
// `flow`: bu degistirici hangi EKRANIN icinde duruyor. Takas/Kopru baglaminda
// hem listeyi hem gecisi o akista CALISAN aglara daraltir (chainsForFlow +
// applyNetworkChange'e tasinan `flow`); verilmezse akis kapisi hic kurulmaz.
//
// `allVms`: liste EVM DISI motorlari (Solana, TON) da tasisin mi. `flow`
// bunun YERINI TUTMAZ: akis kapisi "bu zincir bu ekranda calisir mi" sorusunu
// cevaplar, VM kapisi ise "bu chip cuzdanin GLOBAL anahtari mi" sorusunu.
// Varsayilan `false` -- prop'suz her cagiran (ve `flow` verip `allVms`
// vermeyen Swap) bugunku EVM-only davranisini TEK KARAKTER degismeden korur.
// Gerekce icin bkz. popups/networksPopup.vue.
const props = defineProps({
    bridge: { type: [Object, Boolean, String], default: undefined },
    flow: { type: String, default: null },
    allVms: { type: Boolean, default: false },
})

const network = networkStore()
const popups = popupStore()
</script>

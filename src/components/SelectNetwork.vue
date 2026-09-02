<template>
  <div v-if="loading" class="w-full h-screen absolute top-0 left-0 bg-black/70 flex items-center justify-center z-50">
    <svg class="w-5 text-zinc-100 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path fill="none" stroke="currentColor" stroke-dasharray="16" stroke-dashoffset="16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9">
        <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="16;0"/>
        <animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/>
      </path>
    </svg>
  </div>

  <section class="w-full min-h-150 flex flex-col gap-5 relative pb-[20%] p-3 bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white">
    <Back page="search_tokens"></Back>

    <div class="w-full flex items-center justify-between">
      <span></span>
      <h1 class="w-full text-center text-lg font-bold tracking-tight text-slate-900 dark:text-white">{{ $t('selectNetwork.title') }}</h1>
    </div>

    <div class="w-full absolute left-0 top-0 h-full overflow-y-auto mt-[15%]">
      <button v-for="chain in networks" :key="chain.chainId" class="w-full flex items-center justify-between py-3 font-bold text-sm hover:bg-slate-100 dark:hover:bg-white/5" @click="selectNetwork(chain)">
        <div class="flex items-center gap-3">
          <img :src="chain.logoURI" :alt="chain.name" class="w-6 h-6 rounded-full object-contain">
          <p>{{ chain.name }}</p>
        </div>

        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12L8.59 7.41L10 6l6 6l-6 6z"/></svg>
      </button>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import Back from './Back.vue'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { findFastestRPC } from '../utils/testRPC'
import { rpcUrlsOf } from '../utils/vm'
import { LISTED_CHAINS as networks } from '../data/chains'

const network = networkStore()

const loading = ref(false)

const selectNetwork = async(chain) => {
  try {
    loading.value = true
    await network.setCurrentNetwork(chain)
    // rpcUrlsOf(chain): Solana kaydinda rpc alani BILEREK yok, `chain.rpc.map(...)`
    // TypeError atardi ve try/catch onu yutup 'import_token'a hic gecmiyordu.
    const rpc = await findFastestRPC(rpcUrlsOf(chain))
    if (rpc?.url) network.setRpc(rpc.url, chain.chainId)

    pageStore().currentPage = 'import_token'

  } catch (error) {
    console.error('selectNetwork error', error.message)
  } finally {
    loading.value = false
  }
}
</script>
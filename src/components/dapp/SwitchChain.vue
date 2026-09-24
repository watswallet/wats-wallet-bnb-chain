<template>
    <ApprovalShell chain="evm" :title="$t('dapps.switchChain.title')" :origin="origin">
        <template #badge>
            <div class="flex items-center gap-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-slate-500/10 dark:bg-slate-500/20 rounded-2xl blur-lg group-hover:blur-xl transition-all"></div>
                    <div class="w-16 h-16 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center relative shadow-md dark:shadow-xl overflow-hidden transition-colors duration-300">
                        <img v-if="mevcutLogo" :src="mevcutLogo" :alt="mevcutAd" class="w-10 h-10 object-contain rounded-full">
                        <span v-else class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 px-1 text-center">{{ mevcutAd }}</span>
                    </div>
                </div>

                <div class="flex flex-col items-center gap-1">
                    <div class="w-12 h-px bg-linear-to-r from-transparent via-slate-300 dark:via-zinc-500 to-transparent transition-colors duration-300"></div>
                    <div class="p-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-400 dark:text-zinc-400 transition-colors duration-300">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </div>
                    <div class="w-12 h-px bg-linear-to-r from-transparent via-slate-300 dark:via-zinc-500 to-transparent transition-colors duration-300"></div>
                </div>

                <div class="relative group">
                    <div class="absolute inset-0 bg-emerald-500/10 dark:bg-emerald-500/20 rounded-2xl blur-lg group-hover:blur-xl transition-all"></div>
                    <div class="w-16 h-16 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center relative shadow-md dark:shadow-xl overflow-hidden transition-colors duration-300">
                        <img v-if="hedefLogo" :src="hedefLogo" :alt="hedefAd" class="w-10 h-10 object-contain rounded-full">
                        <span v-else class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 px-1 text-center">{{ hedefAd }}</span>
                    </div>
                </div>
            </div>
        </template>

        <!-- HESAP kapisi. `accountHasEvm` FAIL-CLOSED: EVM oldugu KANITLANAMAYAN
             hesapta gecis yapilmaz. Soluk/kilitli bir dugme birakilmiyor, dugme
             tumden kaldiriliyor -- ConnectDapp.vue ile ayni gorsel dil. -->
        <div v-if="hesapEngelli" class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 flex items-start gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
            <div class="mt-0.5 text-amber-600 dark:text-amber-400 shrink-0 transition-colors duration-300">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            </div>
            <p class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed transition-colors duration-300">{{ $t('dapps.switchChain.account_not_supported') }}</p>
        </div>

        <template v-else>
            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl p-4 flex flex-col gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider transition-colors duration-300">{{ $t('dapps.switchChain.summary_title') }}</p>

                <div class="flex items-center justify-between">
                    <span class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('dapps.switchChain.from_label') }}</span>
                    <span class="text-sm font-bold text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ mevcutAd }}</span>
                </div>

                <div class="flex items-center justify-between">
                    <span class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('dapps.switchChain.to_label') }}</span>
                    <span class="text-sm font-bold text-emerald-600 dark:text-emerald-500 transition-colors duration-300">{{ hedefAd }}</span>
                </div>
            </div>

            <div class="bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-4 flex items-start gap-3 transition-colors duration-300">
                <div class="mt-0.5 text-slate-400 dark:text-zinc-500 shrink-0 transition-colors duration-300">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <p class="text-xs text-slate-500 dark:text-zinc-500 leading-relaxed transition-colors duration-300">{{ $t('dapps.switchChain.note') }}</p>
            </div>
        </template>

        <template #footer>
            <button @click="cancel" :class="hesapEngelli ? 'w-full' : 'w-1/2'" class="py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer">
                {{ $t('dapps.switchChain.btn_reject') }}
            </button>
            <button v-if="!hesapEngelli" id="evm-switch-chain-approve" :disabled="calisiyor" @click="approve" class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-500 hover:scale-[1.02] transition-all shadow-lg shadow-emerald-600/20 dark:shadow-emerald-900/20 cursor-pointer disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-wait">
                {{ calisiyor ? $t('dapps.switchChain.btn_switching') : $t('dapps.switchChain.btn_switch') }}
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../store/pageStore'
import { ALL_CHAINS } from '../../data/chains'
import { accountHasEvm } from '../../utils/accountKind'
import { applyNetworkChange } from '../../utils/applyNetworkChange'
import { alreadyOnChain, findSwitchTarget } from '../../utils/switchChainRequest'
import { isSameChainId } from '../../utils/vm'
import ApprovalShell from './ApprovalShell.vue'

const page = pageStore()
// `t` GERCEKTEN GEREKLI: applyNetworkChange onu yalnizca alert dallarinda cagirir
// (akis kapisi, hesap kapisi, erisilemez RPC). Unutulsaydi mutlu yol ve butun
// standart testler YESIL kalir, hata yalnizca o uc durumda TypeError olarak
// cikardi -- yani en kotu anda.
const { t } = useI18n()

const origin = ref('')
const mevcutAd = ref('')
const mevcutLogo = ref('')
const hedefAd = ref('')
const hedefLogo = ref('')
const hesapEngelli = ref(false)
const calisiyor = ref(false)

const kayitBul = (chainId) => ALL_CHAINS.find((c) => isSameChainId(c.chainId, chainId)) || null

onMounted(async () => {
    const { active_account, current_request, currentNetwork } = await chrome.storage.local.get(['active_account', 'current_request', 'currentNetwork'])
    hesapEngelli.value = !accountHasEvm(active_account)

    mevcutAd.value = currentNetwork?.name || t('dapps.switchChain.unknown_chain')
    mevcutLogo.value = currentNetwork?.logoURI || ''

    if (current_request?.type === 'SWITCH_CHAIN') {
        try {
            origin.value = new URL(current_request.origin).hostname
        } catch {
            origin.value = current_request.origin || ''
        }
        const hedef = kayitBul(current_request.requestedChainId)
        hedefAd.value = hedef?.name || current_request.requestedChainName || t('dapps.switchChain.unknown_chain')
        hedefLogo.value = hedef?.logoURI || ''
    }
})

/**
 * Yaniti gonderip ekrani kapatan TEK cikis.
 *
 * `data: { result: null }` ZORUNLU -- `data`SIZ bir `status:'success'`
 * resolvePendingRequest'te (dappFunctions.js) `data.result` okunurken TypeError
 * uretir; cagri await'siz/catch'siz oldugu icin yakalanmayan bir promise reddi
 * olur, `sendResponse` HIC cagrilmaz, `current_request` diskten HIC silinmez ve
 * dapp'in await'i sonsuza asili kalir.
 *
 * `page.currentPage = 'home'` onay penceresini KAPATMAZ; pencereyi kapatan tek
 * yer resolvePendingRequest'in sonudur. Bu yuzden mesaj her dalda gonderilir.
 */
const yanitla = async (zarf) => {
    const { current_request } = await chrome.storage.local.get('current_request')
    await chrome.runtime.sendMessage({ ...zarf, requestId: current_request?.id })
    page.currentPage = 'home'
}

const approve = async () => {
    if (calisiyor.value) return
    calisiyor.value = true
    try {
        // TAZE OKUMA. Sablondaki v-if yalnizca ARAYUZ durumudur: bu ekran acikken
        // kullanici ana popup'tan hesabi ya da agi degistirmis olabilir
        // (ConnectDapp.vue'daki FIX 6 ile ayni gerekce).
        const { active_account, current_request, currentNetwork } = await chrome.storage.local.get(['active_account', 'current_request', 'currentNetwork'])

        if (!accountHasEvm(active_account)) {
            await yanitla({ type: 'CONNECT_WALLET_REJECTED', status: 'error', error: { code: 4100, message: 'The active account has no EVM address.' } })
            return
        }

        const hedef = findSwitchTarget(current_request?.requestedChainId)
        if (!hedef) {
            await yanitla({ type: 'CONNECT_WALLET_REJECTED', status: 'error', error: { code: 4902, message: 'This chain is not available in this wallet.' } })
            return
        }

        // Arada kullanici zaten o aga gecmis olabilir; ikinci kez gecmeye
        // calismak yerine EIP-3326'nin bekledigi yaniti ver.
        if (alreadyOnChain(currentNetwork, hedef.chainId)) {
            await yanitla({ type: 'CONNECT_WALLET_SUCCESS', status: 'success', data: { result: null } })
            return
        }

        // `flow` VERILMIYOR. `{ flow: 'dapp' }` verseydik chainSupportsFlow TON ve
        // Solana'yi reddedip `alert()` acardi -- ve alert SENKRONDUR, onay
        // penceresini kilitler (applyNetworkChange.js'te olculmus hasar). Hedefin
        // EVM oldugunu `findSwitchTarget` ZATEN kanitladi, yani kapiya ihtiyac yok.
        await applyNetworkChange(hedef, t)

        // DONUS DEGERI OKUNMAZ: applyNetworkChange "ag degisti mi" DEGIL "RPC
        // erisilebilir mi" doner. Desteklenmeyen bir zincirde setCurrentNetwork
        // sessizce reddeder ama fonksiyon yine `true` donebilir. Tek durust
        // kanit diskin kendisidir.
        const { currentNetwork: sonrasi } = await chrome.storage.local.get('currentNetwork')
        if (!alreadyOnChain(sonrasi, hedef.chainId)) {
            await yanitla({ type: 'CONNECT_WALLET_REJECTED', status: 'error', error: { code: 4901, message: 'The wallet could not switch to the requested chain.' } })
            return
        }

        // EIP-3326: basaride donus degeri `null`dir.
        await yanitla({ type: 'CONNECT_WALLET_SUCCESS', status: 'success', data: { result: null } })
    } finally {
        calisiyor.value = false
    }
}

const cancel = async () => {
    await yanitla({ type: 'CONNECT_WALLET_REJECTED', status: 'error', error: { code: 4001, message: 'User rejected the chain switch' } })
}
</script>

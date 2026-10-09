<template>
    <!-- B2: TonConnect ag/hesap uyusmazligi UYARISI (utils/tonAlert.js). Onay
         ekrani DEGIL: dapp kod 1'i coktan aldi. Tek kontrol Kapat; gonderim,
         ag ya da hesap degisikligi sunulmaz (wallet-guidelines.md). -->
    <ApprovalShell
        chain="ton"
        :title="$t('dapps.tonConnect.alert_title')"
        :origin="hostname"
        :claimed-name="appName"
    >
        <div
            v-if="bilinenTur"
            role="alert"
            class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-4 flex gap-3 transition-colors duration-300"
        >
            <svg class="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            <div class="flex flex-col gap-1.5 min-w-0">
                <p class="text-sm font-bold text-red-700 dark:text-red-300 transition-colors duration-300">{{ baslik }}</p>
                <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed break-words transition-colors duration-300">{{ neden }}</p>
                <p class="text-xs text-red-600 dark:text-red-400 leading-relaxed transition-colors duration-300">{{ $t('dapps.tonConnect.alert_blocked') }}</p>
            </div>
        </div>

        <template #footer>
            <button
                @click="kapat"
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all border border-slate-200 dark:border-white/5 cursor-pointer shadow-sm dark:shadow-none"
            >
                {{ $t('dapps.tonConnect.btn_close') }}
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Address } from '@ton/core'
import { pageStore } from '../../store/pageStore'
import { shortenAddress } from '../../utils/shortenAddress'
import { closeOrNavigate } from '../../utils/uiSurface'
import ApprovalShell from './ApprovalShell.vue'

// utils/tonAlert.js ile AYNI anahtar.
const ANAHTAR = 'ton_alert'

const { t } = useI18n()
const page = pageStore()

const kayit = ref(null)

const metinMi = (v) => typeof v === 'string'
const hostname = computed(() => (metinMi(kayit.value?.hostname) ? kayit.value.hostname : ''))
const appName = computed(() => (metinMi(kayit.value?.appName) ? kayit.value.appName : ''))
const bilinenTur = computed(() => kayit.value?.kind === 'network' || kayit.value?.kind === 'from')

// Ag kimligi ekrana yalniz BILINEN ad ya da sayi olarak cikar. Dapp'in serbest
// metni yansitilmaz: cuzdan penceresine oltalama metni sokulabilirdi.
function agAdi(id) {
    if (id === '-239') return t('dapps.tonConnect.alert_net_mainnet')
    if (id === '-3') return t('dapps.tonConnect.alert_net_testnet')
    if (metinMi(id) && /^-?\d{1,12}$/.test(id)) return t('dapps.tonConnect.alert_net_other', { id })
    return t('dapps.tonConnect.alert_value_invalid')
}

// Adres yalniz COZULEBILIYORSA, cuzdanin agina gore friendly ve kisaltilmis
// gosterilir. Address.parse ciplak bir DIZE de firlatabilir.
function adresMetni(deger, network) {
    if (!metinMi(deger)) return t('dapps.tonConnect.alert_value_invalid')
    try {
        const adres = Address.parse(deger.trim())
        return shortenAddress(adres.toString({ bounceable: false, testOnly: network === '-3' }), 8, 6)
    } catch {
        return t('dapps.tonConnect.alert_value_invalid')
    }
}

const baslik = computed(() => (kayit.value?.kind === 'from'
    ? t('dapps.tonConnect.alert_from_title')
    : t('dapps.tonConnect.alert_network_title')))

const neden = computed(() => {
    const k = kayit.value
    if (!bilinenTur.value) return ''
    if (k.kind === 'from') {
        return t('dapps.tonConnect.alert_from', {
            requested: adresMetni(k.requested, k.network),
            connected: adresMetni(k.expected, k.network),
        })
    }
    return t('dapps.tonConnect.alert_network', { requested: agAdi(k.requested), wallet: agAdi(k.expected) })
})

// En YENI uyari gosterilir: ilk okuma ile degisim olayi ters sirayla gelirse
// eski kayit yenisini ezmesin (ayni kaydin windowId guncellemesi esit zamanli).
function goster(k) {
    if (!k || typeof k !== 'object') return
    if (kayit.value && (kayit.value.createdAt ?? 0) > (k.createdAt ?? 0)) return
    kayit.value = k
}

// Arka plan acik pencereyi yeni uyariyla gunceller; kayit silinirse (pencere
// kapandi ya da baska bir Kapat) gosterecek bir sey kalmaz.
function degisim(changes, area) {
    if (area !== 'local' || !changes?.[ANAHTAR]) return
    const yeni = changes[ANAHTAR].newValue
    if (yeni) goster(yeni)
    else closeOrNavigate(null, { page })
}

const dinlemeyiBirak = () => chrome.storage?.onChanged?.removeListener?.(degisim)

onMounted(async () => {
    chrome.storage?.onChanged?.addListener?.(degisim)
    try {
        const { [ANAHTAR]: k } = await chrome.storage.local.get(ANAHTAR)
        goster(k)
    } catch (e) {
        console.warn('[tonconnect] uyari kaydi okunamadi:', e?.message)
    }
})

onUnmounted(dinlemeyiBirak)

// Kapat dapp'e HICBIR SEY gondermez; kaydi temizler ve pencereyi kapatir.
async function kapat() {
    dinlemeyiBirak()
    try {
        await chrome.storage.local.remove(ANAHTAR)
    } catch (e) {
        console.warn('[tonconnect] uyari kaydi silinemedi:', e?.message)
    }
    closeOrNavigate(null, { page })
}
</script>

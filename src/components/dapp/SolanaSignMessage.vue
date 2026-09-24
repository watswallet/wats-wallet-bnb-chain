<template>
    <!-- GERCEK origin (arka planin sender'dan cozdugu deger) EN BASKIN eleman
         (K5, kabuktaki buyuk h2). Wallet Standard'da TonConnect'in manifest'i
         gibi dogrulanabilir bir belge YOKTUR: sayfanin verdigi ad TAMAMEN
         saldirgan kontrolundedir -- bu yuzden appMetaAdi kabugun iddia
         pilinde, `claimedLabel` cevirisiyle (SolanaConnectApprove.vue'deki
         AYNI kalip) ikincil ve soluk gosterilir. -->
    <ApprovalShell
        chain="solana"
        :title="siwsModu ? $t('dapps.solana.signInTitle') : $t('dapps.solana.signMessageTitle')"
        :origin="origin"
        :claimed-name="appMetaAdi ? $t('dapps.solana.claimedLabel', { name: appMetaAdi }) : ''"
    >
        <!-- signIn: alanlar YAPILANDIRILMIS gosterilir; hangisini CUZDANIN
             zorladigi acikca yazilir. `domain` listenin ILK ogesi ve tek
             "cuzdan belirledi" rozetini tasiyan iki alandan biridir --
             `uri` ise sayfa tarafindan verilir ve HICBIR ozel vurgu
             TASIMAZ: sahte bir uri (orn. evil.com'un yazdigi
             https://phantom.app/login) burada domain'in yaninda soluk
             kalir, cunku okuyucunun guvenebilecegi tek deger zaten en
             tepede (h2) ve rozetli olarak ayri duruyor. -->
        <div v-if="siwsModu" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3.5 flex flex-col gap-2">
            <div v-for="alan in siwsAlanlari" :key="alan.key" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1.5">
                    <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.siws.' + alan.key) }}</span>
                    <span v-if="alan.zorlanan" class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold">{{ $t('dapps.solana.enforcedLabel') }}</span>
                </div>
                <span class="text-xs text-slate-700 dark:text-zinc-200 break-all select-text">{{ alan.value }}</span>
            </div>
        </div>

        <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3.5 flex flex-col gap-2">
            <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.messageLabel') }}</span>

            <!-- BURADA GORUNEN METIN HER ZAMAN `requestData.message`den
                 COZULUR (asagida script'te), signInInput'ten ASLA yeniden
                 KURULMAZ: signIn govdesini arka plan zaten kendi kurmus ve
                 imzalanacak KESIN baytlari kayda yazmistir -- ekranin
                 gorevi o baytlari GOSTERMEKTIR, baska bir metin UYDURMAK
                 degil. -->
            <p v-if="okunabilir" class="text-sm text-slate-800 dark:text-zinc-200 whitespace-pre-wrap break-all select-text">{{ gorunurMetin }}</p>
            <p v-if="okunabilir && gorunurMetin !== cozulenMetin" class="text-[11px] text-amber-700 dark:text-amber-300">{{ $t('dapps.solana.hiddenCharsNotice') }}</p>

            <!-- COZULEMEYEN baytlar: ham veriyi "metin" gibi sunmak ya da
                 bir ozet UYDURMAK, kullaniciya gormedigi bir seye onay
                 verdirmek olurdu (TonSignData.vue emsali). -->
            <div v-else-if="!okunabilir" class="flex flex-col gap-2.5">
                <p class="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">{{ $t('dapps.solana.unreadableDesc') }}</p>
                <div class="flex flex-col gap-0.5">
                    <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.hexLabel') }}</span>
                    <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 break-all">{{ hexMetin }}</span>
                </div>
                <div class="flex flex-col gap-0.5">
                    <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider">{{ $t('dapps.solana.hashLabel') }}</span>
                    <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 break-all">{{ contentHash || '...' }}</span>
                </div>
            </div>
        </div>

        <!-- Duz mesaj imzasinin cuzdan tarafindan DOGRULANMIS bir alan
             baglamasi YOKTUR; SIWS'in var oldugu tek sebep budur (K9). -->
        <p v-if="!siwsModu" class="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">{{ $t('dapps.solana.noDomainBinding') }}</p>

        <div v-if="hata" class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl p-3">
            <p class="text-xs text-red-700 dark:text-red-300 leading-relaxed">{{ hata }}</p>
        </div>

        <template #footer>
            <button @click="reddet" :disabled="loading" class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-white/5 cursor-pointer">
                {{ $t('dapps.solana.btn_reject') }}
            </button>
            <!-- KOD INCELEMESI (Gorev 14'un SolanaConnectApprove'da bulunan
                 bulgusu buraya da uygulanir): onayla()'nin kendi kilidi
                 `!requestData.value` uzerinedir -- yani ekranin sablonu
                 onMounted'in TEK await'i (chrome.storage.local.get) COZULMEDEN
                 ONCE zaten cizilmis olur ve `requestData` o ana kadar `null`
                 kalir. Dugme yalnizca `loading`e bagli olsaydi bu pencerede
                 GORSEL olarak etkin gorunur, tiklama onayla()'nin kendi
                 kilidine SESSIZCE carpar ve kullaniciya HICBIR geri bildirim
                 gitmezdi. `!requestData` ekleyerek dugme, gonderecegi seyi
                 GERCEKTEN bilene kadar devre disi kalir. -->
            <button
                id="solana-sign-approve"
                @click="onayla"
                :disabled="loading || !requestData"
                class="w-1/2 py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white cursor-pointer disabled:opacity-50"
            >
                {{ $t('dapps.solana.btn_sign') }}
            </button>
        </template>
    </ApprovalShell>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../store/pageStore'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { sha256, toHex } from '../../utils/crypto-utils'
import { resolveSolanaSendError } from '../../utils/solana/sendErrors'
import { gorunurKil } from '../../utils/solana/visibleText.js'
import ApprovalShell from './ApprovalShell.vue'

const { t } = useI18n()
const page = pageStore()

const requestData = ref(null)
const account = ref(null)
const loading = ref(false)
const hata = ref('')
const contentHash = ref('')
const mesajBaytlari = ref(null)
// null = UTF-8 COZULEMEDI (bos dize gecerli bir cozumdur, ayirt edilmeli).
const cozulenMetin = ref(null)

const origin = computed(() => requestData.value?.origin || '')
const appMetaAdi = computed(() => gorunurKil(String(requestData.value?.appMeta?.name || '').slice(0, 64)))
const siwsModu = computed(() => requestData.value?.mode === 'signIn')
const okunabilir = computed(() => cozulenMetin.value !== null)
const gorunurMetin = computed(() => (cozulenMetin.value === null ? '' : gorunurKil(cozulenMetin.value)))
const hexMetin = computed(() => (mesajBaytlari.value ? toHex(mesajBaytlari.value) : ''))

// SIWS alanlarindan IKISI cuzdan tarafindan ZORLANIR: `domain` gercek origin
// ile EZILIR ve `address` oturum hesabiyla uyusmazsa istek arka planda
// reddedilir (§4.3.1 kapi 9). Kullanicinin hangisine guvenebilecegini bilmesi
// gerekir -- aksi halde ekran sayfanin iddiasini cuzdanin garantisi gibi
// gosterirdi.
const ZORLANAN = ['domain', 'address']
const SIWS_ALANLARI = ['domain', 'address', 'statement', 'uri', 'version', 'chainId', 'nonce', 'issuedAt', 'expirationTime', 'notBefore', 'requestId', 'resources']

// KOD INCELEMESI (Gorev 23 fix turu, bulgu 1): domain/address DISINDAKI her
// SIWS alani sayfa tarafindan verilir ve HICBIR sekilde zorlanmaz (uri basta
// olmak uzere). Bu dokum, ana mesaj govdesinden AYRI bir render yoludur --
// gorunurKil'den GECMEDEN yazilirsa sayfa uri alanina Kiril U+0430 ile
// yazilmis bir host koyabilir ve bu, GERCEK domain'deki Latin 'a'ya AYNI
// gorunur; oysa asagidaki `alan.value` TAM DA kullanicinin okudugu,
// "yapilandirilmis" oldugu icin ana mesaj gorunumunden bile daha guvenilir
// SANILAN yer. `domain`/`address` zaten cuzdan tarafindan yazildigi (ZORLANAN)
// icin sayfadan gelen bir homoglif tasiyamaz, ama gorunurKil'i ONLARA DA
// uygulamak ZARARSIZDIR (asiri-isaretleme kabul edilir, eksik-isaretleme
// DEGIL) ve alan bazinda ozel durum ayirmaktan daha az kirilgandir.
const siwsAlanlari = computed(() => {
    const girdi = requestData.value?.signInInput
    if (!girdi) return []
    return SIWS_ALANLARI
        .filter((k) => girdi[k] !== undefined && girdi[k] !== null && girdi[k] !== '')
        .map((k) => ({
            key: k,
            value: gorunurKil(Array.isArray(girdi[k]) ? girdi[k].join(', ') : String(girdi[k])),
            zorlanan: ZORLANAN.includes(k),
        }))
})
const zorlananAlanlar = computed(() => siwsAlanlari.value.filter((a) => a.zorlanan).map((a) => a.key))

// Gorunmez/homoglif isaretleme artik `utils/solana/visibleText.js`'teki
// PAYLASILAN helper'dan (gorunurKil) gelir (C3.2) -- SolanaSignTx.vue ile
// AYNI kaynak, iki bagimsiz kopya DEGIL.
function decodeBase64(value) {
    try {
        const bin = atob(value)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    } catch (e) {
        return null
    }
}

onMounted(async () => {
    const { current_request, active_account, vaults } = await chrome.storage.local.get(['current_request', 'active_account', 'vaults'])
    if (!current_request || current_request.type !== 'SOLANA_SIGN_MESSAGE') return
    requestData.value = current_request

    // ONAYLANAN HESABA KILIT (TonSignData.vue'daki AYNI desen): aktif hesaba
    // SESSIZCE dusmek, kullanici bagliyken hesap degistirmisse yanlis cuzdandan
    // imzalatmaya calisirdi. Arka plan bunu `from` esitligiyle SONRADAN yakalar,
    // ama arayuzun GONDERDIGI hesap zaten dogru olmali.
    account.value = flattenVaultAccounts(vaults).find((a) => a.key === current_request.accountKey) || active_account || null

    const bytes = decodeBase64(current_request.message)
    mesajBaytlari.value = bytes
    if (!bytes) return
    try {
        // fatal: true SART -- varsayilan cozucu gecersiz baytlari sessizce
        // U+FFFD'ye cevirir ve ekran "okunabilir" bir metin uydurmus olurdu.
        cozulenMetin.value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (e) {
        cozulenMetin.value = null
        contentHash.value = toHex(await sha256(bytes))
    }
})

const onayla = async () => {
    if (!requestData.value || loading.value) return
    loading.value = true
    hata.value = ''
    try {
        const res = await chrome.runtime.sendMessage({
            type: 'SOLANA_DAPP_SIGN_MESSAGE',
            message: {
                mode: requestData.value.mode,
                origin: requestData.value.origin,
                from: requestData.value.from,
                accountKey: account.value?.key,
                appMeta: requestData.value.appMeta,
                // Imzalanacak baytlar KAYITTAN gider: signIn'de bu, cuzdanin
                // kendi kurdugu EIP-4361 govdesidir, sayfanin verdigi metin degil.
                message: requestData.value.message,
                signInInput: requestData.value.signInInput,
            },
        })

        if (res?.success) {
            await chrome.runtime.sendMessage({
                type: 'SIGN_MESSAGE_SUCCESS',
                requestId: requestData.value.id,
                status: 'success',
                data: {
                    result: requestData.value.mode === 'signIn'
                        ? { address: res.address, publicKey: res.publicKey, signedMessage: res.signedMessage, signature: res.signature }
                        : { signedMessage: res.signedMessage, signature: res.signature },
                },
            })
            page.currentPage = 'home'
        } else {
            // Ham kod ASLA ekrana cikmaz (§3.6): tablo tek yerde, sendErrors.js'te.
            hata.value = t(resolveSolanaSendError(res?.error))
        }
    } catch (e) {
        // KOD INCELEMESI (Gorev 23 fix turu, bulgu 2): sendMessage'in KENDISI
        // reddedebilir (uzanti baglami gecersiz kilindi, service worker
        // kapandi) -- bu, `res.success === false` dalindan FARKLI bir hattir ve
        // yakalanmazsa dugme onceki kilit-yok-geri-bildirim-yok defektini
        // (Gorev 14) BASKA bir sekilde yeniden uretir: kullanici tiklar,
        // `finally` loading'i sifirlar, ama `hata` BOS kalir ve dapp'e NE
        // basari NE de red gider. Ham istisna mesaji ASLA ekrana yazilmaz
        // (§3.6); resolveSolanaSendError(null) TABLO'nun jenerik anahtarina
        // duser.
        console.error('[solana-dapp] SOLANA_DAPP_SIGN_MESSAGE gonderilemedi:', e?.message)
        hata.value = t(resolveSolanaSendError(null))
    } finally {
        loading.value = false
    }
}

const reddet = async () => {
    if (!requestData.value) return
    try {
        // Solana ekranlari EVM ekranlarinin (Sign.vue) desenini kopyalar: red bir
        // YANIT degil, bir HATADIR -- TonConnect'in `*_SUCCESS` ile reddetme deseni
        // burada YANLIS olurdu (Wallet Standard'da dapp'in promise'i REJECT olmali).
        await chrome.runtime.sendMessage({
            type: 'SIGN_MESSAGE_REJECTED',
            requestId: requestData.value.id,
            status: 'error',
            error: { code: 4001, message: 'User rejected the request.' },
        })
        page.currentPage = 'home'
    } catch (e) {
        // onayla()'daki AYNI gerekce: sendMessage kendisi reddederse kullanici
        // "reddettim" sanip ekrandan ayrilir ama arka plan HABERSIZ kalir --
        // page.currentPage BURADA 'home'a GECMEZ, kullanici hatayi gorup
        // TEKRAR deneyebilsin diye ayni ekranda kalir.
        console.error('[solana-dapp] SIGN_MESSAGE_REJECTED gonderilemedi:', e?.message)
        hata.value = t(resolveSolanaSendError(null))
    }
}
</script>

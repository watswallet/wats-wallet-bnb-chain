<template>
    <!-- KIMLIK SATIRI: "kime, neyle, nereye" — kartin bes turu (Transaction/Swap/
         Bridge/Jetton/TonConnect) tek sablonla ciziliyordu ve hepsi AYNI gorunuyordu:
         "Gönderim 1" kullaniciya hicbir sey soylemiyordu.

         11px ve SESSIZ: karttaki asil cumle ustteki baslik+miktar satiridir, bu satir
         onu golgelememeli. Renk YOK (kartta renk yalniz durum satirinda); logolar
         14px — tanimlamak icin oradalar, susleme icin degil.

         KIRPMA ONCELIGI: 280px'lik icerik genisliginde bir sey mutlaka kirpilir;
         karar HANGISININ kirpilacagidir. Ok, kisa adres ve mesaj sayisi `shrink-0`
         (kirpilinca ANLAMSIZ olurlar); ad/sembol `truncate` (kirpilsa da tanitmaya
         devam eder). Her taraf `min-w-0` bir kapta -- yoksa flex ogeleri kucule
         bilmez ve satir kartin DISINA tasar.

         Butun alanlar ISTEGE BAGLI: eski kayitlarda hicbiri yok, o yuzden hem satirin
         kendisi hem her parca korunur — yoksa ekranda yalniz basina bir ok ya da bir
         ayrac kalir.

         `data-tx-identity`: testlerin iddialarini YALNIZ bu satira daraltmasi icin.
         Sembol miktar satirinda, ag adi baglam satirinda da geciyor; kart genelinde
         arama yapan bir iddia, satir hic cizilmese bile yesil kaliyordu. -->
    <div v-if="gorunur" data-tx-identity
        class="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-500 min-w-0">

        <!-- IKI TARAFLI: takasta token→token, kopruda ag→ag.
             KOPRUDE EKSEN AGDIR, token DEGIL: sembolu ve ag adini birlikte basmak
             her tarafta iki isim uretiyordu — hem okunmuyor hem 280px'e sigmiyordu.
             Token zaten miktar satirinda birim olarak duruyor. -->
        <template v-if="ikiTarafli">
            <span class="flex items-center gap-1 min-w-0">
                <TokenLogo v-if="sol.logo" :src="sol.logo" :symbol="sol.etiket" size-class="w-3.5 h-3.5" text-class="text-[8px]" />
                <span class="truncate" :class="{ 'font-semibold': !kopru }" :title="sol.etiket">{{ sol.etiket }}</span>
            </span>
            <span class="shrink-0">→</span>
            <span class="flex items-center gap-1 min-w-0">
                <TokenLogo v-if="sag.logo" :src="sag.logo" :symbol="sag.etiket" size-class="w-3.5 h-3.5" text-class="text-[8px]" />
                <span class="truncate" :class="{ 'font-semibold': !kopru }" :title="sag.etiket">{{ sag.etiket }}</span>
            </span>
        </template>

        <!-- TONCONNECT: islemi ISTEYEN taraf (dapp) kimligin yarisidir. -->
        <template v-else-if="meta.type === 'TonConnect'">
            <span v-if="kisaHost" class="truncate" :title="meta.dappHost">{{ kisaHost }}</span>
            <span v-if="kisaHost && kisaAlici" class="shrink-0">·</span>
            <span v-if="kisaAlici" class="font-mono shrink-0">{{ kisaAlici }}</span>
            <!-- Toplu gonderimde kart TEK alici gosterirken geri kalanini SAKLAMIS
                 olur; sayi yazilmazsa kullanici tek islem onayladigini sanir. Tek
                 mesajlik gonderimde sayiyi yazmak ise yalnizca gurultu. -->
            <span v-if="cokMesaj && (kisaHost || kisaAlici)" class="shrink-0">·</span>
            <span v-if="cokMesaj" class="shrink-0">{{ $t('transactionStatus.batchMessages', { count: meta.msgCount }) }}</span>
        </template>

        <!-- GONDERIM / JETTON: token + ALICI. Adres TAM basilmaz; 280px'te 42
             karakterlik bir adres satiri kirar. Ad (adres defteri) VARKEN bile kisa
             adres KALIR: ad kullanicinin kendi etiketi, adres dogrulanabilir olan sey. -->
        <template v-else>
            <TokenLogo v-if="meta.tokenLogo" :src="meta.tokenLogo" :symbol="meta.symbol || ''" size-class="w-3.5 h-3.5" text-class="text-[8px]" />
            <span v-if="gosterilenAd" class="truncate" :title="gosterilenAd">{{ gosterilenAd }}</span>
            <span v-if="kisaAlici && solDolu" class="shrink-0">→</span>
            <span v-if="meta.recipientLabel" class="truncate" :title="meta.recipientLabel">{{ meta.recipientLabel }}</span>
            <span v-if="kisaAlici" class="font-mono shrink-0">{{ kisaAlici }}</span>
        </template>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import TokenLogo from './TokenLogo.vue'
import { chainLogo, chainName } from '../utils/chainLogo'
import { shortenAddress } from '../utils/shortenAddress'
import { shortHost } from '../utils/shortHost'
import { isTon } from '../utils/chainKind'

const props = defineProps({
    meta: { type: Object, default: () => ({}) },
})

const meta = computed(() => props.meta || {})

// Yedek ACIKCA bos: '/default-chain.png' dosyasi client/public altinda YOK, yani
// varsayilani basmak KIRIK RESIM cizerdi. Bos src'de TokenLogo monograma duser.
const agLogo = (chainId) => chainLogo(chainId, '')

// Kopru IKI AGI, takas IKI TOKENI karsi karsiya koyar — ayni satir, farkli eksen.
const kopru = computed(() => meta.value.type === 'Bridge')

// `etiket` TEK alan: rozetin monogrami da bundan turetilir. Ayri bir `symbol`
// alani tutuldugunda kopru rozeti ag yerine TOKEN harflerini gosteriyordu.
const sol = computed(() => kopru.value
    ? { logo: agLogo(meta.value.chainId), etiket: chainName(meta.value.chainId) }
    : { logo: meta.value.fromLogo || '', etiket: meta.value.fromSymbol || '' })

const sag = computed(() => kopru.value
    ? { logo: agLogo(meta.value.toChainId), etiket: chainName(meta.value.toChainId) }
    : { logo: meta.value.toLogo || '', etiket: meta.value.toSymbol || '' })

// TEK TARAFI cozulmus bir takas/kopru hangi yone gittigini SOYLEMEZ: yarim bir ok
// bilgi degil gurultudur, o yuzden satirin tamami cizilmez.
const ikiTarafli = computed(() =>
    (kopru.value || meta.value.type === 'Swap') && !!sol.value.etiket && !!sag.value.etiket)

// Kisaltma GENISLIKLERI zincire gore: TON adresleri 48 karakter ve 6/4 ile
// kisaltilinca iki farkli cuzdan AYNI gorunur (TonSendTx.vue:234 ile ayni kalip).
const kisaAlici = computed(() => {
    const adres = meta.value.recipient
    if (!adres) return ''
    return isTon(meta.value.chainId) ? shortenAddress(adres, 8, 6) : shortenAddress(adres, 6, 4)
})

const kisaHost = computed(() => shortHost(meta.value.dappHost))

const cokMesaj = computed(() => Number(meta.value.msgCount) > 1)

// IKI `truncate` YARISMAZ. 280px'te ad ve adres defteri etiketi ayni anda uzunsa
// ikisi de yariya iniyordu ("Wrapped Liq…" + "Binance Sicak…") -- iki yarim ad, bir
// tam addan az sey soyler. Etiket "kime" sorusunun cevabi ve kullanicinin KENDI
// verdigi ad; token ise zaten miktar satirinda sembolüyle duruyor. Etiket varken
// ad basilmaz; etiket yokken ad TAM siginir.
const gosterilenAd = computed(() => (meta.value.recipientLabel ? '' : meta.value.tokenName || ''))

// OK BIR ILISKI ISARETIDIR: tek tarafi olmayan bir iliski yoktur. Dapp yolundan
// gelen islemlerde meta'da token bilgisi HIC olmuyor (Dapp.vue assetData
// gondermiyor) ve satir "→ 0x28C6...1d60" seklinde, okun solunda hicbir sey
// olmadan ciziliyordu.
const solDolu = computed(() => !!(meta.value.tokenLogo || gosterilenAd.value))

const gorunur = computed(() => {
    if (ikiTarafli.value) return true
    if (meta.value.type === 'Swap' || kopru.value) return false
    if (meta.value.type === 'TonConnect') return !!(kisaHost.value || kisaAlici.value || cokMesaj.value)
    return !!(kisaAlici.value || gosterilenAd.value)
})
</script>

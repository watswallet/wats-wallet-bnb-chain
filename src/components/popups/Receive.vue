<template>
    <div class="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm px-4" @click="popups.receive = false">

        <!-- max-h + kaydirma TON dalindan gelir: kart icerigi (uyari metni, uzun base58
             adres) bazi dillerde pencereyi asiyordu ve alt kismi ERISILEMEZ kaliyordu. -->
        <div
            class="w-full max-w-[320px] bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-3xl shadow-xl dark:shadow-2xl relative max-h-[90vh] overflow-y-auto flex flex-col items-center transition-colors duration-300"
            @click.stop
        >
            <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

            <div class="w-full flex items-center justify-between px-6 pt-6 pb-2 relative z-10">
                <div class="flex flex-col">
                    <h4 class="font-bold text-slate-900 dark:text-white text-xl tracking-tight transition-colors duration-300">{{ $t('popups.receive.title') }}</h4>
                    <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('popups.receive.scan_desc') }}</p>
                </div>

                <button
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none"
                    :aria-label="$t('common.close')"
                    @click="popups.receive = false"
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div v-if="displayAddress" class="p-6 relative z-10">
                <div class="p-2 bg-white rounded-2xl shadow-md dark:shadow-[0_0_40px_rgba(255,255,255,0.1)] border border-slate-100 dark:border-transparent transition-all duration-300">
                    <!-- HAM base58/hex adres, URI semasi (`solana:...`, `ethereum:...`, `ton://...`)
                         YOK: bazi cuzdanlar boyle bir semayi cozemez ve tarama basarisiz olur.
                         QR, asagida YAZIYLA gosterilen adresin AYNISINI tasir; ikisi de tek
                         kaynaktan (displayAddress) beslendigi icin ayrisamazlar. -->
                    <QRCode
                        :text="displayAddress"
                        logo="/old-wats-black.png"
                        :size="180"
                        :logoSizeRatio=".2"
                        colorDark="#000000"
                        colorLight="#ffffff"
                    />
                </div>
            </div>

            <!-- Adres COZULEMEDI: aktif agin adresi yerine EVM adresini SESSIZCE gostermek
                 (o agda VAR olan tek adresmis gibi) kullanicinin parasini kendi kontrol
                 ETMEDIGI bir adrese yollamasina yol acar. "Bos bakiye" ile "cozum
                 basarisiz" AYRI durumlardir; burada ACIKCA ikincisi soylenir.

                 KOD INCELEMESI (Task 16b review, "Also fix (cheap)"): kosul SADECE
                 `displayAddress` idi; EVM'de `user.address` henuz HIDRATE OLMAMISSA
                 (nadir bir pencere: Receive.vue kendisi bu degeri YAZMAZ, baska bir
                 bilesenin ONCEDEN doldurmus olmasina guvenir) bu kart YINE de acilir
                 ve "Solana adresiniz yuklenemedi" YANLIS mesajini EVM'de gosterirdi.
                 Yon GUVENLI (EVM adresine dusulmuyordu) ama mesaj YANLIS zinciri
                 adlandiriyordu. `vm === 'solana'` bu karti yalniz GERCEKTEN Solana
                 aktifken acar. `solanaFailed` de sart: cozum HENUZ surerken kart
                 acilirsa kullanici, birkac yuz milisaniye sonra gelecek bir adres icin
                 "yuklenemedi" hatasi gorup pencereyi bosuna kapatip acar. -->
            <div v-else-if="vm === 'solana' && solanaFailed" class="px-6 py-10 relative z-10 flex flex-col items-center gap-3 text-center">
                <svg class="w-8 h-8 text-rose-400 dark:text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                <p class="text-xs text-rose-500 dark:text-rose-400 font-medium max-w-55 leading-relaxed">{{ $t('popups.receive.solanaAddressUnavailable') }}</p>
            </div>

            <!-- Adres HENUZ gelmedi: QR'in yerini SABIT tutuyoruz (TON dali). Alan bos
                 birakilirsa kutu cokuyor, adres gelince pencere ziplayarak genisliyordu. -->
            <div v-else class="p-6 relative z-10">
                <div class="p-2 bg-white rounded-2xl shadow-md dark:shadow-[0_0_40px_rgba(255,255,255,0.1)] border border-slate-100 dark:border-transparent transition-all duration-300">
                    <div class="w-[180px] h-[180px] flex items-center justify-center text-center px-4 text-[11px] text-slate-400">
                        {{ $t('popups.receive.loading_address') }}
                    </div>
                </div>
            </div>

            <div class="w-full px-6 pb-8 flex flex-col items-center gap-4 relative z-10">
                <div class="px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-slate-700 dark:text-zinc-300 text-sm font-semibold shadow-sm dark:shadow-none transition-colors duration-300">
                    {{ activeAccount?.name || $t('popups.receive.default_account') }}
                </div>

                <!-- EVM/TON: IKI ADRES ALT ALTA (TON dalinin bicimi).
                     Kullanicinin EVM ve TON adresi AYNI ANDA gecerlidir; biri "aktif"
                     digeri "yok" degil. Tek adres gosterildiginde TON adresini almak
                     icin ONCE TON agina gecmek gerekiyordu - TON dali tam bunu kapatti.

                     QR, rozet ve alttaki uyari AKTIF AGI degil DOKUNULAN SATIRI izler.
                     Ucu de TEK bir kaynaktan (`activeKind`) beslenir: QR bir adresi,
                     uyari baska bir agi soylerse kullanici karsi zincirden gonderir ve
                     varlik KALICI OLARAK KAYBOLUR. -->
                <div v-if="multiRow" class="w-full flex flex-col gap-2">
                    <button
                        v-for="row in addressRows"
                        :key="row.kind"
                        @click="selectAndCopy(row)"
                        :disabled="!row.address"
                        class="group w-full relative rounded-xl p-3 border text-left overflow-hidden transition-all duration-300 shadow-sm dark:shadow-none"
                        :class="[
                            row.address
                                ? 'cursor-pointer bg-slate-50 hover:bg-slate-100 dark:bg-zinc-900/80 dark:hover:bg-zinc-900'
                                : 'cursor-default opacity-60 bg-slate-50 dark:bg-zinc-900/50',
                            row.kind === activeKind
                                ? 'border-indigo-400 dark:border-indigo-500/50'
                                : 'border-slate-200 dark:border-zinc-800'
                        ]"
                    >
                        <div v-if="copiedKind === row.kind" class="absolute inset-0 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl transition-all"></div>

                        <div class="relative z-10 flex items-center justify-between gap-2 mb-1">
                            <span
                                class="text-[10px] font-bold uppercase tracking-wider transition-colors duration-300"
                                :class="row.kind === activeKind ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-zinc-500'"
                            >{{ $t(`popups.receive.${warningKeyForKind(row.kind)}`) }}</span>

                            <!-- QR'da hangi adresin durdugu YAZIYLA da soylenir. Yalnizca cerceve
                                 rengiyle anlatmak, iki adres arasindaki farki gozden kacirtabilirdi. -->
                            <span v-if="row.kind === activeKind && row.address" class="shrink-0 text-[9px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                                {{ $t('popups.receive.qr_badge') }}
                            </span>
                        </div>

                        <p class="relative z-10 text-[11px] font-mono text-slate-800 dark:text-zinc-200 break-all leading-tight transition-colors duration-300">
                            {{ row.address || $t('popups.receive.loading_address') }}
                        </p>

                        <div
                            v-if="row.address"
                            class="relative z-10 mt-2 flex items-center gap-1.5 text-[11px] font-bold transition-colors duration-300"
                            :class="copiedKind === row.kind ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-700 dark:group-hover:text-indigo-300'"
                        >
                            <span v-if="copiedKind !== row.kind" class="flex items-center gap-1.5">
                                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18q-.825 0-1.412-.587T7 16V4q0-.825.588-1.412T9 2h9q.825 0 1.413.588T20 4v12q0 .825-.587 1.413T18 18zm0-2h9V4H9zm-4 6q-.825 0-1.412-.587T3 20V6h2v14h11v2zm4-6V4z"/></svg>
                                {{ $t('popups.receive.click_to_copy') }}
                            </span>
                            <span v-else class="flex items-center gap-1.5 animate-fade-in">
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                                {{ $t('popups.receive.copied') }}
                            </span>
                        </div>
                    </button>
                </div>

                <!-- SOLANA: TEK ADRES. Liste burada BILEREK kapali - ekranda bir EVM ya
                     da TON adresi HIC BULUNMAMALI. Dogru etiketli, yan yana duran bir 0x
                     satiri bile "kontrol ettim" hissi verip kullanicinin SOL/SPL'yi o
                     adrese yollamasina yol acar; ayri anahtar uzaylari oldugu icin o para
                     KALICI OLARAK KAYBOLUR. (Kullanicinin TUM adreslerini yan yana gorup
                     kopyaladigi yuzey Header.vue acilir listesidir.) -->
                <button
                    v-else-if="displayAddress"
                    @click="selectAndCopy({ kind: 'solana', address: displayAddress })"
                    class="group w-full relative bg-slate-50 hover:bg-slate-100 dark:bg-zinc-900/80 dark:hover:bg-zinc-900 border border-slate-200 hover:border-indigo-400 dark:border-zinc-800 dark:hover:border-indigo-500/30 rounded-xl p-4 transition-all duration-300 text-center overflow-hidden cursor-pointer shadow-sm dark:shadow-none"
                >
                    <div v-if="copiedKind === 'solana'" class="absolute inset-0 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl transition-all"></div>

                    <p class="relative z-10 text-xs text-slate-500 dark:text-zinc-500 mb-1 font-medium uppercase tracking-wider transition-colors duration-300">{{ $t('popups.receive.label_address') }}</p>

                    <div class="relative z-10 flex items-center justify-center gap-2">
                        <p class="text-sm font-mono text-slate-800 dark:text-zinc-200 break-all leading-tight transition-colors duration-300">{{ displayAddress }}</p>
                    </div>

                    <div class="relative z-10 mt-3 flex items-center justify-center gap-1.5 text-xs font-bold transition-colors duration-300"
                        :class="copiedKind === 'solana' ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400 group-hover:text-indigo-700 dark:group-hover:text-indigo-300'">
                        <span v-if="copiedKind !== 'solana'" class="flex items-center gap-1.5">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18q-.825 0-1.412-.587T7 16V4q0-.825.588-1.412T9 2h9q.825 0 1.413.588T20 4v12q0 .825-.587 1.413T18 18zm0-2h9V4H9zm-4 6q-.825 0-1.412-.587T3 20V6h2v14h11v2zm4-6V4z"/></svg>
                            {{ $t('popups.receive.click_to_copy') }}
                        </span>
                        <span v-else class="flex items-center gap-1.5 animate-fade-in">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                            {{ $t('popups.receive.copied') }}
                        </span>
                    </div>
                </button>

                <!-- Uyari etiketi ile QR AYNI kaynaktan (`activeKind`) turer. Ayrisirlarsa
                     (QR bir adresi, etiket baska bir agi soylerse) kullanici karsi zincirden
                     gonderir ve varlik KALICI OLARAK KAYBOLUR; yanlis adres gostermekle ayni
                     sonuc, sadece yon ters. Adres yokken uyari da gosterilmez: hangi adrese
                     ait oldugu belirsiz bir "yalnizca X aglarindan gonderin" cumlesi,
                     kullanicinin elindeki baska bir adresi o ag saymasina yol acar. -->
                <i18n-t v-if="displayAddress" keypath="popups.receive.warning" tag="p" class="text-[10px] text-slate-400 dark:text-zinc-600 text-center max-w-[80%] leading-relaxed transition-colors duration-300">
                    <template #network>
                        <span class="text-slate-600 dark:text-zinc-400 font-bold transition-colors duration-300">{{ $t(`popups.receive.${warningKey}`) }}</span>
                    </template>
                </i18n-t>
            </div>
        </div>
    </div>
</template>

<script setup>
// BU EKRAN AKTIF VM'IN ADRES(LER)INI GOSTERIR.
//
// BIRLESTIRME NOTU (TON dali x Solana dali). TON dali burayi coklu-satir bir
// listeye cevirmisti (EVM + TON alt alta, QR dokunulan satiri izliyordu). Solana
// dali ise tek adrese donmustu, cunku onun pazarlik disi kurali su: Solana
// aktifken ekranda EVM adresi HIC BULUNMAMALI - yan yana duran, dogru etiketli
// bir 0x satiri bile "kontrol ettim" hissi verip kullanicinin SOL/SPL'yi o adrese
// yollamasina yol acar ve o para KALICI OLARAK KAYBOLUR.
//
// IKISI CELISMIYOR: kural yalnizca SOLANA aktifken baglayici. Birlestirmede liste
// TUMDEN silinmisti; gerekce "coklu-satir bicimi Solana testlerini gecemez" idi ve
// bu OLCULDU: TON'un bicimi aynen konuldugunda Receive.ssr.test.js'te DUSEN 5
// testin BESI DE Solana testidir, EVM testleri GECER. Yani liste Solana'da
// kapatilinca her iki taraf da korunuyor - bugunku hal budur:
//   - EVM/TON aginda IKI satir (TON dalinin kazanimi: TON adresini gormek/kopyalamak
//     icin artik ag degistirmek gerekmiyor),
//   - Solana aginda TEK adres (Solana dalinin kurali aynen duruyor).
//
// TON dalinin oteki katkilari da KORUNDU:
//   - hangi adresin hangi TURE ait oldugu HALA saf katmanda karar veriliyor
//     (useDisplayAddress.js:buildAddressRows + warningKeyForKind),
//   - TON adresi 0x'e ASLA dusmez (ensureTonAddress cozemezse null KALIR),
//   - TON'a kilitli hesapta EVM satiri HIC uretilmez (evmSupported),
//   - adres yokken QR alani SABIT boyutta durur (pencere ziplamaz).
import { computed, onMounted, ref } from 'vue'
import { popupStore } from '../../store/popup'
import { userStore } from '../../store/user'
import { networkStore } from '../../store/network'
import { copy } from '../../utils/copy'
import { buildAddressRows, warningKeyForKind } from '../../composables/useDisplayAddress'
import { ensureTonAddress } from '../../utils/ton/tonIdentity'
import { chainVm } from '../../utils/vm'
import { accountHasTon, accountHasEvm, accountShowsEvmRow } from '../../utils/accountKind'
import { isSolanaUnsupportedAccount } from '../../utils/solana/accountSupport'
import QRCode from '../QRCode.vue'

// MV3 servis calisani, mesaji ALDIKTAN sonra yanit vermeden uykuya dalabilir ya da
// yeniden baslayabilir: o durumda `chrome.runtime.sendMessage(...)` promise'i NE
// cozulur NE reddedilir. Zaman asimi OLMADAN `solanaFailed` false KALIR,
// `displayAddress` null KALIR ve ekran SONSUZA KADAR "Adres hazirlaniyor..." yazar
// - yani kullaniciyi hicbir zaman gelmeyecek bir sey icin bekletir. Bu, bu dosyanin
// hata kartini var eden gerekcenin ("sonsuz bekleme daha kotu") ta kendisi.
//
// Sure BILEREK comert: kilitli kasada arka uc PBKDF2 + SLIP-0010 turetmesi yapiyor
// ve yavas makinede birkac saniye surebilir. Zaman asimi bir HIZ siniri degil,
// ASILI KALMAYA karsi son duraktir.
const SOLANA_ADDRESS_TIMEOUT_MS = 15000

// Promise'i sureye baglar. `clearTimeout` SART: promise once cozulurse geride
// bekleyen bir zamanlayici birakmayiz.
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SOLANA_ADDRESS_TIMEOUT')), ms)
    Promise.resolve(promise).then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
    )
})

const user = userStore()
const popups = popupStore()
const network = networkStore()
const activeAccount = ref(null)
const copiedKind = ref(null)

// Aktif agin TURU: 'evm' | 'ton' | 'solana'. chainVm TEK dogru kaynaktir:
// TON kaydinda `vm` alani YOK (kind:'ton'), Solana kaydinda `kind` alani YOK
// (vm:'solana'); tek bir alana bakan her kontrol otekini yanlis siniflandirir.
const vm = computed(() => chainVm(network.currentNetwork))

// Coklu-satir yalnizca EVM/TON'da. Bkz. dosya basindaki birlestirme notu.
const multiRow = computed(() => vm.value !== 'solana')

// TON ve Solana'da GOSTERILECEK kimlik EVM `.address` DEGILDIR (Home.vue/Send.vue/
// SelectAssets.vue ile AYNI ilke). `null` = HENUZ cozulmedi ya da cozum BASARISIZ
// oldu; ikisi de "gosterilecek adres yok" demektir ve hicbirinde EVM adresine
// SESSIZCE DUSULMEZ.
const tonAddress = ref(null)
const solanaAddress = ref(null)

// "HENUZ GELMEDI" ile "COZULEMEDI" AYRI durumlardir ama ikisi de bos adresle
// temsil edilir. Ayrimi tasiyan yer burasi: cozum dustugunde ekran sonsuza kadar
// "Hazirlaniyor..." yazip kullaniciyi var olmayan bir seyi beklemede birakmasin,
// ACIKCA "yuklenemedi" desin. (useDisplayAddress.js 3. kuralin ayni sinifi:
// bekleyen kullanici cuzdanin bozuk oldugunu dusunur.)
//
// YALNIZCA Solana: hata metni ("solanaAddressUnavailable") zincirin ADINI
// iceriyor ve TON/EVM'de basilirsa YANLIS ZINCIRI adlandirirdi.
const solanaFailed = ref(false)

// Bu hesabin Solana adresi HIC OLMAYACAK mi?
//
// Karar TEK YERDE: utils/solana/accountSupport.js. Iki "asla" durumu da orada
// ve ikisi de bos adresle AYNI gorunurdu:
//   - Ice aktarilmis secp256k1 hesabi: ondan ed25519 TURETILEMEZ.
//   - TON hesabi (type:'ton'): sirri 24 kelimelik bir TON ifadesidir ve
//     bip39.mnemonicToSeed onu KABUL EDER (saf PBKDF2, checksum yok) -- gecerli
//     GORUNEN ama Phantom/Solflare'in hic uretmeyecegi bir adres cikardi.
//
// Ikinci kosul EskiDEN burada, YEREL bir hesap-turu dalinda dururdu ve
// kullaniciyi o turetmeden koruyan TEK kapi buydu. Artik kural kaynagindadir:
// isSolanaUnsupportedAccount type:'ton'i de reddediyor ve ayni dosyadaki
// assertSolanaDerivable alti turetme cikisinin hepsini kasa tipiyle kapatiyor
// (spec §8 R1). Kopyayi burada birakmak iki cevap yayinlamak olurdu.
//
// Hesap HENUZ OKUNMADIYSA destekleniyor sayilir (fail-open): bilinmeyeni
// desteklenmiyor saymak gecerli bir hesapla gelen kullaniciyi da kilitlerdi.
const solanaSupported = computed(() => {
    const account = activeAccount.value
    if (!account) return true
    return !isSolanaUnsupportedAccount(account)
})

// Hangi adres hangi TURE ait: karar saf katmanda (useDisplayAddress.js). Kural bir
// yerde dururken burada tekrar yazilmasi, iki kopyanin ayrisip birinin yanlis
// etiketli adres basmasi demektir.
const addressRows = computed(() => buildAddressRows({
    chain: network.currentNetwork,
    // TON'a kilitli hesapta `user.address` ZATEN TON adresidir (spec 5). EVM
    // satirina verilirse buildAddressRows AYNI UQ... dizesini iki kez dondurur ve
    // bu ekran onun uzerine "EVM uyumlu aglardan varlik gonderin" yazan, EVM
    // etiketli bir QR basar - useDisplayAddress.js'in pazarlik disi ilk kuralinin
    // tam ihlali.
    //
    // Hesap HENUZ OKUNMADIYSA da EVM adresi gosterilmez. `activeAccount` onMounted'da
    // asenkron doluyor ama `user.address` store'dan geldigi icin ilk karede ZATEN
    // dolu: fail-open bir kosul, TON hesabinda o birkac karede TON adresini "EVM"
    // etiketli QR olarak basardi. Bilinmiyorsa gosterilmez.
    //
    // TON'a kilitli hesapta satir TUMDEN kalkar (evmSupported). `null` gecmek
    // yetmiyordu: o deger "adres henuz turetilmedi" ile ayni ve satir sonsuza kadar
    // "Hazirlaniyor..." yaziyordu - var olmayan bir adresi bekleten bir mesaj.
    // Hesap HENUZ OKUNMADIYSA satir DURUR (bayrak true), yalnizca adresi bos kalir:
    // orasi gercekten gecici bir "hazirlaniyor" durumu. Ayrim bilincli.
    //
    // DUZELTME (2026-09-10, inceleme turu 2, Critical 1): `evmAddress` bir
    // onceki turde `activeAccount.value?.type !== 'ton' ? user.address : null`
    // idi -- `activeAccount` acilista bir an `null`dir (yerel ref, onMounted'da
    // asenkron dolar) ve o anda `undefined !== 'ton'` `true` doner, yani hesap
    // HENUZ DOGRULANMADAN `user.address` (Pinia store'dan HEMEN dolu) sizardi.
    // Bu, dosyanin :312-315'teki KENDI yorumunun tam yasakladigi hata: "Hesap
    // HENUZ OKUNMADIYSA da EVM adresi gosterilmez... fail-open bir kosul, TON
    // hesabinda o birkac karede TON adresini 'EVM' etiketli QR olarak basardi."
    // Dogrusu `activeAccount.value &&` guard'ini KORUYUP `accountHasEvm` sormak:
    // hesap null iken KOSULSUZ `null` doner (satir "hazirlaniyor" gosterir,
    // evmSupported=true onu ayakta tutar), hesap COZULDUGUNDE `accountHasEvm`
    // (accountKind.js, artik eski/legacy `type:'ton'` icin fail-closed `false`
    // doner) gercek soruyu sorar.
    // `accountHasEvm` DEGIL `accountShowsEvmRow`: birincisi fail-closed ve
    // `type` alani olmayan ESKI bir kayitta `false` donuyordu -- satir tumden
    // kalkiyor, kullanici kendi alis adresini goremiyor, QR bos kaliyordu
    // (final inceleme bulgusu 2026-09-11). Header.vue ayni hesap icin adresi
    // GOSTERIYORDU; iki ekran celisiyordu. Ikisi artik AYNI fonksiyonu soruyor.
    evmSupported: accountShowsEvmRow(activeAccount.value),
    evmAddress: activeAccount.value && accountShowsEvmRow(activeAccount.value) ? user.address : null,
    tonAddress: tonAddress.value,
    // TON satiri KANIT ister (spec §5, buildAddressRows'un fail-closed varsayilani):
    // `activeAccount` acilista bir an `null`dir ve o anda `accountHasTon(null)` false
    // doner - satir cizilmez. Hesap TON'u KANITLADIGINDA (type:'ton') satir gorunur.
    tonSupported: accountHasTon(activeAccount.value),
}))

// KULLANICININ dokundugu satir. Acilista bos: baslangic secimi `activeKind`
// icinde AKTIF AGDAN turetilir - kullanici Al'i genellikle bulundugu agda acar.
const selectedKind = ref(null)

// QR'da, rozette ve uyarida gosterilen TUR. Uc yuzey de BURADAN beslenir ki
// ayrisamasinlar (QR bir adresi, uyari baska bir agi soylerse varlik KALICI OLARAK
// KAYBOLUR).
//
// Secim, satiri GERCEKTEN var olan bir ture kilitlenir. TON'a kilitli hesapta EVM
// satiri HIC uretilmez; secim koru korune 'evm'de kalsaydi ekran, listede boyle bir
// satir olmadigi halde sonsuza kadar "hazirlaniyor" gosterirdi.
const activeKind = computed(() => {
    if (vm.value === 'solana') return 'solana'
    const kinds = addressRows.value.map((row) => row.kind)
    if (selectedKind.value && kinds.includes(selectedKind.value)) return selectedKind.value
    if (kinds.includes(vm.value)) return vm.value
    return kinds[0] || vm.value
})

// Solana kapisi listeden ONCE gelir: buildAddressRows (ve kardesi
// pickDisplayAddress) yalnizca `isTon` sorusunu soruyor, yani Solana onlar icin
// "EVM"dir ve 0x adresini donerdi (ConfirmTransaction.vue'daki AYNI kapinin
// ikizi). Ortak yardimci 'solana'yi ogrendiginde bu kapi KALDIRILMALI.
const displayAddress = computed(() => {
    if (vm.value === 'solana') return solanaAddress.value

    return addressRows.value.find((row) => row.kind === activeKind.value)?.address || null
})

// Uyari etiketi de ayni kapidan gecer: `warningKeyForKind` 'ton' DISINDAKI HER
// SEYE "EVM uyumlu" diyor ve bu cumle Solana adresinin altinda, o fonksiyonun var
// olma sebebi olan hatanin AYNISIDIR (varlik KALICI OLARAK KAYBOLUR), sadece
// zincir farkli.
const warningKey = computed(() => (
    vm.value === 'solana' ? 'warning_network_bold_solana' : warningKeyForKind(activeKind.value)
))

// Dokunmak hem QR'i o satira cevirir hem adresi kopyalar. Ayri bir "sec" kontrolu
// eklenmedi: iki satirlik bir listede ikinci bir dokunma hedefi, kullaniciyi
// kopyaladigini sanip kopyalamamis birakma riski tasiyor.
const selectAndCopy = (row) => {
    if (!row?.address) return

    selectedKind.value = row.kind

    // Adres HAM haliyle kopyalanir: base58 (Solana ve TON) buyuk/kucuk harf
    // duyarlidir ve kucultulen bir adres BASKA bir adrestir.
    copy(row.address)
    copiedKind.value = row.kind

    setTimeout(() => {
        // Bu arada DIGER satir kopyalandiysa onun geri bildirimini silme.
        if (copiedKind.value === row.kind) copiedKind.value = null
    }, 2000)
}

onMounted(async() => {
    const { active_account } = await chrome.storage.local.get('active_account')
    activeAccount.value = active_account

    // TON adresi EVM aginda da COZULUR: iki satir birden gosteriliyor ve ag kapisi
    // kalsaydi EVM agindayken TON satiri sonsuza kadar "hazirlaniyor" derdi.
    // Solana'da satir HIC cizilmedigi icin cozumleme de yapilmaz.
    //
    // HESAP KAPISI: bu blok AKTIF AGDAN BAGIMSIZ kosuyor, yani hesabin zincir
    // suzgeci onu erisilemez KILMAZ. TON cuzdani OLMAYAN hesapta
    // tonIdentityForAccount TON_ACCOUNT_REQUIRED firlatir; asagidaki catch onu
    // yutar ama her acilista konsola bir hata yazar.
    //
    // ARA DURUM YOK (2026-09-08): bir donem bu kapidan sonra EVM hesabinda TON
    // satiri adres yerine "Preparing address..." derdi. Spec adim 8 (`tonSupported`
    // bayragi) BU DOSYADA, 74 satir yukarida (:328) inince o durum kapandi -- EVM
    // hesabinda TON satiri ARTIK HIC CIZILMIYOR.
    //
    // Iki kapi AYNI soruyu (`accountHasTon`) BILEREK iki kez soruyor: buradaki
    // TURETMEYI durdurur (kasa acilmaz, konsola hata yazilmaz), :328'deki SATIRI
    // durdurur. Biri digerini gereksiz kilmaz; teki kaldirilirsa ya hayalet bir
    // satir ya da her acilista bir TON_ACCOUNT_REQUIRED geri gelir.
    if (accountHasTon(active_account) && vm.value !== 'solana') {
        try {
            tonAddress.value = await ensureTonAddress(active_account, {
                testnet: Boolean(network.currentNetwork?.testnet),
            })
        } catch (e) {
            // Kilitli kasa ya da turetme hatasi: adres BOS kalir, 0x'e DUSULMEZ.
            // Satir "hazirlaniyor" metninde kalir (TON dalinin kendi secimi):
            // ceviri dosyalarinda TON'a ozel bir hata metni YOK ve Solana'ninkini
            // basmak YANLIS ZINCIRI adlandirirdi.
            console.error('TON adresi cozulemedi:', e.message)
        }
    }

    if (vm.value === 'solana') {
        // Adresi HIC olmayacak hesapta arka uca sorulmaz; sonuc yine de "yuklenemedi"
        // kartidir. Ideali "bu hesabin Solana adresi yok" demek olurdu ama o metin
        // ceviri dosyalarinda YOK; sonsuz "Hazirlaniyor..." beklemesi ise daha kotu.
        if (!solanaSupported.value) {
            solanaFailed.value = true
            return
        }

        // Home.vue/Send.vue/SelectAssets.vue ile AYNI sira: once hesaptaki hazir
        // alan, yoksa arka uca (SOLANA_GET_ADDRESS) sorulur. Kasa kilitliyken, arka
        // uc yeniden baslarken ya da servis calisani HIC YANIT VERMEDEN (withTimeout)
        // asili kalirken bu cagri sonuclanmaz: solanaAddress null KALIR, hata karti
        // cikar ve ekran EVM adresine SESSIZCE DUSMEZ.
        try {
            const address = active_account?.solanaAddress
                || (await withTimeout(
                    chrome.runtime.sendMessage({ type: 'SOLANA_GET_ADDRESS' }),
                    SOLANA_ADDRESS_TIMEOUT_MS,
                ))?.result?.address
            if (address) solanaAddress.value = address
            else {
                solanaFailed.value = true
                console.error('Solana adresi cozulemedi: sonuc bos')
            }
        } catch (e) {
            solanaFailed.value = true
            console.error('Solana adresi cozulemedi:', e.message)
        }
    }
})
</script>

<style scoped>
@keyframes fade-in {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
    animation: fade-in 0.2s ease-out;
}
</style>

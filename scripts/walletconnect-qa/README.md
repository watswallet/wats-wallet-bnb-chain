# WalletConnect QA harness'i (client/scripts/walletconnect-qa)

GERCEK WATS dist'ini (Chromium `--load-extension`) ve GERCEK `https://lab.reown.com/appkit?name=wagmi`
sayfasini CDP ile surer; uretim sunucusuna YAZMADAN ve gercek para/islem OLMADAN QA vakalarini (spec
bolum 4 ve 12) kosar. Kosu: T16. Bu klasorun `rpc-smoke.mjs` dosyasi T6'nindir (asagida belgelenir).

Komutlar uzantinin kok klasorunden (`package.json`'in oldugu yer) calistirilir.

## Hizli baslangic

```bash
node scripts/walletconnect-qa/run.mjs --selftest   # cevrimdisi: guard, rpc-mock, stub, tohum, i18n (tarayicisiz, ~10 sn)
node scripts/walletconnect-qa/run.mjs              # KURU KOSU = --dry: S1-S5, yerel dapp sayfasi, Lab YOK (~3 dk, derleme dahil)
node scripts/walletconnect-qa/run.mjs --live       # F1-F14, gercek Lab (T16); iki faz: hermetic sonra realrpc
node scripts/walletconnect-qa/rpc-smoke.mjs        # OP/Base/Arbitrum/Polygon public RPC duman betigi (T6)
```

Onkosullar: Node >= 22 (yerlesik WebSocket/fetch), `npx playwright install chromium` ile kurulu Chromium
(`%LOCALAPPDATA%/ms-playwright/chromium-*/`; baska ikili icin `QA_CHROME` veya `--chrome`; MARKA Chrome 137+
`--load-extension`'i yok sayar), `openssl` (Git for Windows ile gelir) ve `client/node_modules` kurulu.

## Secenekler

| Secenek | Anlami |
|---|---|
| `--selftest` / `--dry` (varsayilan) / `--live` | mod |
| `--phase hermetic\|realrpc\|all` | yalniz `--live`; varsayilan `all`. hermetic: RPC ana makineleri yerele eslenir (F5 vb.); realrpc: GERCEK public RPC (F6/F7) |
| `--source head\|worktree` | derleme kaynagi. `head` (varsayilan, spec S1) = `git archive HEAD client`: COMMIT EDILMEMIS degisiklikler derlenmez. `worktree` = izlenen + izlenmeyen-ama-yok-sayilmayan dosyalar |
| `--dist <dizin>` + `--api-port <n>` | derlemeyi atla (yalniz gelistirme): dist, VITE_API_URL=`http://127.0.0.1:<n>` ile derlenmis olmali |
| `--only F3,F4` | yalniz bu akislar. Akislar durum PAYLASIR: `--only F1,F2,F3` verin (F1/F2 baglanti kurar) |
| `--headed` | basli tarayici (S9 yedegi / hata ayiklama) |
| `--keep` | scratch'i silme |
| `--out <dizin>` | kanit klasoru. Varsayilan: `--live` -> `.superpowers/sdd/walletconnect-qa/live-run/`, `--dry` -> `.../dry-run/<zaman>/` (git DISI) |

Ortam: `QA_SCRATCH` (scratch kok klasoru), `QA_CHROME`, `QA_DEBUG=1` (Target.* olaylarini yazar),
`QA_PAUSE_ON_START=1` (yeni hedefler ilk ag olayina kadar duraklatilir), `QA_READ_GATE=1` (okuma gecidi T4b yapildiysa:
F13'e iki ek vaka ekler: iletilen `eth_blockNumber` ve yasak `eth_sendRawTransaction` -> 4200).

## Dosyalar

| Dosya | Sorumluluk |
|---|---|
| `run.mjs` | CLI; S1 (scratch derleme + dist taramasi), faz yonetimi, kanit, S8 temizlik |
| `browser.mjs` | Chromium + CDP (oturumlar, onay penceresi bekleme, popup, SW), alert yakalama |
| `seed-vault.mjs` | atilabilir kasa (rastgele mnemonic/parola), SW'ye yazma, GERCEK Login ile kilit acma |
| `rpc-mock.mjs` | yerel JSON-RPC taklidi (bakiye, nonce, gas, blok, makbuz, ERC-20/EntryPoint cagrilari) |
| `bundler-stub.mjs` | tek surec HTTP+HTTPS taklit sunucu: uretim API'si (konserve), paymaster (status/quote/sponsor/relay), salt-okunur POST vekil okumalari (`/ton/rpc`), RPC yonlendirme, yerel sayfalar |
| `backend-guard.mjs` | uzanti hedeflerinin ag trafigini siniflar; `*.watswallet.com` YEREL mi, baska yerel olmayan istek izinli mi |
| `flows.mjs` | kuru kosu akislari D1-D8 ve Lab akislari F1-F14, Lab surucusu |
| `rpc-smoke.mjs` | (T6) public RPC duman betigi |

## Mekanizma kararlari (spec S1-S5) ve OLCULEN davranislar (2026-10-05, Chromium 149, Windows 11)

- **S1 derleme:** `git archive HEAD client` + `tar -xf client.tar` (cwd = scratch; GNU tar `C:` yolunu uzak makine sanir)
  + `node_modules` junction + `gen-wallet-standard-metadata.mjs` + `node node_modules/vite/bin/vite.js build` (npx/npm YOK).
  Ortam: `VITE_API_URL=VITE_BUNDLER_BASE=http://127.0.0.1:<stub http portu>`; ortam degiskeni `.env.production`'i EZER
  (dist taramasinda `127.0.0.1:<port>` 3 pakette bulundu; bulunmazsa kosu DURUR). Derleme ~35 sn.
  Dist'te kalan `watswallet.com` adresleri: `https://watswallet.com`, `https://watswallet.com/logo.png`, `https://bundler.watswallet.com`.
- **S2 tarayici:** `--headless=new --load-extension` CALISIR; SW hedefi `service-worker-loader.js` (Chromium'un kendi bilesen
  uzantisi `thunk.js` adli ayri bir SW hedefi acar: URL'ye gore ESLE). `chrome.windows.create` onay penceresi hedef olarak
  GORUNUR (`.../src/popup/index.html#window`).
- **S3 tohum:** kasa `crypto-utils.js` ile (vite SSR yukleyicisi; duz Node uzantisiz importlari cozemez), SW'de
  `chrome.storage.local.set`, kilit GERCEK Login ekranindan (`#login-password` + "Unlock").
- **S4 yalitim:** `--host-resolver-rules="MAP *.watswallet.com 127.0.0.1:<https portu>, ..."` + `--ignore-certificate-errors` +
  yerel TLS (openssl ile kendinden imzali) CALISIR (`MAP host 127.0.0.1:PORT` bicimi dogrulandi). Network olaylari SW ve
  sayfa hedeflerinde `remoteIPAddress` ile gelir; guard bunu kullanir.
- **S5 zincir G/C:** mekanizma tercihi (2) kullanildi: hermetik fazda TUM EVM RPC ana makineleri ayni TLS sunucuya eslenir
  (cuzdan ana ekranda 10 zincirin bakiyesini de okur). CDP `Fetch` YALNIZ Lab SAYFASINDA ve yalniz Lab'in kendi
  `rpc.walletconnect.org` `eth_estimateGas` cagrisi icin kullanilir (SW'de `Fetch` KULLANILMAZ). realrpc fazinda RPC eslemesi YOK.

## TUZAKLAR (hepsi olculdu; her biri bir harness hatasi gibi gorunur)

1. **`--window-size` verme.** Headless sanal ekran 800x600; daha buyuk pencere istenirse cuzdanin
   `chrome.windows.create(left=...)` cagrisi "Invalid value for bounds" ile reddedilir ve dapp `-32603 Failed to open approval
   window` alir (spec N3). Boyut `Emulation.setDeviceMetricsOverride` ile.
2. **Acik bir uzanti sayfasi varken dapp istekleri "bos yanit" alir** (`-32603 The wallet returned an empty response`):
   ana ekran popup SEKMESI, onay penceresi (kapanirken dahil; TonConnect uyari penceresi `#alert` bu dinleyiciyi HIC kurmaz, etkilenmez). Sebep (olculerek DOGRULANDI): `src/shared/bootstrap.js`
   `dappMesajDinleyicisi` (async fonksiyon; `chrome.runtime.onMessage.addListener(dappMesajDinleyicisi)` ile kayitli) dinleyicisi bir Promise dondurur ve Chromium 149 bunu
   `undefined` YANIT sayar; dapp mesajina arka plan yerine bu sayfa "cevap verir". Bu CUZDAN kusurudur (gercek
   kullanicida da onay penceresi acikken gelen dapp istegini etkiler; duzeltmenin sahibi T18'dir, T7 degil); harness yalniz kendi yarislarini onler:
   her onaydan sonra `browser.waitClosed(...)`, popup kapaninca `closeTarget` oturumun kalkmasini bekler, popup acikken
   dapp'e ISTEK ATILMAZ (yalniz `window.__qaEvents`/depolama okunur).
3. **Ilk provider istegi askida kalabilir:** sayfa yuklenir yuklenmez (<~2 sn) atilan ilk `eth_accounts` kosularin ~%40'inda
   90 sn yanitsiz kaldi; 4 sn bekleyince 6/6 kosuda cevap geldi (kok neden BILINMIYOR; duzeltmenin sahibi T19: T7 degil). `FIRST_CALL_SETTLE_MS` + yeniden deneme
   (D1), F1'de Lab yenileme. Lab'in KENDI ilk istegi askida kalirsa F1 bunu "ILK ISTEK ASKIDA" olarak kaydeder.
4. **Bayat onay oturumu:** kapanan pencerenin oturumu `usedApprovals` ve `Target.targetDestroyed` ile elenir.
5. **`alert()` sayfayi kilitler** (`applyNetworkChange` RPC erisilemezse `network.rpcUnreachable` basar): browser.mjs
   `Page.javascriptDialogOpening`'i yakalar, metni `browser.dialogs`'a yazar ve kapatir (N5 kaniti).
6. **Lab tiklamasi bazen yutulur** (modal kapandiktan sonra): `labClick(..., effect)` etki gorulmezse bir kez daha tiklar.
7. **Header dapp sekmesini gormez** popup kendi sekmesinde acilirsa: `openPopupWindowFor` popup'i ayri pencerede acip dapp
   penceresini "son odaklanan" yapar (olculdu: Header Lab/dapp baglantisini gosterir).
8. **`ServiceWorker` CDP alani sayfa oturumundadir** (tarayici oturumunda yok): F14 SW'yi dapp sayfasi oturumundan durdurur.
9. **Uzanti arayuzu dis kaynak okur:** Google Fonts, `api.dicebear.com`, `cryptologos.cc`, `altcoinsbox.com`, dapp favicon'u
   (hepsi GET Image/Font/Stylesheet) ve ana ekranda tum zincirlerin RPC'leri. Guard bunlari "static-asset" / "rpc-read"
   olarak ayri listeler; digerleri IHLALdir (spec'in iki istisnasina eklenen ucuncu: salt-okunur GET gorsel/yazi tipi).
10. **`SwitchChain` onay ekrani vardir:** dapp `wallet_switchEthereumChain` onay penceresi acar (`dapps.switchChain.*`).
11. **`-32005 Rate limited` = HARNESS ARALAMASI, cuzdan kusuru DEGIL.** T4a/T8/T9 sonrasi cuzdan ayni origin'in onay
    penceresi acma denemesini kayan pencerede 10 sn'de 3 ile sinirlar; kontrol ayristirmadan ONCE yapilir ve ok:true her
    cagri bir hak harcar. Art arda 4 hak harcayan istek (D2-D5; F13'te 3 typed data + `personal_sign`; F6/F14) 10 sn'ye
    sigarsa 4.'su `-32005` alir. Cozum: `flows.mjs` `APPROVAL_PACE_MS = 3600` (`paceApprovals()`): her onaydan sonra ve F13'te
    hak harcayan her vakadan sonra beklenir (hak harcamayan `wallet_foo_bar` ve okuma gecidi vakalari aralanmaz). Yeni bir
    onay akisi eklenirse `await paceApprovals()` koyun. Elle kosuda da ayni kural: art arda 4 istek arasinda ~11 sn.
12. **`POST 127.0.0.1/ton/rpc` kalici girdi degildir:** uzanti TON RPC vekilini POST ile okur (salt-okunur). Stub bunu
    `READ_ONLY_POSTS` ile okuma sayar, konserve 503 doner, `stub-summary.json` `readOnlyPosts` altinda sayilir ve
    `blockedWrites`'a DUSMEZ. `blockedWrites`'ta baska bir yol kalici gorunuyorsa once bunun gercekten salt-okunur olup
    olmadigina bakin; ise `READ_ONLY_POSTS`'a ekleyin ve burada belgeleyin, uretime YAZMA ise gercek bulgudur.
    `byKind.unknown-host` 1-2 buyuk olasilikla `favicon.ico` istegidir (DOGRULANMADI).
13. **F4 ikinci tur tiklamasi (SAPMA, 2026-10-06, HEAD c42a9a3):** OP'ye gecisten sonra "Sign Typed Data" tiklamasi
    yutuldu (provider cagrisi hic gelmedi, onay penceresi cikmadi; 3/3 kosuda deterministik). `flows.mjs` F4 artik tiklamayi
    `labClick(..., effect)` ile etki dogrulamali yapar (TUZAK 6 ile ayni teknik; yalniz bu satir plandan farkli). Baska akislarda
    (F3 vb.) ayni belirti gorulurse ayni cozum uygulanir.
14. **Gozlem (kuru kosu, HEAD c42a9a3):** 3 ardisik `--dry` kosusu D1-D8 hepsi PASS (D8 dahil, G4 duzeltmesi inmis), `violations` 0,
    `readOnlyPosts` `{"/ton/rpc": 3}`, `blockedWrites`/`unknownPaths` bos, `userOps` 1. `--live`: hermetic F1-F5, F8-F14 PASS;
    realrpc F6, F7 PASS (170 `rpc-read`, 0 ihlal).

15. **Yalitim DEDEKTIFTIR, ONLEYICI DEGIL:** `backend-guard.mjs` bir ihlali istek cikip gittikten SONRA raporlar. Hermetik fazda
    korunma `--host-resolver-rules` MAP listesine (watswallet.com, dapp ana makinesi, bilinen EVM RPC ana makineleri) dayanir;
    listede olmayan bir ana makine gercek aga ULASIR ve yalniz `network-report.json`'da ihlal olarak gorunur. `realrpc`
    fazinda ag duzeyinde yazma engeli YOKTUR (`READ_RPC_METHODS` denetimi de sonradan). Mevcut akislar guvenlidir (atilabilir,
    fonsuz tohum; F6/F7'de gonderim yok); YENI bir akis eklenirken yazma yapip yapmadigi elle dusunulmelidir.
16. **Argumanlar sahte yesil uretmez:** gecersiz `--phase`/`--source`/`--api-port`, hicbir akisla eslesmeyen `--only` kimligi
    veya sifir akis calismasi cikis 1 verir. `wtUnchanged` yalniz `client/dist`, `client/release`, `client/node_modules`
    degisimine bakar (paralel ajan duzenlemeleri kirlilik sayilmaz); tam `git status` farki `wtStatusDelta` altinda bilgi
    amaclidir. Derleme hatasinda derleyici ciktisinin son 40 satiri hata iletisine eklenir.

## Beklenen sonuclar

TABAN (WT @ c8f2f97, W1-W3 oncesi): `--dry`: D1-D7 GECER, D8 (hesap degisimi, G4) KALIR. `--live`: F2 KALIR ("Connection
declined": kodsuz `wallet_requestPermissions` hatasi + bos-yanit yarisi); ilgili duzeltmelerden sonra (T3/T5/T8/T9/T10/T11/T12/T13/T14a/T14b + T18 bootstrap
dinleyicisi) tum F1-F14 GECMELI. DEVIATION satirlari sapmadir (kosuyu durdurmaz): README'ye yazilir, patrona bildirilir.

## Kanit yapisi (git DISI)

`<out>/run-info.json`, `dist-scan.json`, `summary.json`; faz basina `<out>/<faz>/`: `flows.json` (akis sonuclari + kanit; her akista
`providerCalls`/`providerEvents` = o akis boyunca dapp tarafinin gordugu TUM saglayici cagrilari ve olaylari: Ek A karsilastirmasi icin),
`network-report.json` (guard: sayim, ihlaller, static/rpc ana makineleri), `stub-summary.json` (istek turleri, engellenen yazmalar,
salt-okunur POST sayaci `readOnlyPosts`, bilinmeyen yollar, sponsor/UserOp kayitlari), `rpc-log.json` (cevaplanan ve BILINMEYEN RPC yontemleri), `extension-console.json`,
`screens/*.png`. Hicbir mnemonic/parola/sifreli kasa yazilmaz; yalniz adresler.

## rpc-smoke.mjs (T6)

`node scripts/walletconnect-qa/rpc-smoke.mjs`: OP (10), Base (8453), Arbitrum One (42161), Polygon (137) icin
`supported_chains.json`'daki HER URL'ye var olmayan bir hash icin `eth_getTransactionReceipt` sorar (cuzdanin kendi makbuz
sondasi). GECTI: her zincirde ILK URL OK ve en az bir URL OK (`result` alani var; `null` dahil). Aksi cikis kodu 1. Diger
URL'lerde hata UYARIdir. Yayindan hemen once ve G-5'te (guncelleme gunu) YENIDEN kosulur.

## Temizlik (S8)

Kosu sonunda tarayici kapanir, profil ve scratch silinir (`node_modules` junction'i once kaldirilir; WT paketleri silinmez),
`git status` ve `client/dist` + `client/release` icerik anlik goruntusu kosu oncesiyle KARSILASTIRILIR (`summary.json: wtUnchanged`).
`npm run build` HICBIR ZAMAN kosulmaz.

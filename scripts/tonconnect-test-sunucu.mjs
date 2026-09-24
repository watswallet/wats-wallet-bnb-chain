// TonConnect'i GERCEK bir dapp gibi deneyen YEREL test sayfasi.
//
// Calistirma:  cd client && npm run ton:test
// Sonra:       http://localhost:4545 adresini, uzanti YUKLUYKEN ac
//
// NEDEN VAR -- bu olculdu (2026-09-11, gercek Chromium + gercek dist):
// @tonconnect/sdk enjekte cuzdanlari sayfadaki `window` anahtarlarini gezerek
// buluyordu, ama:
//
//   sdk 2.x          Object.entries(window)              -> KESFEDER
//   sdk 3.0.0-3.2.0  Object.keys + ([_, value]) yikimi   -> SDK'nin KENDI hatasi, bulmaz
//   sdk 3.3.0-4.0.2  if (!isQaModeEnabled()) return []   -> kesif TUMDEN kaldirilmis
//
// Yani bugun YAYINDAKI dapp'lerin cogu bizi ancak `ton-blockchain/wallets-list`
// kaydindan sonra gorur ve o PR henuz acilmadi. Bu, TonConnect'in KENDISININ
// calisip calismadigini denemeyi imkansiz hale getiriyordu: kullanici hicbir
// dapp'te cuzdani secemiyordu.
//
// Bu sayfa o tikanikligi acar. SDK 2.2.0'i (taramayi YAPAN son surum) yerelden
// servis eder, boylece defter kaydi beklenmeden connect / restore / send /
// signData / disconnect akislarinin TAMAMI gercek uzantiya karsi denenebilir.
//
// SDK SURUMU BILEREK 2.2.0'A SABIT (package.json devDependency). Yukseltilirse
// bu arac SESSIZCE ise yaramaz hale gelir: 3.3.0+ enjekte cuzdan taramaz ve
// sayfa "cuzdan bulunamadi" der -- uzantida bir sey bozuldugu icin DEGIL.
//
// URETIME GIRMEZ: yalnizca devDependency ve yalnizca bu betik kullanir;
// `client/src` altindan bu pakete tek bir import YOKTUR.
//
// DEPODAKI DIGER TEST SAYFASIYLA KARISTIRMA -- ikisi FARKLI katmani sinar:
//   test-dapp/  (npx serve -l 8899)  kopruyu (`window.wats.tonconnect`) DOGRUDAN
//                                    cagirir, hicbir SDK kullanmaz; amaci cuzdanin
//                                    HAM olarak ne dondurdugunu gormek.
//   bu sayfa                         gercek @tonconnect/sdk uzerinden gider; amaci
//                                    "gercek bir dapp bizi BULUR ve KULLANIR mi".
// walletInfo metadata hatasi (app_name/platforms eksikligi) tam olarak SDK
// katmaninda yasiyordu ve test-dapp onu GOREMEZDI.
//
// Adim adim ne denenecegi: docs/ton-elle-tarayici-testleri.md, madde 3.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BURASI = dirname(fileURLToPath(import.meta.url))
const KOK = join(BURASI, '..')
const PORT = Number(process.env.PORT || 4545)
const TABAN = `http://localhost:${PORT}`

const SDK = join(KOK, 'node_modules', '@tonconnect', 'sdk', 'dist', 'tonconnect-sdk.min.js')

// Cuzdan (bizim uzanti) bu manifesti KENDI ceker ve onay ekraninda adresini
// gosterir. `url` alani sayfanin origin'iyle ESLESMELI, yoksa onay ekrani
// "manifest uyusmuyor" uyarisini cizer -- ki o uyarinin CIZILDIGINI gormek de
// asagidaki testlerden biridir.
const MANIFEST = {
    url: TABAN,
    name: 'Wats TonConnect Test',
    iconUrl: 'https://watswallet.com/logo.png',
}

const SAYFA = `<!doctype html>
<meta charset="utf-8">
<title>Wats TonConnect Test</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; background: #0b0b0d; color: #e6e6e8; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  p.alt { margin: 0 0 20px; color: #8b8b93; font-size: 12px; }
  .kutu { background: #131315; border: 1px solid #26262b; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  button { font: inherit; font-weight: 600; padding: 9px 14px; margin: 0 8px 8px 0; border-radius: 8px;
           border: 1px solid #3a3a42; background: #1c1c21; color: #e6e6e8; cursor: pointer; }
  button:hover:not(:disabled) { background: #26262d; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  #durum { font-weight: 700; }
  .ok { color: #34d399 } .no { color: #f87171 } .bekle { color: #fbbf24 }
  pre { background: #0e0e10; border: 1px solid #26262b; border-radius: 8px; padding: 12px;
        max-height: 44vh; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 12px; margin: 0; }
  code { background: #1c1c21; padding: 1px 5px; border-radius: 4px; }
</style>

<h1>Wats TonConnect Test</h1>
<p class="alt">@tonconnect/sdk <b id="surum">2.2.0</b> &middot; bu sayfa kayit defteri kaydi olmadan da enjekte cuzdani bulur</p>

<div class="kutu">
  <div>Cuzdan: <span id="durum" class="bekle">araniyor...</span></div>
  <div style="margin-top:6px;color:#8b8b93;font-size:12px" id="adres"></div>
</div>

<div class="kutu">
  <button id="b-baglan" disabled>1 &middot; Baglan</button>
  <button id="b-kanit" disabled>1b &middot; Baglan (ton_proof ister)</button>
  <button id="b-geri" disabled>2 &middot; Oturumu geri yukle</button>
  <button id="b-gonder" disabled>3 &middot; 0.001 TON gonder (kendine)</button>
  <button id="b-imza" disabled>4 &middot; Veri imzala (text)</button>
  <button id="b-kes" disabled>5 &middot; Baglantiyi kes</button>
  <button id="b-temizle">gunlugu temizle</button>
</div>

<div class="kutu"><pre id="gunluk">hazir.\n</pre></div>

<script src="/sdk.js"></script>
<script>
const G = document.getElementById('gunluk')
const yaz = (etiket, veri) => {
  const t = new Date().toISOString().slice(11, 19)
  G.textContent += '[' + t + '] ' + etiket + (veri === undefined ? '' : ' ' + JSON.stringify(veri, null, 1)) + '\\n'
  G.scrollTop = G.scrollHeight
}
document.getElementById('b-temizle').onclick = () => { G.textContent = '' }

const tc = new TonConnectSDK.TonConnect({ manifestUrl: location.origin + '/tonconnect-manifest.json' })
let cuzdan = null

// EN KRITIK ADIM: cuzdan listeye GIRIYOR mu. walletInfo'da 'name, app_name,
// image, about_url, platforms' alanlarindan BIRI bile eksikse SDK cuzdani
// SESSIZCE eler -- ne hata atar ne konsola bir sey yazar.
async function ara() {
  const hepsi = await tc.getWallets()
  yaz('getWallets() ->', hepsi.map(w => ({ name: w.name, appName: w.appName, jsBridgeKey: w.jsBridgeKey, injected: !!w.injected })))
  cuzdan = hepsi.find(w => w.jsBridgeKey === 'wats')
  const d = document.getElementById('durum')
  if (!cuzdan) {
    d.textContent = 'BULUNAMADI'; d.className = 'no'
    yaz('HATA: "wats" listede yok. window.wats.tonconnect =', typeof window.wats?.tonconnect)
    yaz('walletInfo =', window.wats?.tonconnect?.walletInfo ?? null)
    return
  }
  d.textContent = cuzdan.name + ' bulundu'; d.className = 'ok'
  for (const id of ['b-baglan','b-kanit','b-geri','b-gonder','b-imza','b-kes']) document.getElementById(id).disabled = false
}

tc.onStatusChange((w) => {
  const a = document.getElementById('adres')
  if (w) {
    a.textContent = 'adres: ' + w.account.address + '  |  ag: ' + (w.account.chain === '-239' ? 'mainnet' : w.account.chain)
    yaz('onStatusChange BAGLANDI ->', { address: w.account.address, chain: w.account.chain, device: w.device, proof: !!w.connectItems?.tonProof })
  } else {
    a.textContent = ''
    yaz('onStatusChange BAGLANTI KESILDI')
  }
}, (e) => yaz('onStatusChange HATA ->', String(e)))

const sar = (etiket, fn) => async () => {
  yaz('--- ' + etiket + ' ---')
  try { const r = await fn(); if (r !== undefined) yaz(etiket + ' SONUC ->', r) }
  catch (e) { yaz(etiket + ' HATA -> ' + (e && e.constructor && e.constructor.name) + ': ' + (e && e.message), e && e.code !== undefined ? { code: e.code } : undefined) }
}

document.getElementById('b-baglan').onclick = sar('connect', () => tc.connect({ jsBridgeKey: 'wats' }))
document.getElementById('b-kanit').onclick = sar('connect + ton_proof', () =>
  tc.connect({ jsBridgeKey: 'wats' }, { tonProof: 'wats-test-' + Math.random().toString(36).slice(2, 10) }))
document.getElementById('b-geri').onclick = sar('restoreConnection', () => tc.restoreConnection())
document.getElementById('b-kes').onclick = sar('disconnect', () => tc.disconnect())

document.getElementById('b-gonder').onclick = sar('sendTransaction', () => {
  if (!tc.account) throw new Error('once baglan')
  // KENDINE gonderim: para cuzdandan CIKMAZ, yalnizca ag ucreti yanar.
  return tc.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 300,
    messages: [{ address: tc.account.address, amount: '1000000' }], // 0.001 TON
  })
})

document.getElementById('b-imza').onclick = sar('signData', () => {
  if (!tc.account) throw new Error('once baglan')
  return tc.signData({ type: 'text', text: 'Wats TonConnect test ' + new Date().toISOString() })
})

ara()
</script>
`

const sunucu = createServer((istek, yanit) => {
    const yol = (istek.url || '/').split('?')[0]
    try {
        if (yol === '/sdk.js') {
            yanit.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
            yanit.end(readFileSync(SDK))
            return
        }
        if (yol === '/tonconnect-manifest.json') {
            yanit.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            yanit.end(JSON.stringify(MANIFEST, null, 2))
            return
        }
        yanit.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        yanit.end(SAYFA)
    } catch (hata) {
        yanit.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        yanit.end(String(hata && hata.message))
    }
})

sunucu.listen(PORT, () => {
    console.log('')
    console.log('  TonConnect test sayfasi:  ' + TABAN)
    console.log('')
    console.log('  1. Uzantinin GUNCEL surumunu yukle:  chrome://extensions > Paketlenmemis ogeyi yukle > client/dist')
    console.log('  2. Uzantiyi yeniden yuklediysen bu sekmeyi F5 ile YENILE')
    console.log('     (aksi halde icerik betigi oksuz kalir ve istekler cevapsiz doner)')
    console.log('  3. Cuzdanin kilidini AC -- kilitliyken onay penceresi acilmaz')
    console.log('')
})

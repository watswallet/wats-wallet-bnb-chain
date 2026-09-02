// CHAIN_CONFIG'deki her kaydi zincirden dogrular.
//
// Calistirma:  cd client && npm run verify:routers
// Tek zincir:  cd client && npm run verify:routers -- 137
//
// Basarisiz kayit varsa cikis kodu 1'dir. Yeni bir ag eklendiginde bu betik
// gecmeden config'e girmez.
import { ethers } from 'ethers'
import { CHAIN_CONFIG } from '../src/utils/swapChains.js'
import { feeTiersFor } from '../src/utils/swapRoutes.js'
import chains from '../src/data/supported_chains.json' with { type: 'json' }

const SEL_DEADLINE = ethers.id('exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))').slice(2, 10)
const SEL_NO_DEADLINE = ethers.id('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))').slice(2, 10)

const V2_ROUTER = ['function factory() view returns (address)', 'function getAmountsOut(uint,address[]) view returns (uint[])']
const V3_ROUTER = ['function factory() view returns (address)']
const FACTORY = ['function getPair(address,address) view returns (address)']
const PAIR = ['function getReserves() view returns (uint112,uint112,uint32)']
const ERC20 = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)']
const Q1 = ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) returns (uint256)']
const Q2 = ['function quoteExactInputSingle((address,address,uint256,uint24,uint160)) returns (uint256,uint160,uint32,uint256)']

const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// p.getCode(...) diger tum ag cagrilari gibi try/catch icinde olmali: aksi halde
// gecici bir RPC hatasi betigi yakalanmamis istisnayla cokertir, "problems" raporuna
// hic girmeden — cikis kodu yine 1 olur ama betigin KENDI raporlama yolundan degil.
// null donusu "bilinmiyor" demektir; "kontrat degil" (code==='0x') ile KARISTIRILMAZ,
// cunku ikisi farkli gercekleri temsil eder — cagiran taraf null'i ayri ele alir.
async function safeGetCode(p, addr, problems, prefix) {
  try {
    return await p.getCode(addr)
  } catch (e) {
    problems.push(`${prefix} kontrol edilemedi — RPC hatasi: ${e.shortMessage || e.message}`)
    return null
  }
}

async function providerFor(chainId) {
  const entry = chains.find(c => c.chainId === Number(chainId))
  for (const rpc of entry.rpc) {
    try {
      const p = new ethers.JsonRpcProvider(rpc.url, undefined, { staticNetwork: true })
      await p.getBlockNumber()
      return p
    } catch { /* siradaki RPC */ }
  }
  throw new Error(`chainId ${chainId} icin calisan RPC yok`)
}

const only = process.argv[2] ? [Number(process.argv[2])] : Object.keys(CHAIN_CONFIG).map(Number)
let failed = 0
let checked = 0

for (const chainId of only) {
  const cfg = CHAIN_CONFIG[chainId]
  const p = await providerFor(chainId)
  const problems = []

  for (const addr of [cfg.wrappedNative, ...cfg.intermediates]) {
    const code = await safeGetCode(p, addr, problems, addr)
    if (code === null) continue
    if (code === '0x') { problems.push(`${addr} kontrat degil`); continue }
    const t = new ethers.Contract(addr, ERC20, p)
    try { await t.symbol(); await t.decimals() }
    catch { problems.push(`${addr} ERC20 gibi davranmiyor`) }
    await sleep(80)
  }

  for (const dex of cfg.dexes) {
    const label = `${chainId}/${dex.NAME}`
    const addrs = [dex.ROUTER_ADDRESS, dex.FACTORY_ADDRESS, ...(dex.QUOTER_ADDRESS ? [dex.QUOTER_ADDRESS] : [])]
    let dead = false
    for (const a of addrs) {
      const code = await safeGetCode(p, a, problems, `${label}: ${a}`)
      if (code === null) { dead = true; continue }
      if (code === '0x') { problems.push(`${label}: ${a} kontrat degil`); dead = true }
    }
    if (dead) continue

    try {
      const abi = dex.VERSION === 2 ? V2_ROUTER : V3_ROUTER
      const f = await new ethers.Contract(dex.ROUTER_ADDRESS, abi, p).factory()
      if (!eq(f, dex.FACTORY_ADDRESS)) problems.push(`${label}: router.factory()=${f} config ile uyusmuyor`)
    } catch { problems.push(`${label}: router.factory() cagrilamadi`) }

    if (dex.VERSION === 3) {
      const rawCode = await safeGetCode(p, dex.ROUTER_ADDRESS, problems, `${label}: router bytecode`)
      if (rawCode !== null) {
        const code = rawCode.slice(2)
        const wanted = dex.ROUTER_VARIANT === 'no-deadline' ? SEL_NO_DEADLINE : SEL_DEADLINE
        if (!code.includes(wanted)) {
          problems.push(`${label}: ROUTER_VARIANT='${dex.ROUTER_VARIANT}' ama selektor 0x${wanted} bytecode'da yok`)
        }
      }

      let worked = null
      outer:
      for (const stable of cfg.intermediates.slice(1)) {
        for (const fee of feeTiersFor(dex)) {
          const one = ethers.parseEther('1')
          try {
            const o = await new ethers.Contract(dex.QUOTER_ADDRESS, Q1, p)
              .quoteExactInputSingle.staticCall(cfg.wrappedNative, stable, fee, one, 0)
            if (o > 0n) { worked = 1; break outer }
          } catch { /* v1 degil */ }
          try {
            const r = await new ethers.Contract(dex.QUOTER_ADDRESS, Q2, p)
              .quoteExactInputSingle.staticCall([cfg.wrappedNative, stable, one, fee, 0])
            if (r[0] > 0n) { worked = 2; break outer }
          } catch { /* v2 degil */ }
          await sleep(70)
        }
      }
      if (worked === null) problems.push(`${label}: quoter iki imzayla da cikti vermedi`)
      else if (worked !== dex.QUOTER_VERSION) problems.push(`${label}: QUOTER_VERSION=${dex.QUOTER_VERSION} ama olculen ${worked}`)
    } else {
      const factory = new ethers.Contract(dex.FACTORY_ADDRESS, FACTORY, p)
      const router = new ethers.Contract(dex.ROUTER_ADDRESS, V2_ROUTER, p)
      let ok = false
      for (const stable of cfg.intermediates.slice(1)) {
        try {
          const pair = await factory.getPair(cfg.wrappedNative, stable)
          if (!pair || pair === ethers.ZeroAddress) continue
          const [r0, r1] = await new ethers.Contract(pair, PAIR, p).getReserves()
          if (r0 === 0n || r1 === 0n) continue
          const amounts = await router.getAmountsOut(ethers.parseEther('1'), [cfg.wrappedNative, stable])
          if (amounts[amounts.length - 1] > 0n) { ok = true; break }
        } catch { /* siradaki stable */ }
        await sleep(90)
      }
      if (!ok) problems.push(`${label}: wrapped<->ara token havuzu bulunamadi`)
    }
    await sleep(120)
  }

  if (problems.length) {
    failed += problems.length
    console.log(`\nchainId ${chainId}: ${problems.length} SORUN`)
    for (const p of problems) console.log(`   ${p}`)
  } else {
    console.log(`chainId ${chainId}: ${cfg.dexes.length} DEX, ${cfg.intermediates.length} token — hepsi gecti`)
  }
  checked++
}

console.log(`\n${checked}/${only.length} ag kontrol edildi.`)

if (failed) {
  console.error(`\n${failed} sorun bulundu.`)
  process.exit(1)
}
console.log('\nTum kayitlar dogrulandi.')

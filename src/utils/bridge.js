import axios from 'axios'
import { ethers } from 'ethers'
import supported_chains from '../data/supportedChains'
import { buildCrossChainPendingSkeleton, saveOrUpdateTxInStorage } from './processTransaction';
import { routeRequiresNative } from './atsCommission';
import { isBStock } from './bstocks';

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
]

// API Yapılandırması
const liFiApi = axios.create({
  baseURL: 'https://li.quest/v1',
  timeout: 15000 // 15sn timeout
});

/**
 * 2. Quote Alma Fonksiyonu
 */
async function getCrossChainQuote(params) {
  try {
    const res = await liFiApi.get('/quote', { params })
    return res.data
  } catch (e) {
    console.error('API Error:', e.response?.data || e.message)
    throw new Error(e.response?.data?.message || 'No price quote was available.')
  }
}

async function checkAndApproveToken(tokenAddress, owner, spender, amountRaw, wallet) {
  try {
    if (isNativeToken(tokenAddress)) return;

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    // ÇÖZÜM: Direkt data içerisinden gelen exact raw uint256 kullanıyoruz! 
    // Float rounding error önlendi.
    const amountBigInt = BigInt(amountRaw || "0");

    // Bakiye Kontrolü
    const balance = await tokenContract.balanceOf(owner);
    if (balance < amountBigInt) throw new Error("Insufficient token balance")

    // Allowance Kontrolü
    const currentAllowance = await tokenContract.allowance(owner, spender);
    
    if (currentAllowance < amountBigInt) {
      if (currentAllowance > 0n) {
        try {
            const resetTx = await tokenContract.approve(spender, 0n);
            await resetTx.wait();
        } catch (e) { /* Hata yoksayılabilir */ }
      }

      const tx = await tokenContract.approve(spender, amountBigInt);
      await tx.wait();
    }
  } catch (error) {
    console.error("Approve error:", error);
    throw new Error(`Approve token failed: ${error.message}`);
  }
}

/**
 * 4. Ana Swap Fonksiyonu
 * @param {string} to - Li.Fi Router Contract Adresi
 * @param {string} fromTokenAddress - Satılacak Token Adresi
 * @param {string} data - API'den gelen calldata
 * @param {string} value - API'den gelen hex value (Native miktarı)
 * @param {number} chainId - Kaynak Zincir ID
 * @param {string} privateKey - Cüzdan Private Key
 * @param {string} fromAmount - Gönderilecek Miktar (Wei/Atomic Unit)
 */

export async function crossChainSwap(to, fromTokenAddress, data, value, chainId, privateKey, amountHuman, amountRaw, onProgress = () => {}) {
  try {
    const found = supported_chains.find(chain => chain.chainId === chainId);
    if (!found) throw new Error("Unsupported chain");

    const provider = new ethers.JsonRpcProvider(found.rpc[0].url, {
        chainId: Number(found.chainId),
        name: found.name
    }, { staticNetwork: true });

    const wallet = new ethers.Wallet(privateKey, provider);

    const txValue = BigInt(value || 0);
    const feeData = await provider.getFeeData();
    const currentGasPrice = feeData.maxFeePerGas || feeData.gasPrice || 3000000000n;
    const ESTIMATED_GAS_LIMIT = 500000n;
    const estimatedGasCost = currentGasPrice * ESTIMATED_GAS_LIMIT;

    // Bakiye Kontrolü
    const ethBalance = await provider.getBalance(wallet.address);
    if (ethBalance < (txValue + estimatedGasCost)) throw new Error(`Insufficient balance. ~${ethers.formatEther(estimatedGasCost)} ${found.nativeCurrency.symbol} required for transaction.`)

    // Gonderilen token'in adi. ESKIDEN iskelete sabit 'TOKEN' yaziliyordu ve
    // kopru islemi listede "-12 TOKEN" olarak gorunuyordu.
    //
    // YERI GONDERIMDEN ONCE olmak ZORUNDA: bekleyen satirin kaydi islem
    // firlatildiktan hemen sonra yaziliyor. Sembol cagrisini oraya koymak,
    // gerceklesmis bir kopru isleminin kaydini bir eth_call'un cevabina
    // bagli kilardi (ethers varsayilan istek zaman asimi 300 sn) ve arayuz
    // o sure boyunca "gonderiliyor"da asili kalirdi.
    //
    // FIRLATMASI da YASAK: sembol bir gorunum ayrintisi, kopru islemini
    // durdurmaya degmez.
    let fromSymbol = ''
    try {
      fromSymbol = isNativeToken(fromTokenAddress)
        ? (found.nativeCurrency?.symbol || '')
        : ((await new ethers.Contract(fromTokenAddress, ERC20_ABI, provider).symbol()) || '').trim()
    } catch (symbolError) {
      console.warn('Kopru token sembolu okunamadi:', symbolError.message)
    }

    onProgress({ status: 'APPROVING', message: 'Token harcama izni kontrol ediliyor...' });
    await checkAndApproveToken(fromTokenAddress, wallet.address, to, amountRaw, wallet);

    onProgress({ status: 'ESTIMATING', message: 'Ağ ücretleri hesaplanıyor...' });
    const txRequest = {
      to: to,
      data: data,
      value: txValue,
      from: wallet.address
    };

    let gasLimit;
    try {
      const estimated = await provider.estimateGas(txRequest);
      gasLimit = (estimated * 125n) / 100n; // %25 Buffer
    } catch (gasError) {
      gasLimit = ESTIMATED_GAS_LIMIT;
    }

    const finalTx = {
      ...txRequest,
      gasLimit: gasLimit,
      ...(feeData.maxFeePerGas ? {
          maxFeePerGas: (feeData.maxFeePerGas * 110n) / 100n,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      } : {
          gasPrice: feeData.gasPrice
      })
    };

    onProgress({ status: 'SENDING', message: 'İşlem ağa gönderiliyor...' });
    const txResponse = await wallet.sendTransaction(finalTx);

    const pendingSkeleton = buildCrossChainPendingSkeleton(txResponse, wallet.address, amountHuman, fromTokenAddress, fromSymbol);
    await saveOrUpdateTxInStorage(pendingSkeleton);

    const waitPromise = watchCrossChainResolution(txResponse, pendingSkeleton);

    return {
      hash: txResponse.hash,
      status: 'pending',
      message: 'İşlem başarıyla Mempool\'a eklendi.',
      waitPromise
    };

  } catch (error) {
    console.error("CrossChainSwap Error", error.message);

    if (error.code === 'INSUFFICIENT_FUNDS') throw new Error("Insufficient balance: There are not enough native tokens to pay the transaction fee.")
    if (error.code === 'NONCE_EXPIRED') throw new Error("Transaction sequence error (Nonce).")
    if (error.code === 'ACTION_REJECTED' || error.message.includes('user rejected')) throw new Error("The transaction was rejected by the wallet.")

    if (error.message.includes('CALL_EXCEPTION') || error.message.includes('execution reverted')) {
      const reason = error.reason || "The smart contract transaction was rejected (slippage may be too low).";
      throw new Error(reason);
    }

    throw new Error(error.reason || error.message || "An error occurred while sending the transaction.");
  }
}

async function watchCrossChainResolution(txResponse, skeleton) {
  try {
    // İşlemin bloğa yazılmasını bekle
    const receipt = await txResponse.wait();
    
    // Başarılı! İskeleti güncelle
    skeleton.receipt_status = "1";
    skeleton.block_number = receipt.blockNumber.toString();
    
    const feeWei = receipt.gasUsed * (receipt.effectiveGasPrice || txResponse.gasPrice || 0n);
    skeleton.transaction_fee = ethers.formatEther(feeWei);

    await saveOrUpdateTxInStorage(skeleton);
    return receipt;

  } catch (waitError) {
    // Hızlandırma veya İptal (Speed up / Cancel) durumunu yakala
    if (waitError.code === 'TRANSACTION_REPLACED') {
        if (waitError.receipt && waitError.receipt.status === 1) {
            // İşlem değiştirilerek (hızlandırılarak) onaylandıysa
            const replacedHash = skeleton.hash;
            skeleton.hash = waitError.receipt.hash; // Yeni hash'i al
            skeleton.receipt_status = "1";
            // ESKİ hash de kaldırılır: bırakılırsa sonsuza dek 'pending' kalır ve
            // gölge bakiye köprülenen tutarı kalıcı olarak düşmeye devam eder.
            await saveOrUpdateTxInStorage(skeleton, replacedHash);
            return waitError.receipt;
        }
        if (waitError.reason === 'cancelled') {
            skeleton.receipt_status = "0";
            skeleton.summary = "Cross-Chain Swap (Cancelled)";
            await saveOrUpdateTxInStorage(skeleton);
            throw new Error("Transaction cancelled");
        }
    }

    // Genel Hata Durumu (Reverted)
    console.warn("Cross-chain tx failed or dropped:", waitError);
    skeleton.receipt_status = "0";
    await saveOrUpdateTxInStorage(skeleton);
    throw waitError;
  }
}

// 1. Yardımcı Fonksiyonu Güncelleyin
const isNativeToken = (address) => {
  if (!address) return false;
  const lowerAddr = address.toLowerCase();
  
  return (
    lowerAddr === ethers.ZeroAddress.toLowerCase() || 
    lowerAddr === '0x0' || 
    lowerAddr === '0x0000000000000000000000000000000000000000'
  );
}

// LI.FI'YE GIDEN native YER TUTUCUSU. Cuzdanin ic gosterimi KATI '0x0' (swap.js
// `isNativeToken` tam esitlik yapar), ama LI.FI onu TANIMIYOR — 2026-08-20'de canlida
// olculdu:
//   fromToken=0x0                                  -> "Could not find token '0x0' on chain '137'"
//   fromToken=0x0000000000000000000000000000000000000000 -> OK (POL)
//   fromToken=0xEeee…EEeE                          -> OK (POL)
// Bu dosyadaki eski yorum "0x0 gonderebiliriz, LI.FI kabul eder" diyordu; YANLISTI ve
// yalnizca native varsayilani ekrana gelmedigi icin gorunmuyordu. Varsayilan gelince
// Polygon'da her kopru teklifi bu hatayla oldu.
export const toLifiToken = (address) => (isNativeToken(address) ? ethers.ZeroAddress : address)

// Gonderimsiz: bridge (Li.Fi) approve + ana call uretir. Gasless (UserOp) icin.
// to/data/value: Li.Fi quote.transactionRequest'ten gelir.
//
// `approvalAddress`: Li.Fi `estimate.approvalAddress`. Belge "Swap ve Bridge Komisyonu" §08'e
// gore bu, `transactionRequest.to` ile AYNI cikar — ama VARSAYMIYORUZ: quote acikca soyluyorsa
// onu kullaniyoruz. Yanlis harcayiciya verilen izin, kopruyu izinsiz birakip op'u zincirde
// dusurur.
export async function buildBridgeCalls({
  to, data, value, fromTokenAddress, owner, amountRaw, provider, approvalAddress,
}) {
  // PAYMASTER GAZI ODER, msg.value'yu ODEMEZ — ama bu rotayi ELEMEZ.
  //
  // ONCEKI HALI YANLISTI: `value > 0` olan her rota FAIL-CLOSED eleniyordu. `msg.value`
  // kullanicinin KENDI hesabindan cikar; kullanici zaten o native'i KOPRULUYOR, yani
  // bakiyesi var. Paymaster'in odemedigi tek sey gazdir ve gazi ATS ile odemek bu
  // ozelligin ta kendisi. Swap tarafinda ayni gerekce ZATEN yaziliydi (native girdili
  // swap ENGELLENMEZ); kopru o kuraldan sapiyordu ve native varsayilani ekrana gelince
  // Polygon'da her kopru acilisi bu yasakla karsilasti.
  //
  // GERCEK KOSUL BAKIYEDIR: hesap `value` kadar native tasimali. Tasimiyorsa op zincirde
  // duser ve BSC'de bir bootstrap hakki yanar — bu yuzden burada, IMZADAN ONCE bakilir.
  // Kontrol TEK KAPIDA: hem teklif (atsBridgeFeeQuote) hem gonderim (bridge) ayni
  // fonksiyondan geciyor.
  let requiredValue = 0n
  if (routeRequiresNative({ value })) {
    try {
      requiredValue = BigInt(value)
    } catch {
      // Rotanin degeri okunamiyorsa gonderme: 0 varsaymak op'u zincirde oldururdu.
      const err = new Error('kopru rotasinin native degeri okunamadi; islem gonderilmedi')
      err.code = 'route-value-unreadable'
      throw err
    }
    const balance = await provider.getBalance(owner)
    if (balance < requiredValue) {
      const err = new Error(
        `bu rota ${requiredValue} wei native gerektiriyor; hesabin bakiyesi ${balance}`)
      err.code = 'insufficient-native-for-value'
      throw err
    }
  }

  const calls = []
  if (!isNativeToken(fromTokenAddress)) {
    const spender = approvalAddress || to
    const tokenContract = new ethers.Contract(fromTokenAddress, ERC20_ABI, provider)
    const currentAllowance = await tokenContract.allowance(owner, spender).catch(() => 0n)
    const amountBigInt = BigInt(amountRaw || '0')
    if (currentAllowance < amountBigInt) {
      const iface = new ethers.Interface(['function approve(address,uint256) returns (bool)'])
      // APPROVE-RESET (§05): USDT ve benzeri tokenlar, allowance SIFIR DEGILKEN yeniden
      // approve edilmeyi REDDEDER (require(value == 0 || allowance == 0)). Sifira cekmeden
      // gondermek batch'i o cagrida revert ettirir ve op tumden duser. Kosul dar tutuldu —
      // allowance zaten 0 ise fazladan bir cagri gaz yakmasin.
      if (currentAllowance > 0n) {
        calls.push({
          to: fromTokenAddress, value: 0n,
          data: iface.encodeFunctionData('approve', [spender, 0n]),
        })
      }
      calls.push({
        to: fromTokenAddress, value: 0n,
        data: iface.encodeFunctionData('approve', [spender, ethers.MaxUint256]),
      })
    }
  }
  // DEGER TASINIR: `value: 0n` sabiti native kopruyu sessizce bozardi (op gider, kopru
  // kontrati deger gormedigi icin revert eder).
  calls.push({ to, value: requiredValue, data })
  return calls
}

// Tasinabilir hata (swapRoutes.js'teki LIQUIDITY_GATE_ERROR ile ayni desen).
export const BSTOCK_NOT_BRIDGEABLE = 'Tokenized stocks cannot be bridged'

export default async function bridgeQuote(fromChain, toChain, inToken, outToken, amount, filter, slippage, privateKey) {
  try {
    // bSTOCK KAPISI - HER SEYDEN ONCE, hicbir ag cagrisi yapilmadan.
    //
    // NEDEN VAR: gosterim yolu bStock'ta UI birimine gecti (useTokenBalance ->
    // balanceOfUI) ama bu dosyadaki harcama yolu HAM birimde. Ikisi ayni birimde
    // OLMAK ZORUNDA; yoksa MAX ile kopru ham bakiyeyi asar ve `Insufficient token
    // balance` ile duser, MAX altinda ise carpan kadar FAZLA token koprulenir.
    //
    // ASIMETRI CEVIRMEKLE DEGIL DISLAMAKLA kapatildi. Gerekce spec'in kendi
    // tespiti: "bStocks kovada oldugu icin secicide gorunur, LI.FI ROTA BULAMAZ,
    // akis hatayla biter." Yani kopru bu tokenler icin zaten calismayan bir yol;
    // calismayan bir yol icin cevrim makinesi kurup her kopru teklifine bir
    // uiMultiplier() okumasi eklemek, hem olu koda hem de yeni bir hata yuzeyine
    // mal olurdu. Uygulanabilir tek anlam "DEX'te sat, geliri koprule" olurdu ki
    // bu kullaniciya hic anlatilmayan BASKA bir islemdir.
    //
    // Kapi BURADA (secicideki filtrenin yaninda DEGIL, ona EK olarak): token
    // `crypto.bridge.inToken`a baska bir yoldan da girebilir (token detayindaki
    // Kopru butonu Task 10'a kadar acik, eski oturumdan kalan secim, vb.).
    // Teklif olmadan gonderim de olmaz -- Bridge.vue `bridgeData` yokken gonderemez.
    if (isBStock(fromChain, inToken?.address)) {
      throw new Error(`${BSTOCK_NOT_BRIDGEABLE}: ${inToken?.address}`)
    }

    const found = supported_chains.find(chain => chain.chainId === fromChain)
    if (!found) throw new Error("Unsupported chain")

    const provider = new ethers.JsonRpcProvider(found.rpc[0].url)    
    // Decimal bulma
    let decimals = 18;

    // HATA BURADAYDI: Ethers v6 "0x0" adresini Contract'a verirseniz patlar.
    // Önce adresin native olup olmadığını kontrol ediyoruz.
    if (!isNativeToken(inToken.address)) {
      // Eğer Native DEĞİLSE, bu geçerli bir Contract adresidir.
      // Ethers'a vermeden önce adresin geçerli olup olmadığını da kontrol edebiliriz:
      if (ethers.isAddress(inToken.address)) {
        const tokenContract = new ethers.Contract(inToken.address, ERC20_ABI, provider);
        decimals = await tokenContract.decimals();
      } else {
        console.warn("Invalid token address, default decimal (18) is being used:", inToken.address);
      }
    }

    // Miktarı hesapla (String -> BigInt)
    // Eğer decimals alınamadıysa varsayılan 18 ile devam eder
    const fromAmountBigInt = ethers.parseUnits(String(amount), decimals);
    
    const wallet = new ethers.Wallet(privateKey, provider);

    const quoteParams = {
      fromChain,
      toChain,
      // Native taraf LI.FI'nin bekledigi yer tutucuya cevrilir (bkz. toLifiToken).
      // IKISI DE gecer: native->native kopru rotalarinda hedef taraf da '0x0' olabiliyor.
      fromToken: toLifiToken(inToken.address),
      toToken: toLifiToken(outToken.address),
      fromAddress: wallet.address,
      toAddress: wallet.address,
      fromAmount: fromAmountBigInt.toString(),
      slippage: slippage / 100,
      order: filter,
      integrator: "wats-bridge",
      // INTEGRATOR FEE KALDIRILDI — belge "Swap ve Bridge Komisyonu" §08.
      //
      // Ucret ATS komisyonuna tasindi (op basina sabit, USD'ye sabitli, backend'in kendi
      // router listesinden tespit edilir). LI.FI tarafinda AYRICA `fee: 0.005` kesmek CIFT
      // UCRETLENDIRME olur: kullanici hem koprude %0,5 oder hem de ATS komisyonunu.
      // `integrator` KALIR — o bir ucret degil, kimlik alanidir (LI.FI tarafinda hacim
      // atfi ve destek icin gerekli).
    };

    const quote = await getCrossChainQuote(quoteParams);
    return quote;

  } catch (e) {
    console.error("BridgeQuote Hatası:", e.message);
    throw e;
  }
}
import { ethers } from "ethers"
import { withStorageList, PENDING_TRANSACTIONS } from "./txStorage"

export function buildPendingSkeleton(txResponse, msgData, userAddress) {
    const isERC20 = txResponse.data && txResponse.data.startsWith('0xa9059cbb')
    const amountStr = msgData.amount ? msgData.amount.toString() : "0"
    
    const asset = msgData.assetData || {} 

    let estimatedFeeEth = null
    try {
        if (txResponse.gasLimit && (txResponse.gasPrice || txResponse.maxFeePerGas)) {
            const limit = BigInt(txResponse.gasLimit)
            const price = BigInt(txResponse.gasPrice || txResponse.maxFeePerGas)
            estimatedFeeEth = ethers.formatEther(limit * price)
        }
    } catch (e) {
        console.warn("Estimated fee calculation error", e)
    }

    const skeleton = {
        "hash": txResponse.hash,
        "nonce": txResponse.nonce.toString(),
        "from_address": txResponse.from.toLowerCase(),
        "to_address": txResponse.to ? txResponse.to.toLowerCase() : null,
        "value": txResponse.value.toString(),
        "gas": txResponse.gasLimit.toString(),
        "gas_price": txResponse.gasPrice ? txResponse.gasPrice.toString() : (txResponse.maxFeePerGas ? txResponse.maxFeePerGas.toString() : "0"),
        // Diger uc iskelet kurucusu bunu koyuyordu, bu koymuyordu: golge bakiyenin
        // "gas ucreti native bakiyeden duser" dali en sik islem turunde hic
        // calismiyordu, yani gonderilen tutar dusuluyor ama gas payi ayrilmiyordu.
        "transaction_fee": estimatedFeeEth,
        "receipt_status": "pending",
        "block_timestamp": new Date().toISOString(),
        "erc20_transfers": [],
        "native_transfers": [],
        "summary": `Sending ${amountStr} ${asset.symbol ? asset.symbol.toUpperCase() : (isERC20 ? 'Tokens' : 'ETH/BNB')}`,
        "category": isERC20 ? "token send" : "native send"
    }

    // ADRES PENCERESI DOGRULANIR, yalnizca OLCULMEZ. Cagri verisi DAPP'TEN geliyor
    // ve dogrulanmis degil (Dapp.vue cozumleyemedigi veriyi HAM haliyle geciriyor):
    // kisa ya da hex OLMAYAN bir govdede `data.substring(34, 74)` bos/copluk
    // donuyor ve Gecmis satirina duz "0x" gibi anlamsiz bir "alici" yaziliyordu.
    // Cozulemeyince bacak HIC yazilmaz: bos liste "bilmiyoruz" der, uydurma bir
    // adres ise bir sey OLDUGUNU iddia eder. Arka plandaki addressParam ile AYNI
    // kural (background.js) -- iki yer ayni girdiye ayni cevabi vermeli.
    const erc20Alici = isERC20 && /^0{24}([0-9a-fA-F]{40})$/.test(txResponse.data.substring(10, 74))
        ? '0x' + txResponse.data.substring(34, 74)
        : null

    if (isERC20 && erc20Alici) {
        skeleton.erc20_transfers.push({
            "from_address": txResponse.from.toLowerCase(),
            "to_address": erc20Alici,
            "value_formatted": amountStr,
            "direction": "send",
            "token_address": txResponse.to.toLowerCase(),
            // 🔥 YENİ: Vue'dan gelen verileri Moralis/API standartlarına uygun dolduruyoruz
            "token_name": asset.name || "Unknown Token",
            "token_symbol": asset.symbol ? asset.symbol.toUpperCase() : "TOKEN",
            "token_decimals": asset.decimals ? asset.decimals.toString() : "18",
            "token_logo": asset.logoURI || (asset.image ? asset.image.small : null)
        })
    } else if (!isERC20) {
        skeleton.native_transfers.push({
            "from_address": txResponse.from.toLowerCase(),
            "to_address": txResponse.to ? txResponse.to.toLowerCase() : null,
            "value_formatted": amountStr,
            "direction": "send"
        })
    }
    // isERC20 AMA adres cozulemedi: HICBIR bacak yazilmaz. Native dalina dusmek,
    // `txResponse.to`yu (yani TOKEN KONTRATINI) alici diye yazmak olurdu -- "0x"ten
    // daha da kotusu, cunku gecerli bir adres gibi gorunur.

    return skeleton
}

// Yer tutucu sembol YAZMAMAK icin tek kapi.
//
// KOK NEDEN: bu dosya token sembolu yerine sabit 'INPUT' / 'OUTPUT' / 'TOKEN'
// yaziyordu (kaynakta "TODO: Gercek sembol" notlariyla). Takas onaylanip API'den
// gercek satir gelene kadar kullanici aktivite listesinde "+120,5 OUTPUT" goruyor
// ve YANLIS token takas ettigini sanabiliyordu.
//
// Cozulemeyen sembolde BOS dize donulur, uydurma bir ad DEGIL: birimsiz bir sayi
// durust, yanlis birimli bir sayi yalandir.
//
// ICTEKI BOSLUKLAR DA SILINIR ve bu SART: sembol ZINCIRDEN geliyor (ERC20
// `symbol()`), yani ne uzunlugu ne icerigi guvenilir. Asagidaki `summary`
// bosluklarla kuruluyor ve History.vue onu bosluktan bolup p[2]/p[5]'i token
// adi sayiyor -- "US DT" gibi TEK bir ic bosluk, satirin basligini
// "Takas: US -> 2.0" gibi tamamen yanlis bir seye cevirir.
//
// Uzunluk da kirpilir: 200 karakterlik bir "sembol" hem satiri tasirir hem
// ozeti kullanilamaz hale getirir.
const SEMBOL_MAX = 16

function cleanSymbol(symbol) {
    if (typeof symbol !== 'string') return ''
    return symbol.replace(/\s+/g, '').slice(0, SEMBOL_MAX)
}

export function buildSwapPendingSkeleton({ txResponse, wallet, inputToken, outputToken, amountHumanReadable, outputAmountHuman, inputSymbol, outputSymbol }) {
    // Tahmini fee hesapla
    let estimatedFee = null;
    if (txResponse.gasLimit && (txResponse.gasPrice || txResponse.maxFeePerGas)) {
        const limit = BigInt(txResponse.gasLimit);
        const price = BigInt(txResponse.gasPrice || txResponse.maxFeePerGas);
        estimatedFee = ethers.formatEther(limit * price);
    }

    return {
        hash: txResponse.hash,
        nonce: txResponse.nonce.toString(),
        from_address: wallet.address.toLowerCase(),
        to_address: txResponse.to.toLowerCase(), // Router adresi
        receipt_status: "pending",
        block_timestamp: new Date().toISOString(),
        transaction_fee: estimatedFee,
        category: "token swap",
        // Iki sembol de biliniyorsa "Swap {tutar} {A} to {tutar} {B}" bicimi kurulur.
        // Bu bicim RASTGELE degil: History.vue'nun swap_detail ayristiricisi ozeti
        // bosluktan bolup p[2] ve p[5]'i token adi olarak okuyor. Sembol eksikken
        // ayni bicimi kurmak ayristiriciya BOS bir token adi verirdi, bu yuzden o
        // durumda daha kisa (ve ayristiricinin yedege dustugu) bicim yazilir.
        summary: cleanSymbol(inputSymbol) && cleanSymbol(outputSymbol)
            ? `Swap ${amountHumanReadable} ${cleanSymbol(inputSymbol)} to ${outputAmountHuman} ${cleanSymbol(outputSymbol)}`
            : `Swap ${amountHumanReadable} to ${outputAmountHuman}`,
        // UI'da "Gönderilen" ve "Alınan" olarak göstermek için iki transfer objesi
        erc20_transfers: [
            {
                direction: "send",
                token_symbol: cleanSymbol(inputSymbol),
                token_address: inputToken.toLowerCase(),
                value_formatted: amountHumanReadable
            },
            {
                direction: "receive",
                token_symbol: cleanSymbol(outputSymbol),
                token_address: outputToken.toLowerCase(),
                value_formatted: outputAmountHuman // Beklenen (Slippage hariç) tutar
            }
        ]
    }
}

export function buildCrossChainPendingSkeleton(txResponse, walletAddress, fromAmount, tokenAddress, fromSymbol) {
    let estimatedFeeEth = null;
    try {
        if (txResponse.gasLimit && (txResponse.gasPrice || txResponse.maxFeePerGas)) {
            const limit = BigInt(txResponse.gasLimit);
            const price = BigInt(txResponse.gasPrice || txResponse.maxFeePerGas);
            estimatedFeeEth = ethers.formatEther(limit * price);
        }
    } catch (e) {}

    return {
        hash: txResponse.hash,
        nonce: txResponse.nonce.toString(),
        from_address: walletAddress.toLowerCase(),
        to_address: txResponse.to.toLowerCase(), // Bridge/Router Contrat Adresi
        receipt_status: "pending",
        block_timestamp: new Date().toISOString(),
        transaction_fee: estimatedFeeEth,
        category: "bridge", // veya "cross chain swap"
        summary: `Cross-Chain Swap Initiated`,
        // Köprüleme işlemlerinde giden miktarı kaydetmek faydalıdır
        erc20_transfers: [
            {
                direction: "send",
                token_symbol: cleanSymbol(fromSymbol),
                token_address: tokenAddress ? tokenAddress.toLowerCase() : null,
                value_formatted: fromAmount ? fromAmount.toString() : "0"
            }
        ],
        native_transfers: []
    };
}

export function buildApprovePendingSkeleton(txResponse, walletAddress, tokenAddress, spenderAddress) {
    let estimatedFeeEth = null;
    try {
        if (txResponse.gasLimit && (txResponse.gasPrice || txResponse.maxFeePerGas)) {
            const limit = BigInt(txResponse.gasLimit);
            const price = BigInt(txResponse.gasPrice || txResponse.maxFeePerGas);
            estimatedFeeEth = ethers.formatEther(limit * price);
        }
    } catch (e) {}

    return {
        hash: txResponse.hash,
        nonce: txResponse.nonce.toString(),
        from_address: walletAddress.toLowerCase(),
        to_address: tokenAddress.toLowerCase(), // İzni verdiğimiz tokenin kontrat adresi
        receipt_status: "pending",
        block_timestamp: new Date().toISOString(),
        transaction_fee: estimatedFeeEth,
        category: "approve", // Kategori Approve
        summary: `Approve Token Limit`,
        method_label: "Approve", // Vue tarafında rozette (badge) görünecek
        erc20_transfers: [], // Token transferi yok
        native_transfers: [] // ETH transferi yok
    };
}

export async function watchTransactionResolution(txResponse, skeleton) {
    try {
        const receipt = await txResponse.wait()

        skeleton.receipt_status = receipt.status.toString()
        skeleton.block_number = receipt.blockNumber.toString()
        skeleton.block_hash = receipt.blockHash
        skeleton.transaction_index = receipt.index.toString()
        skeleton.receipt_gas_used = receipt.gasUsed.toString()
        skeleton.receipt_cumulative_gas_used = receipt.cumulativeGasUsed.toString()
        
        const feeWei = receipt.gasUsed * (receipt.effectiveGasPrice || txResponse.gasPrice || 0n)
        skeleton.transaction_fee = ethers.formatEther(feeWei)

        await saveOrUpdateTxInStorage(skeleton)
        return receipt;

    } catch (error) {
        console.warn(`watchTransactionResolution error`, error)
        skeleton.receipt_status = "0"
        await saveOrUpdateTxInStorage(skeleton)
        throw error;
    }
}

/**
 * Bekleyen islemi kaydeder veya GUNCELLER.
 *
 * Eskiden ayni hash bulundugunda kayit siliniyor, yerine yenisi KONMUYORDU: yani
 * her ikinci cagri bir guncelleme degil bir silmeydi. watchTransactionResolution'in
 * ozenle doldurdugu receipt_status / block_number / gasUsed / transaction_fee
 * bilgisinin tamami cope gidiyor, onaylanan islem gecmisten kayboluyordu.
 *
 * Cozulmus kayitlarin listede kalmasi artik guvenli: golge bakiye receipt_status'a
 * bakiyor (utils/pendingTransactions.js), dolayisiyla onaylanmis bir kayit bakiyeden
 * tekrar dusulmuyor.
 *
 * @param {object} txData
 * @param {string} [replacesHash] Hizlandirma/iptal ile degisen ESKI hash. Verilirse
 *   o kayit kaldirilir; aksi halde eski hash sonsuza dek 'pending' kalir ve golge
 *   bakiye o tutari kalici olarak duser.
 */
export async function saveOrUpdateTxInStorage(txData, replacesHash) {
    await withStorageList(PENDING_TRANSACTIONS, (pending_transactions) => {
        let list = pending_transactions

        if (replacesHash && replacesHash !== txData.hash) {
            list = list.filter(tx => tx.hash !== replacesHash)
        }

        const existingIndex = list.findIndex(tx => tx.hash === txData.hash)

        if (existingIndex !== -1) list[existingIndex] = { ...list[existingIndex], ...txData }
        else list.unshift(txData)

        return list
    })
}
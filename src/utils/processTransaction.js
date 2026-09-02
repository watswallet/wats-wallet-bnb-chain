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

    if (isERC20) {
        skeleton.erc20_transfers.push({
            "from_address": txResponse.from.toLowerCase(),
            "to_address": "0x" + txResponse.data.substring(34, 74),
            "value_formatted": amountStr,
            "direction": "send",
            "token_address": txResponse.to.toLowerCase(),
            // 🔥 YENİ: Vue'dan gelen verileri Moralis/API standartlarına uygun dolduruyoruz
            "token_name": asset.name || "Unknown Token",
            "token_symbol": asset.symbol ? asset.symbol.toUpperCase() : "TOKEN",
            "token_decimals": asset.decimals ? asset.decimals.toString() : "18",
            "token_logo": asset.logoURI || (asset.image ? asset.image.small : null)
        })
    } else {
        skeleton.native_transfers.push({
            "from_address": txResponse.from.toLowerCase(),
            "to_address": txResponse.to ? txResponse.to.toLowerCase() : null,
            "value_formatted": amountStr,
            "direction": "send"
        })
    }

    return skeleton
}

export function buildSwapPendingSkeleton({ txResponse, wallet, inputToken, outputToken, amountHumanReadable, outputAmountHuman }) {
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
        summary: `Swap ${amountHumanReadable} for ~${outputAmountHuman}`,
        // UI'da "Gönderilen" ve "Alınan" olarak göstermek için iki transfer objesi
        erc20_transfers: [
            {
                direction: "send",
                token_symbol: "INPUT", // TODO: Gerçek API'den token sembolünü bulup buraya yazabilirsin
                token_address: inputToken.toLowerCase(),
                value_formatted: amountHumanReadable
            },
            {
                direction: "receive",
                token_symbol: "OUTPUT", // TODO: Gerçek sembol
                token_address: outputToken.toLowerCase(),
                value_formatted: outputAmountHuman // Beklenen (Slippage hariç) tutar
            }
        ]
    }
}

export function buildCrossChainPendingSkeleton(txResponse, walletAddress, fromAmount, tokenAddress) {
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
                token_symbol: "TOKEN", // Bunu parametrelerden zenginleştirebilirsin
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
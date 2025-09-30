
const ethers = require('ethers');
const fs = require('fs');
const ObjectsToCsv = require('objects-to-csv');
const { Contract, Provider } = require('@pelith/ethers-multicall');

const provider = new ethers.providers.JsonRpcProvider('https://ethereum-rpc.publicnode.com');
var callProvider = new Provider(provider);

/// ****** CONFIG ****** ///
// If you're getting RPC errors, try lowering the batch size
// or increasing the sleep time between batches

var batchSize = 50;
var sleepTime = 1000; // ms


const llamasNFT = "0xe127cE638293FA123Be79C25782a5652581Db234";
const llamasNFTAbi = [
    {
        "stateMutability":"view",
        "type":"function",
        "name":"ownerOf",
        "inputs":[{"name":"token_id","type":"uint256"}],
        "outputs":[{"name":"","type":"address"}]
    }]

const llamaLocker = "0x99c3f30Bbc9137F6E917B03C74aEd8a4309B3E1b";
const llamaLockerAbi = [{
        "stateMutability": "view",
        "type": "function",
        "inputs": [],
        "name": "getLocks",
        "outputs": [{
            "components":[
                {"internalType":"address","name":"owner","type":"address"},
                {"internalType":"uint256","name":"lockedAt","type":"uint256"},
                {"internalType":"uint256","name":"tokenId","type":"uint256"}
            ],
            "internalType":"struct LlamaLocker.NFTLock[]",
            "name":"results",
            "type":"tuple[]"
        }]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "inputs": [{"internalType": "uint256","name": "tokenId","type": "uint256"}
        ],
        "name": "locks",
        "outputs": [{
            "internalType": "address",
            "name": "owner",
            "type": "address"
        },
        {
            "internalType": "uint256",
            "name": "lockedAt",
            "type": "uint256"
        },
        {
            "internalType": "uint256",
            "name": "tokenId",
            "type": "uint256"
        }]
    },
]

const NFT = new Contract(llamasNFT, llamasNFTAbi);
const Locker = new Contract(llamaLocker, llamaLockerAbi);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {

    await callProvider.init();

    if(process.argv.length < 3) {
        console.log("Use: node snapshot.js blockNumber");
        process.exit();
    }
    targetBlock = Number(process.argv[2]);
    var latestBlock = await provider.getBlockNumber();
    if(targetBlock > latestBlock) {
        console.log("blockNumber exceeds latest block");
        process.exit();
    }

    // check if snapshot already exists
    if(fs.existsSync(`llamasSnapshot_${targetBlock}.json`)) {
        console.log("Snapshot already completed at block "+targetBlock);
        process.exit();
    }

    var owners = {};
    var lockerIds = [];
    // Unlocked NFT holders
    var batches = [];
    var currentBatchSize = 0;
    var callQueue = [];
    // call ownerOf for each tokenId in batches of batchSize, using multicall
    for(var i=0; i<1111; ++i) {
        callQueue.push(NFT.ownerOf(i));
        currentBatchSize++;
        if(currentBatchSize >= batchSize) {
            batches.push(callQueue);
            callQueue = [];
            currentBatchSize = 0;
        }
    }
    if(callQueue.length > 0) {
        batches.push(callQueue);
    }

    for(var i=0; i<batches.length; ++i) {
        console.log(`Processing naked batch ${i+1} of ${batches.length}`);
        var results = await callProvider.all(batches[i], targetBlock);
        for(var j=0; j<results.length; ++j) {
            var owner = results[j];
            if(owner == llamaLocker) {
                lockerIds.push(i*batchSize+j);
            } else {
                if(owners[owner] == undefined) {
                    owners[owner] = {unlocked: 0, locked: 0};
                }
                owners[owner].unlocked++;
            }
        }
        await sleep(sleepTime); // to avoid overloading the RPC
    }
    console.log(`Found ${Object.keys(owners).length} unique unlocked NFT holders`);

    // get locker owners

    batches = [];
    currentBatchSize = 0;
    callQueue = [];
    console.log(lockerIds);
    for(var i in lockerIds) {
        callQueue.push(Locker.locks(lockerIds[i]));
        currentBatchSize++;
        if(currentBatchSize >= batchSize) {
            batches.push(callQueue);
            callQueue = [];
            currentBatchSize = 0;
        }
    }
    if(callQueue.length > 0) {
        batches.push(callQueue);
    }

    var lockers = 0;
    for(var i=0; i<batches.length; ++i) {
        console.log(`Processing locker batch ${i+1} of ${batches.length}`);
        var results = await callProvider.all(batches[i], targetBlock);
        for(var j=0; j<results.length; ++j) {
            var owner = results[j].owner;
            //console.log(owner, lockerIds[i*batchSize+j]);
            if(owners[owner] == undefined) {
                owners[owner] = {unlocked: 0, locked: 0};
            }
            if(owners[owner].locked == 0) { lockers++; }
            owners[owner].locked++;
        }
        await sleep(sleepTime); // to avoid overloading the RPC
    }
    console.log(`Found ${lockers} unique locked holders`);
    

    
    // sort owners by locked
    owners = Object.fromEntries(Object.entries(owners).sort(([,a],[,b]) => b.locked - a.locked));

    // Save to JSON
    await fs.writeFileSync(`llamasSnapshot_${targetBlock}.json`, JSON.stringify(owners, null, 2));
    console.log(`Saved ${Object.keys(owners).length} addresses to llamasSnapshot_${targetBlock}.json`);

    // Save to CSV
    var csvData = [];
    for(const [address, counts] of Object.entries(owners)) {
        csvData.push({address: address, unlocked: counts.unlocked, locked: counts.locked});
    }
    const csv = new ObjectsToCsv(csvData);
    await csv.toDisk(`./llamasSnapshot_${targetBlock}.csv`);
    console.log(`Saved ${csvData.length} addresses to llamasSnapshot_${targetBlock}.csv`);
}

main();
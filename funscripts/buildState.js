// buildState.js
// Fetches Hypermap events, processes them to build the current namespace state,
// filters out incomplete entries, and writes the final state to
// hypermapState_{BLOCKNUMBER}.json.

const fs = require('fs');
const { Web3 } = require('web3'); // Used for RPC calls and utils
const path = require('path'); // Used for IP address formatting
const { Buffer } = require('buffer'); // Used for IP address conversion

// --- Constants ---
const INFURA_URL = 'https://base-mainnet.infura.io/v3/YOURAPIKEY HERE'; // Replace if needed
const CONTRACT_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda';
const START_BLOCK = 27270000; // First block of Hypermap deployment (adjust if needed)
const CHUNK_SIZE = 20000; // User specified chunk size
// const OUTPUT_FILE = 'namespaceState.json'; // Removed constant filename
const ROOT_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// User specified delay
const BASE_DELAY_MS = 1000; // Delay between chunks

// --- COMPLETE ABI ---
// Includes all relevant events defined previously
const CONTRACT_ABI = [
    // Constructor, Errors, Fallback (essential parts)
    { "inputs": [{"internalType":"address","name":"implementation","type":"address"},{"internalType":"bytes","name":"_data","type":"bytes"}], "stateMutability":"payable", "type":"constructor" },
    { "inputs": [{"internalType":"address","name":"target","type":"address"}], "name":"AddressEmptyCode", "type":"error" },
    { "inputs": [{"internalType":"address","name":"implementation","type":"address"}], "name":"ERC1967InvalidImplementation", "type":"error" },
    { "inputs": [], "name":"ERC1967NonPayable", "type":"error" },
    { "inputs": [], "name":"FailedCall", "type":"error" },
    { "stateMutability":"payable", "type":"fallback" },
    // Events
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"parenthash","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"childhash","type":"bytes32"},{"indexed":true,"internalType":"bytes","name":"labelhash","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"label","type":"bytes"}], "name":"Mint", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"parenthash","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"facthash","type":"bytes32"},{"indexed":true,"internalType":"bytes","name":"labelhash","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"label","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"data","type":"bytes"}], "name":"Fact", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"parenthash","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"notehash","type":"bytes32"},{"indexed":true,"internalType":"bytes","name":"labelhash","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"label","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"data","type":"bytes"}], "name":"Note", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"entry","type":"bytes32"},{"indexed":true,"internalType":"address","name":"gene","type":"address"}], "name":"Gene", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"address","name":"zeroTba","type":"address"}], "name":"Zero", "type":"event" }, // Include Zero event from ABI
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":true,"internalType":"uint256","name":"id","type":"uint256"}], "name":"Transfer", "type":"event" },
    // Skip Approval/ApprovalForAll as requested
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"address","name":"implementation","type":"address"}], "name":"Upgraded", "type":"event" } // Keep existing Upgraded event if relevant
];


// --- Initialize Web3 ---
const web3 = new Web3(INFURA_URL);

// --- Prepare ABI Decoding Structures ---
const eventAbis = {}; // Map hash -> full ABI item
const eventSignatures = {}; // Map hash -> signature string for debugging
CONTRACT_ABI.forEach(item => {
  if (item.type === 'event') {
    const signature = `${item.name}(${item.inputs.map(input => input.type).join(',')})`;
    const hash = Web3.utils.keccak256(signature); // Use web3's keccak256
    eventAbis[hash] = item;
    eventSignatures[hash] = signature;
  }
});


// --- Helper Functions ---

function bytesToUtf8Safe(hex) {
  if (!hex || hex === '0x' || hex.length <= 2) { return hex; }
  try {
    const cleanHex = hex.startsWith('0x') ? hex : '0x' + hex;
    return Web3.utils.hexToUtf8(cleanHex);
  } catch (e) { return hex; }
}

function hexToIp(hex) {
    if (!hex || hex.length < 10 || (hex.length !== 10 && hex.length !== 34) ) { return null; }
    try {
        const buffer = Buffer.from(hex.slice(2), 'hex');
        if (buffer.length === 4) { return Array.from(buffer).join('.'); }
        else if (buffer.length === 16) {
            const parts = [];
            for (let i = 0; i < 16; i += 2) { parts.push(buffer.readUInt16BE(i).toString(16)); }
            let ipString = parts.join(':');
             let longestZerosStart = -1, longestZerosLength = 0, currentZerosStart = -1, currentZerosLength = 0;
             const ipParts = ipString.split(':');
             for (let i = 0; i < ipParts.length; i++) {
                 if (ipParts[i] === '0') {
                     if (currentZerosStart === -1) currentZerosStart = i; currentZerosLength++;
                 } else {
                     if (currentZerosLength > longestZerosLength) { longestZerosStart = currentZerosStart; longestZerosLength = currentZerosLength; }
                     currentZerosStart = -1; currentZerosLength = 0;
                 }
             }
              if (currentZerosLength > longestZerosLength) { longestZerosStart = currentZerosStart; longestZerosLength = currentZerosLength; }
             if (longestZerosLength > 1) {
                 ipParts.splice(longestZerosStart, longestZerosLength, '');
                 if (longestZerosStart === 0) ipParts.unshift('');
                 if (longestZerosStart + longestZerosLength === 8) ipParts.push('');
                 ipString = ipParts.join(':');
             }
            return ipString;
        } else { return null; }
    } catch (e) { return null; }
}

function hexToUint(hex) {
  if (!hex || hex === '0x') { return null; }
  try {
    const bigIntValue = BigInt(hex);
    return bigIntValue <= Number.MAX_SAFE_INTEGER ? Number(bigIntValue) : bigIntValue.toString();
  } catch (e) { return null; }
}

function interpretData(label, dataHex) {
    if (!dataHex || dataHex === '0x') { return null; }
    let interpreted = null;
    if (label === '~ip') { interpreted = hexToIp(dataHex); }
    else if (label && label.endsWith('-port')) { if (dataHex.length === 6) { interpreted = hexToUint(dataHex); } }
    else if (label === '~net-key' || label === '~routers') { interpreted = null; }
    if (interpreted === null && label !== '~net-key' && label !== '~routers') {
        const attemptedString = bytesToUtf8Safe(dataHex);
        if (attemptedString !== dataHex && dataHex.length > 2) { interpreted = attemptedString; }
    }
    return interpreted;
}

function tokenIdToNamehash(tokenIdHex) {
    if (!tokenIdHex) return null;
    const hex = tokenIdHex.startsWith('0x') ? tokenIdHex : '0x' + tokenIdHex;
    return '0x' + hex.slice(2).padStart(64, '0');
}


// --- Main Processing Logic ---

(async () => {
  let allRawEvents = [];
  let latestBlockProcessed = START_BLOCK -1; // Track highest block with fetched logs
  let latestBlockChecked; // Track block number checked at start

  // --- Step 1: Fetch All Raw Event Logs ---
  console.log('Starting event fetching...');
  try {
    latestBlockChecked = Number(await web3.eth.getBlockNumber()); // Store the block height we are aiming for
    console.log(`Targeting up to latest block: ${latestBlockChecked}`);

    for (let fromBlock = START_BLOCK; fromBlock <= latestBlockChecked; fromBlock += CHUNK_SIZE) {
      const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockChecked);
      // Note: Console message below uses backticks ``, not single quotes ''
      console.log(`Workspaceing raw logs from blocks ${fromBlock} to ${toBlock}...`); // Corrected console log text
      try {
        const logs = await web3.eth.getPastLogs({
          address: CONTRACT_ADDRESS,
          fromBlock,
          toBlock
        });
        allRawEvents.push(...logs);
        latestBlockProcessed = toBlock; // Update highest block actually containing fetched logs
        // Note: Console message below uses backticks ``, not single quotes ''
        console.log(`Workspaceed ${logs.length} logs in this chunk. Total raw: ${allRawEvents.length}`); // Corrected console log text
      } catch (fetchError) {
         // Simple error handling based on user's script working with these settings
         console.error(`Error fetching logs in range ${fromBlock}-${toBlock}:`, fetchError.message || fetchError);
         console.log(`Waiting ${BASE_DELAY_MS}ms before potentially retrying or moving on...`);
         // No complex retry, just wait as in user's working example
      }
      // Wait between chunks as per user's working example
       await new Promise(res => setTimeout(res, BASE_DELAY_MS));
    }
    console.log(`Finished fetching raw logs. Total fetched: ${allRawEvents.length}. Processed up to block ${latestBlockProcessed}`);
  } catch (error) {
    console.error('Error during event fetching process:', error);
    process.exit(1);
  }

  // --- Step 2: Decode Raw Logs into Structured Events ---
  console.log('Decoding raw logs...');
  const decodedEvents = allRawEvents.map(rawLog => {
        const eventSignatureHash = rawLog.topics[0];
        const eventAbi = eventAbis[eventSignatureHash];

        if (eventAbi) {
            const eventName = eventAbi.name;
            const parameters = {};
            let topicIndex = 1;
            const indexedInputs = eventAbi.inputs.filter(input => input.indexed);
            const nonIndexedInputs = eventAbi.inputs.filter(input => !input.indexed);

            try {
                // Process Indexed Parameters from topics
                indexedInputs.forEach(input => {
                    const topic = rawLog.topics[topicIndex++];
                    if (topic) {
                        if (input.type === 'address') { parameters[input.name] = '0x' + topic.slice(26); }
                        else if (input.type === 'bytes32' || input.type === 'uint256' || input.type === 'bytes') {
                             parameters[input.name] = topic;
                             if (input.type === 'uint256') {
                                 // Attempt to convert known uint256 topic (like in Transfer/Approval) to string
                                 try { parameters[input.name] = Web3.utils.hexToNumberString(topic); } catch (_) {}
                             }
                         }
                        else { parameters[input.name] = topic; }
                    } else { parameters[input.name] = null; }
                });

                // Decode Non-Indexed Parameters from data
                if (nonIndexedInputs.length > 0 && rawLog.data !== '0x') {
                    const decodedData = web3.eth.abi.decodeLog(nonIndexedInputs, rawLog.data, []);
                    nonIndexedInputs.forEach(input => {
                        const value = decodedData[input.name];
                        if (input.type === 'bytes') { parameters[input.name] = value; } // Keep hex
                        else if (typeof value === 'bigint') { parameters[input.name] = value.toString(); }
                        else { parameters[input.name] = value; }
                    });
                } else {
                     nonIndexedInputs.forEach(input => { parameters[input.name] = (input.type === 'bytes') ? '0x' : null; });
                }

                // Return structured event object
                return {
                    eventName: eventName,
                    blockNumber: Number(rawLog.blockNumber),
                    transactionHash: rawLog.transactionHash,
                    logIndex: Number(rawLog.logIndex),
                    parameters: parameters,
                };

            } catch (decodeError) {
                console.error(`Error decoding event ${eventName || 'Unknown'} (sig: ${eventSignatureHash}) at tx ${rawLog.transactionHash}:`, decodeError);
                return null;
            }
        } else {
             return null; // Ignore unknown events
        }
   }).filter(event => event !== null);
  console.log(`Decoded ${decodedEvents.length} relevant events.`);


  // --- Step 3: Sort Decoded Events ---
  console.log('Sorting decoded events...');
  decodedEvents.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber - b.blockNumber;
    }
    return a.logIndex - b.logIndex;
  });

  // --- Step 4: Process Events to Build State ---
  console.log('Processing sorted events to build namespace state...');
  const state = {};
  const nameLookup = { [ROOT_HASH]: { label: '', parentHash: null } };
  state[ROOT_HASH] = { namehash: ROOT_HASH, label: '', parentHash: null, fullName: '', owner: null, gene: null, notes: {}, facts: {}, children: [], creationBlock: 0, lastUpdateBlock: 0 };

  const getOrInitEntry = (hash, blockNum) => {
    if (!state[hash]) {
      state[hash] = { namehash: hash, label: nameLookup[hash]?.label || '', parentHash: nameLookup[hash]?.parentHash || null, fullName: '', owner: null, gene: null, notes: {}, facts: {}, children: [], creationBlock: blockNum, lastUpdateBlock: blockNum };
    }
    state[hash].lastUpdateBlock = Math.max(state[hash].lastUpdateBlock || 0, blockNum);
    return state[hash];
  };

  for (const event of decodedEvents) {
    const { eventName, blockNumber, transactionHash, logIndex, parameters } = event;

     try {
        switch (eventName) {
          case 'Mint': {
            const { parenthash, childhash } = parameters;
            const rawLabelHex = parameters.label; // Already hex string
            const decodedLabel = bytesToUtf8Safe(rawLabelHex);

            nameLookup[childhash] = { label: decodedLabel, parentHash: parenthash };

            const entry = getOrInitEntry(childhash, blockNumber);
            entry.label = decodedLabel;
            entry.parentHash = parenthash;

            let currentHash = childhash; let nameParts = []; let reconstructionOk = true; let depth = 0;
            while (currentHash && currentHash !== ROOT_HASH && depth < 100) {
              const lookup = nameLookup[currentHash];
              if (lookup && typeof lookup.label === 'string') {
                if (lookup.label !== '') nameParts.push(lookup.label);
                currentHash = lookup.parentHash;
              } else { reconstructionOk = false; break; }
              depth++;
            }
            if(depth >= 100 || !reconstructionOk) {
                console.warn(`Name reconstruction failed or too deep for ${childhash} at block ${blockNumber}.`);
                entry.fullName = nameParts.join('.') + (nameParts.length > 0 ? '.' : '') + '<unknown_path>';
                if (entry.fullName === '<unknown_path>') entry.fullName = '';
            } else {
                 entry.fullName = nameParts.join('.');
            }

            const parentEntry = state[parenthash];
            if (parentEntry) {
                 if (!parentEntry.children.includes(childhash)) { parentEntry.children.push(childhash); }
                 parentEntry.lastUpdateBlock = Math.max(parentEntry.lastUpdateBlock || 0, blockNumber);
            } else { console.warn(`Parent entry ${parenthash} not found for child ${childhash} at block ${blockNumber}`); }
            break;
          }

          case 'Note': {
             const { parenthash, notehash, label, data } = parameters; // label/data are hex
             const decodedLabel = bytesToUtf8Safe(label);
             const parentEntry = getOrInitEntry(parenthash, blockNumber);
             const interpretedData = interpretData(decodedLabel, data);
             if (!parentEntry.notes[decodedLabel]) { parentEntry.notes[decodedLabel] = []; }
             parentEntry.notes[decodedLabel].push({ data: interpretedData, rawData: data, blockNumber, txHash: transactionHash, logIndex, notehash });
             parentEntry.notes[decodedLabel].sort((a, b) => b.blockNumber !== a.blockNumber ? b.blockNumber - a.blockNumber : b.logIndex - a.logIndex);
             break;
          }

           case 'Fact': {
             const { parenthash, facthash, label, data } = parameters; // label/data are hex
             const decodedLabel = bytesToUtf8Safe(label);
             const parentEntry = getOrInitEntry(parenthash, blockNumber);
             const interpretedData = interpretData(decodedLabel, data);
             if (!parentEntry.facts[decodedLabel]) { parentEntry.facts[decodedLabel] = []; }
             parentEntry.facts[decodedLabel].push({ data: interpretedData, rawData: data, blockNumber, txHash: transactionHash, logIndex, facthash });
             parentEntry.facts[decodedLabel].sort((a, b) => b.blockNumber !== a.blockNumber ? b.blockNumber - a.blockNumber : b.logIndex - a.logIndex);
             break;
          }

          case 'Transfer': {
            const { from, to, id } = parameters; // id is likely uint256 string representation from hexToNumberString
             let idHex;
            // Convert potential number string from uint256 parameter back to padded hex for namehash
             try {
                  if (typeof id === 'string' && id.startsWith('0x')){
                     idHex = id; // Already hex
                  } else if (typeof id === 'string' || typeof id === 'number') {
                    idHex = '0x' + BigInt(id).toString(16);
                 } else {
                     throw new Error('Invalid ID type');
                 }
             } catch(e) {
                  console.warn(`Invalid tokenId format ${id} at block ${blockNumber}. Skipping Transfer. Error: ${e.message}`);
                  break;
             }

            const namehash = tokenIdToNamehash(idHex); // Convert to bytes32 hex
            if (!namehash) { console.warn(`Could not convert tokenId ${id} -> ${idHex} to namehash at block ${blockNumber}. Skipping Transfer.`); break; }

            const entry = getOrInitEntry(namehash, blockNumber);
            if (from === ZERO_ADDRESS) {
              entry.owner = to;
              if (!entry.creationBlock || entry.creationBlock > blockNumber) entry.creationBlock = blockNumber;
            } else {
              if (entry.owner && entry.owner.toLowerCase() !== from.toLowerCase()) { /* console.warn(...) */ }
              entry.owner = to;
            }
            break;
          }

          case 'Gene': {
            const { entry: entryHash, gene } = parameters;
            const entry = getOrInitEntry(entryHash, blockNumber);
            entry.gene = gene;
            break;
          }
            case 'Zero': {
                // const { zeroTba } = parameters;
                // console.log(`Zero event detected: TBA = ${zeroTba}`);
                break;
            }
             case 'Upgraded': {
                // const { implementation } = parameters;
                // console.log(`Upgraded event detected: Implementation = ${implementation}`);
                break;
             }
        } // End switch
    } catch(eventError) {
         console.error(`Error processing event at block ${blockNumber}, tx ${transactionHash}, logIndex ${logIndex}:`, event, eventError);
    }
  } // End of event loop

  console.log('Finished processing events.');

  // --- Step 5: Filter State ---
  console.log(`Initial state contains ${Object.keys(state).length} entries.`);
  console.log('Filtering out entries with empty or incomplete fullNames (excluding root)...');
  const filteredState = {};
  let removedCount = 0;
  for (const hash in state) {
      if (Object.prototype.hasOwnProperty.call(state, hash)) {
          const entry = state[hash];
          if (hash === ROOT_HASH || (entry.fullName && entry.fullName !== '' && !entry.fullName.includes('<unknown_path>'))) {
              filteredState[hash] = entry;
          } else {
              removedCount++;
          }
      }
  }
  console.log(`Filtered state contains ${Object.keys(filteredState).length} entries. Removed ${removedCount}.`);


  // --- Step 6: Save Final State ---
  // *** Construct dynamic filename using latestBlockProcessed ***
  const finalOutputFilename = `hypermapState_${latestBlockProcessed}.json`;
  console.log(`Writing final namespace state to ${finalOutputFilename}...`); // Use dynamic name in log
  try {
    const jsonString = JSON.stringify(filteredState, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    , 2); // Pretty print
    // *** Use dynamic filename in writeFileSync ***
    fs.writeFileSync(finalOutputFilename, jsonString);
    console.log(`Successfully wrote namespace state to ${finalOutputFilename}.`); // Use dynamic name in log
  } catch (error) {
    console.error(`Error writing ${finalOutputFilename}:`, error); // Use dynamic name in log
    process.exit(1);
  }

})(); // Execute async function
'use client';
import { useState, useCallback } from 'react';
import { Web3 } from 'web3';
import { Buffer } from 'buffer';
import styles from './page.module.css';
import ProgressBar from '../components/ProgressBar';
import NamespaceGraph from '../components/NamespaceGraph';
import {
    bytesToUtf8Safe,
    hexToIp,
    hexToUint,
    interpretData,
    tokenIdToNamehash
} from '../utils/hypermapUtils';

export default function Home() {
  // State for user input
  const [infuraUrl, setInfuraUrl] = useState('');

  // State for tracking indexing process
  const [isIndexing, setIsIndexing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 100, message: 'Idle' });
  const [error, setError] = useState(null);

  // State to hold the final processed namespace data
  const [namespaceState, setNamespaceState] = useState(null); // Initially null

  // State for selected node details (for later inspection)
  const [selectedNodeData, setSelectedNodeData] = useState(null);

  // Constants
  const CONTRACT_ADDRESS = '0x000000000044C6B8Cb4d8f0F889a3E47664EAeda';
  const START_BLOCK = 27270000; // Maybe make this configurable later?
  const CHUNK_SIZE = 20000; // Use 20,000 blocks per request as specified
  const DELAY_MS = 1000; // 1 second delay between requests
  const ROOT_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  const CONTRACT_ABI = [
    { "inputs": [{"internalType":"address","name":"implementation","type":"address"},{"internalType":"bytes","name":"_data","type":"bytes"}], "stateMutability":"payable", "type":"constructor" },
    { "inputs": [{"internalType":"address","name":"target","type":"address"}], "name":"AddressEmptyCode", "type":"error" },
    { "inputs": [{"internalType":"address","name":"implementation","type":"address"}], "name":"ERC1967InvalidImplementation", "type":"error" },
    { "inputs": [], "name":"ERC1967NonPayable", "type":"error" },
    { "inputs": [], "name":"FailedCall", "type":"error" },
    { "stateMutability":"payable", "type":"fallback" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"parenthash","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"childhash","type":"bytes32"},{"indexed":true,"internalType":"bytes","name":"labelhash","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"label","type":"bytes"}], "name":"Mint", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"parenthash","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"facthash","type":"bytes32"},{"indexed":true,"internalType":"bytes","name":"labelhash","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"label","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"data","type":"bytes"}], "name":"Fact", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"parenthash","type":"bytes32"},{"indexed":true,"internalType":"bytes32","name":"notehash","type":"bytes32"},{"indexed":true,"internalType":"bytes","name":"labelhash","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"label","type":"bytes"},{"indexed":false,"internalType":"bytes","name":"data","type":"bytes"}], "name":"Note", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"bytes32","name":"entry","type":"bytes32"},{"indexed":true,"internalType":"address","name":"gene","type":"address"}], "name":"Gene", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"address","name":"zeroTba","type":"address"}], "name":"Zero", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":true,"internalType":"uint256","name":"id","type":"uint256"}], "name":"Transfer", "type":"event" },
    { "anonymous":false, "inputs":[{"indexed":true,"internalType":"address","name":"implementation","type":"address"}], "name":"Upgraded", "type":"event" }
  ];

  const handleStartIndexing = async () => {
    console.log("Start Indexing clicked with URL:", infuraUrl);
    if (!infuraUrl) {
      setError("Please enter an Infura URL.");
      return;
    }
    setError(null);
    setNamespaceState(null);
    setIsIndexing(true);
    setProgress({ current: 0, total: 100, message: 'Initializing...' });
    setSelectedNodeData(null); // Clear selected node

    // Use a try...catch block for the whole process
    try {
        // --- Initialization ---
        const web3 = new Web3(infuraUrl);

        const eventAbis = {};
        const eventSignatures = {};
        CONTRACT_ABI.forEach(item => { 
          if (item.type === 'event') { 
            const signature = `${item.name}(${item.inputs.map(input => input.type).join(',')})`;
            const hash = Web3.utils.keccak256(signature);
            eventAbis[hash] = item;
            eventSignatures[hash] = signature;
          } 
        });

        let allRawEvents = [];
        let latestBlockProcessed = START_BLOCK - 1;
        let latestBlockChecked;

        // --- Step 1: Fetch Logs ---
        console.log('Starting event fetching...');
        setProgress(prev => ({ ...prev, message: 'Fetching latest block...' }));
        await new Promise(res => setTimeout(res, 0)); // Allow UI update

        latestBlockChecked = Number(await web3.eth.getBlockNumber());
        console.log(`Targeting up to latest block: ${latestBlockChecked}`);
        setProgress(prev => ({ ...prev, total: latestBlockChecked, message: 'Starting fetch...' }));
        await new Promise(res => setTimeout(res, 0));

        for (let fromBlock = START_BLOCK; fromBlock <= latestBlockChecked; fromBlock += CHUNK_SIZE) {
            const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockChecked);
            // Update progress before fetch attempt
            setProgress(prev => ({ ...prev, current: fromBlock, message: `Processing blocks ${fromBlock} - ${toBlock}` }));
            // Yield control slightly for UI responsiveness, especially before network calls
            await new Promise(res => setTimeout(res, 10));

            try {
                console.log(`Processing raw logs from blocks ${fromBlock} to ${toBlock}...`);
                const logs = await web3.eth.getPastLogs({ address: CONTRACT_ADDRESS, fromBlock, toBlock });
                allRawEvents.push(...logs);
                latestBlockProcessed = toBlock;
                console.log(`Processed ${logs.length} logs. Total raw: ${allRawEvents.length}`);
            } catch (fetchError) {
                console.error(`Error fetching logs in range ${fromBlock}-${toBlock}:`, fetchError);
                // Basic error handling for client-side: show error and stop
                throw new Error(`Failed to fetch logs around block ${fromBlock}: ${fetchError.message || fetchError}`);
                // Note: No complex retry logic here for the demo
            }
            
            // Wait between chunks as specified (1 second)
            await new Promise(res => setTimeout(res, DELAY_MS));
        }
        console.log(`Finished fetching raw logs. Total fetched: ${allRawEvents.length}.`);
        setProgress(prev => ({ ...prev, current: latestBlockChecked, message: 'Decoding events...' }));
        await new Promise(res => setTimeout(res, 0));

        // --- Step 2: Decode ---
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
                  indexedInputs.forEach(input => {
                      const topic = rawLog.topics[topicIndex++];
                      if (topic) {
                          if (input.type === 'address') {
                              parameters[input.name] = '0x' + topic.slice(26);
                          } else if (input.type === 'bytes32' || input.type === 'uint256' || input.type === 'bytes') {
                              parameters[input.name] = topic;
                              if (input.type === 'uint256') {
                                  try {
                                      parameters[input.name] = Web3.utils.hexToNumberString(topic);
                                  } catch (_) {}
                              }
                          } else {
                              parameters[input.name] = topic;
                          }
                      } else {
                          parameters[input.name] = null;
                      }
                  });
                  if (nonIndexedInputs.length > 0 && rawLog.data !== '0x') {
                      const decodedData = web3.eth.abi.decodeLog(nonIndexedInputs, rawLog.data, []);
                      nonIndexedInputs.forEach(input => {
                          const value = decodedData[input.name];
                          if (input.type === 'bytes') {
                              parameters[input.name] = value;
                          } else if (typeof value === 'bigint') {
                              parameters[input.name] = value.toString();
                          } else {
                              parameters[input.name] = value;
                          }
                      });
                  } else {
                      nonIndexedInputs.forEach(input => {
                          parameters[input.name] = (input.type === 'bytes') ? '0x' : null;
                      });
                  }
                  return {
                      eventName: eventName,
                      blockNumber: Number(rawLog.blockNumber),
                      transactionHash: rawLog.transactionHash,
                      logIndex: Number(rawLog.logIndex),
                      parameters: parameters
                  };
              } catch (decodeError) {
                  console.error(`Error decoding event ${eventName || 'Unknown'} (sig: ${eventSignatureHash}) at tx ${rawLog.transactionHash}:`, decodeError);
                  return null;
              }
          } else {
              return null;
          }
        }).filter(event => event !== null);
        console.log(`Decoded ${decodedEvents.length} relevant events.`);
        setProgress(prev => ({ ...prev, message: 'Sorting events...' }));
        await new Promise(res => setTimeout(res, 0));

        // --- Step 3: Sort ---
        console.log('Sorting decoded events...');
        decodedEvents.sort((a, b) => { 
          if (a.blockNumber !== b.blockNumber) { 
            return a.blockNumber - b.blockNumber; 
          } 
          return a.logIndex - b.logIndex; 
        });
        setProgress(prev => ({ ...prev, message: 'Processing state...' }));
        await new Promise(res => setTimeout(res, 0));

        // --- Step 4: Process State ---
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

        let processedCount = 0;
        for (const event of decodedEvents) {
            try { 
              switch (event.eventName) { 
                case 'Mint': {
                  const { parenthash, childhash } = event.parameters;
                  const rawLabelHex = event.parameters.label;
                  const decodedLabel = bytesToUtf8Safe(rawLabelHex);
                  
                  nameLookup[childhash] = { label: decodedLabel, parentHash: parenthash };
                  
                  const entry = getOrInitEntry(childhash, event.blockNumber);
                  entry.label = decodedLabel;
                  entry.parentHash = parenthash;
                  
                  let currentHash = childhash; 
                  let nameParts = [];
                  let reconstructionOk = true;
                  let depth = 0;
                  
                  while (currentHash && currentHash !== ROOT_HASH && depth < 100) {
                    const lookup = nameLookup[currentHash];
                    if (lookup && typeof lookup.label === 'string') {
                      if (lookup.label !== '') nameParts.push(lookup.label);
                      currentHash = lookup.parentHash;
                    } else { 
                      reconstructionOk = false; 
                      break; 
                    }
                    depth++;
                  }
                  
                  if(depth >= 100 || !reconstructionOk) {
                    console.warn(`Name reconstruction failed or too deep for ${childhash} at block ${event.blockNumber}.`);
                    entry.fullName = nameParts.join('.') + (nameParts.length > 0 ? '.' : '') + '<unknown_path>';
                    if (entry.fullName === '<unknown_path>') entry.fullName = '';
                  } else {
                    entry.fullName = nameParts.join('.');
                  }
                  
                  const parentEntry = state[parenthash];
                  if (parentEntry) {
                    if (!parentEntry.children.includes(childhash)) {
                      parentEntry.children.push(childhash);
                    }
                    parentEntry.lastUpdateBlock = Math.max(parentEntry.lastUpdateBlock || 0, event.blockNumber);
                  } else {
                    console.warn(`Parent entry ${parenthash} not found for child ${childhash} at block ${event.blockNumber}`);
                  }
                  break;
                }
                
                case 'Note': {
                  const { parenthash, notehash, label, data } = event.parameters;
                  const decodedLabel = bytesToUtf8Safe(label);
                  const parentEntry = getOrInitEntry(parenthash, event.blockNumber);
                  const interpretedData = interpretData(decodedLabel, data);
                  
                  if (!parentEntry.notes[decodedLabel]) {
                    parentEntry.notes[decodedLabel] = [];
                  }
                  
                  parentEntry.notes[decodedLabel].push({
                    data: interpretedData,
                    rawData: data,
                    blockNumber: event.blockNumber,
                    txHash: event.transactionHash,
                    logIndex: event.logIndex,
                    notehash
                  });
                  
                  parentEntry.notes[decodedLabel].sort((a, b) => 
                    b.blockNumber !== a.blockNumber ? 
                      b.blockNumber - a.blockNumber : 
                      b.logIndex - a.logIndex
                  );
                  break;
                }
                
                case 'Fact': {
                  const { parenthash, facthash, label, data } = event.parameters;
                  const decodedLabel = bytesToUtf8Safe(label);
                  const parentEntry = getOrInitEntry(parenthash, event.blockNumber);
                  const interpretedData = interpretData(decodedLabel, data);
                  
                  if (!parentEntry.facts[decodedLabel]) {
                    parentEntry.facts[decodedLabel] = [];
                  }
                  
                  parentEntry.facts[decodedLabel].push({
                    data: interpretedData,
                    rawData: data,
                    blockNumber: event.blockNumber,
                    txHash: event.transactionHash,
                    logIndex: event.logIndex,
                    facthash
                  });
                  
                  parentEntry.facts[decodedLabel].sort((a, b) => 
                    b.blockNumber !== a.blockNumber ? 
                      b.blockNumber - a.blockNumber : 
                      b.logIndex - a.logIndex
                  );
                  break;
                }
                
                case 'Transfer': {
                  const { from, to, id } = event.parameters;
                  let idHex;
                  
                  try {
                    if (typeof id === 'string' && id.startsWith('0x')) {
                      idHex = id;
                    } else if (typeof id === 'string' || typeof id === 'number') {
                      idHex = '0x' + BigInt(id).toString(16);
                    } else {
                      throw new Error('Invalid ID type');
                    }
                  } catch(e) {
                    console.warn(`Invalid tokenId format ${id} at block ${event.blockNumber}. Skipping Transfer. Error: ${e.message}`);
                    break;
                  }
                  
                  const namehash = tokenIdToNamehash(idHex);
                  if (!namehash) {
                    console.warn(`Could not convert tokenId ${id} -> ${idHex} to namehash at block ${event.blockNumber}. Skipping Transfer.`);
                    break;
                  }
                  
                  const entry = getOrInitEntry(namehash, event.blockNumber);
                  if (from === ZERO_ADDRESS) {
                    entry.owner = to;
                    if (!entry.creationBlock || entry.creationBlock > event.blockNumber) 
                      entry.creationBlock = event.blockNumber;
                  } else {
                    entry.owner = to;
                  }
                  break;
                }
                
                case 'Gene': {
                  const { entry: entryHash, gene } = event.parameters;
                  const entry = getOrInitEntry(entryHash, event.blockNumber);
                  entry.gene = gene;
                  break;
                }
                
                case 'Zero':
                case 'Upgraded':
                  break;
              }
            } catch(eventError) {
              console.error(`Error processing event at block ${event.blockNumber}, tx ${event.transactionHash}, logIndex ${event.logIndex}:`, event, eventError);
            }

            processedCount++;
            if (processedCount % 500 === 0) { // Update progress periodically
              setProgress(prev => ({ ...prev, message: `Processing state... (${processedCount}/${decodedEvents.length} events)` }));
              await new Promise(res => setTimeout(res, 0)); // Yield for UI
            }
        }
        console.log('Finished processing events.');
        setProgress(prev => ({ ...prev, message: 'Filtering state...' }));
        await new Promise(res => setTimeout(res, 0));

        // --- Step 5: Filter ---
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
        console.log(`Filtered state contains ${Object.keys(filteredState).length} entries.`);

        // --- Step 6: Update React State ---
        console.log('Updating application state...');
        setNamespaceState(filteredState); // <<<--- Set the state for the UI
        setProgress(prev => ({ ...prev, message: 'Done!' }));

    } catch (err) {
        // Handle errors from any step
        console.error("Indexing process failed:", err);
        setError(err.message || 'An unknown error occurred during indexing.');
        setProgress(prev => ({ ...prev, message: `Failed: ${err.message}` }));
    } finally {
        // Ensure indexing flag is turned off
        setIsIndexing(false);
        console.log("Indexing finished (successfully or with error).");
    }
  }; // End of handleStartIndexing

  const handleNodeClick = (nodeData) => {
    console.log("Node clicked:", nodeData);
    setSelectedNodeData(nodeData);
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Hypermap Visualizer Demo (Client-Side)</h1>
        
        <div>
          <p>Enter your full Infura URL (used directly in your browser):</p>
          <input
            type="text"
            value={infuraUrl}
            onChange={(e) => setInfuraUrl(e.target.value)}
            placeholder="e.g., https://base-mainnet.infura.io/v3/your-key-here"
            disabled={isIndexing}
            style={{ marginRight: '10px', minWidth: '400px' }}
          />
          <button 
            onClick={handleStartIndexing} 
            disabled={isIndexing || !infuraUrl}
            style={{ 
              padding: '5px 15px',
              backgroundColor: '#4CAF50', 
              color: 'white', 
              border: 'none', 
              borderRadius: '4px',
              cursor: isIndexing || !infuraUrl ? 'not-allowed' : 'pointer'
            }}
          >
            {isIndexing ? 'Indexing...' : 'Start Indexing'}
          </button>
        </div>

        {/* Progress Bar Area */}
        {isIndexing && <ProgressBar progress={progress} />}

        {/* Error Display Area */}
        {error && (
          <div style={{ marginTop: '20px', color: 'red', border: '1px solid red', padding: '10px' }}>
            <p>Error:</p>
            <pre>{error}</pre>
          </div>
        )}

        {/* Visualization Area */}
        <div style={{ marginTop: '20px', height: '600px', width: '100%', border: '1px solid black', position: 'relative' }}>
          {namespaceState ? (
            <NamespaceGraph namespaceData={namespaceState} onNodeClick={handleNodeClick} />
          ) : (
            !isIndexing && <p style={{ textAlign: 'center', paddingTop: '50px' }}>Namespace data will appear here after indexing.</p>
          )}
          {isIndexing && !namespaceState && <p style={{ textAlign: 'center', paddingTop: '50px' }}>Indexing in progress...</p>}
        </div>

        {/* Inspection Panel */}
        {selectedNodeData && (
          <div style={{ marginTop: '20px', border: '1px solid #eee', padding: '15px', backgroundColor: '#f9f9f9' }}>
            <h2>Selected Node Details</h2>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(selectedNodeData, null, 2)}
            </pre>
            <button 
              onClick={() => setSelectedNodeData(null)}
              style={{ 
                padding: '5px 15px',
                backgroundColor: '#f44336', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px',
                cursor: 'pointer',
                marginTop: '10px'
              }}
            >
              Close Details
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
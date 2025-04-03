// utils/hypermapUtils.js
import { Web3 } from 'web3'; // Import web3 utils if needed within helpers
import { Buffer } from 'buffer'; // Node's Buffer for hex manipulation

export function bytesToUtf8Safe(hex) {
  if (!hex || hex === '0x' || hex.length <= 2) { return hex; }
  try {
    const cleanHex = hex.startsWith('0x') ? hex : '0x' + hex;
    return Web3.utils.hexToUtf8(cleanHex);
  } catch (e) { return hex; }
}

export function hexToIp(hex) {
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

export function hexToUint(hex) {
  if (!hex || hex === '0x') { return null; }
  try {
    const bigIntValue = BigInt(hex);
    return bigIntValue <= Number.MAX_SAFE_INTEGER ? Number(bigIntValue) : bigIntValue.toString();
  } catch (e) { return null; }
}

export function interpretData(label, dataHex) {
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

export function tokenIdToNamehash(tokenIdHex) {
    if (!tokenIdHex) return null;
    const hex = tokenIdHex.startsWith('0x') ? tokenIdHex : '0x' + tokenIdHex;
    return '0x' + hex.slice(2).padStart(64, '0');
}
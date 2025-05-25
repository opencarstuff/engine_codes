const $ = id => document.getElementById(id);
const connectBtn = $('connectBtn');

/* ---------- BLE constants ---------- */
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const HM10_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
const HM10_CHAR = '0000ffe1-0000-1000-8000-00805f9b34fb';
const HM10_CHAR_FALLBACK = '0000ffe2-0000-1000-8000-00805f9b34fb';
const ISSC_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const ISSC_CHAR_RX = '0000fff1-0000-1000-8000-00805f9b34fb';
const ISSC_CHAR_TX = '0000fff2-0000-1000-8000-00805f9b34fb';

const enc = new TextEncoder();
const dec = new TextDecoder();

let tx, rx, device, lineBuf = '';
let prevStatus;
let waiter;
const received = [];

const setStatus = (txt, cls, cmd) => {
  const statusEl = $('status');
  prevStatus = txt;
  statusEl.textContent = cmd ? `${txt} ${cmd}` : txt;
  if (cls) {
    statusEl.className = `status ${cls}`;
  }
};

const YEARMAP = 'ABCDEFGHJKLMNPRSTVWXY123456789';
const decodeYear = ch => {
  const i = YEARMAP.indexOf(ch.toUpperCase());
  if (i === -1) return '–';
  const currentYear = new Date().getFullYear();
  let year = 1980 + i;
  while (year + 30 < currentYear) {
    year += 30;
  }
  return year;
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const send = (str) => {
  setStatus(prevStatus, undefined, str);
  if (debug.logTx) debug.logTx(`${str}\\r`);
  return tx.writeValue(enc.encode(`${str}\r`));
} 

const waitLine = (match = () => true, to = 15000) =>
  new Promise((res, rej) => {
    if (received.find(match)) {
      const lines = [...received]
      received.length = 0;
      return res(lines);
    }
    if (waiter) throw new Error(`Already waiting for ${waiter.match}`);
    const timeout = setTimeout(
      () => {
        waiter = null;
        rej(new Error(`Timeout for  match ${match}`));
      },
      to,
    );
    waiter = lines => {
      if (lines.find(match)) {
        waiter = null;
        clearTimeout(timeout)
        res(lines);
      }
    };
  });


const elmInit = async () => {
  await send('ATZ'); delay(1000); await waitLine();
  await send('ATE0'); delay(200); await waitLine();
  delay(200);
  await send('ATH0'); await waitLine();
  await send('ATSP0'); await waitLine();
};

const readVIN = async () => {
  await send('09 02');
  const frames = await waitLine(l => /(49 02|UNABLE TO CONNECT)/i.test(l));
  if (!frames.find(l => l.match(/49 02/i))) {
    throw new Error('Can\'t connect to car. Check connection or start engine')
  }
  const bytes = frames
    .map((frame) => frame.split(/\s+/).filter(h => /^[0-9A-F]{2}$/i.test(h)))
    .map((frame) => (frame[0] === '49' && frame[1] === '02') ? frame.slice(3) : frame)
    .flat();
  return bytes.slice(0, 17)
    .map(h => String.fromCharCode(parseInt(h, 16))).join('');
};

const bytesToDTC = (b1, b2) => {
  const first = ['P','C','B','U'][(b1 & 0xC0) >> 6];
  const second = ((b1 & 0x30) >> 4).toString(16).toUpperCase();
  const rest = ((b1 & 0x0F) << 8 | b2).toString(16).toUpperCase().padStart(3, '0');
  return first + second + rest;
};

const readDTCs = async (cmd = '03') => {
  await send(cmd);
  const line = [ await waitLine(l => new RegExp(`^${40 + parseInt(cmd, 10)} `).test(l)) ].join(' ');
  const bytes = line.split(/\s+/).slice(2).map(h => parseInt(h,16));
  const codes = [];
  for (let i=0;i<bytes.length;i+=2)
    if (bytes[i] || bytes[i+1]) codes.push(bytesToDTC(bytes[i], bytes[i+1]));
  return codes;
};

const displayDTCs = (sectionId, listId, noCodesId, codes) => {
  $(listId).innerHTML = codes.map(c => `<li><strong>${c}</strong></li>`).join('');
  $(listId).hidden = codes.length === 0;
  $(noCodesId).hidden = codes.length > 0;
  $(sectionId).hidden = false;
};

/* ---------- Connect button flow ---------- */
connectBtn.onclick = async () => {
  try {
    Array.prototype.forEach.call(document.getElementsByClassName('landing'), (e) => e.hidden = true);
    log('connect_clicked');

    if (!tx || !rx) {
      setStatus('Pairing…', 'pending');
      connectBtn.disabled = true;

      /* requestDevice */
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HM10_SERVICE] }, { services: [NUS_SERVICE] }, { services: [ISSC_SERVICE] }],
      });
      const server = await device.gatt.connect();
      const service = await (async () => {
        try { return await server.getPrimaryService(NUS_SERVICE); }
        catch {
          try { return await server.getPrimaryService(HM10_SERVICE); }
          catch { return await server.getPrimaryService(ISSC_SERVICE); }
        }
      })();
      log('connected', { device: device.name, service: service.uuid });
      const chars = await service.getCharacteristics();
      tx = chars.find(c => c.uuid === NUS_TX
        || c.uuid === ISSC_CHAR_TX
        || ((c.uuid === HM10_CHAR || c.uuid === HM10_CHAR_FALLBACK) && c.properties.write));
      rx = chars.find(c => c.uuid === NUS_RX || c.uuid === ISSC_CHAR_RX || (c.uuid === HM10_CHAR && c.properties.notify));
      if (!tx || !rx) throw new Error(`UART characteristics not found: tx ${tx ? 'yes' : 'no'}, rx ${rx ? 'yes' : 'no'}`);
      await rx.startNotifications();
      rx.addEventListener(
        'characteristicvaluechanged',
        e => {
          const line = dec.decode(e.target.value);
          if (debug.logRx) debug.logRx(line);
          lineBuf += line;
          if (lineBuf.includes('>')) {
            const newLines = lineBuf.replace(/\r*>/, '').split(/\r/).map((l) => l.trim());
            lineBuf = '';
            if (waiter) {
              waiter(newLines);
            } else {
              received.push(...newLines);
            }
          }
        },
      );
      setStatus('Initializing…', 'pending');

      await elmInit();
      log('initialized');
    }

    setStatus('Reading VIN…', 'pending');
    const vin = await readVIN();
    log('vin_read', { vin: vin.slice(0, 10) });
    if ([1, 4, 5, 7].includes(vin[0])) {
      const year = decodeYear(vin[9]);
      $('year').textContent = `(${year})`;
    } else {
      $('year').hidden = true;
    }
    $('vin').textContent = `${vin} 🔒`;
    $('make').hidden = true;
    $('vehicle').hidden = false;

    setStatus('Reading trouble codes…', 'pending');
    const dtc = await readDTCs('03');
    log('dtc_read', { dtc });
    displayDTCs('codes', 'codeList', 'noCodes', dtc);
    const pendingDtc = await readDTCs('07');
    log('pending_dtc_read', { pendingDtc });
    displayDTCs('pendingCodes', 'pendingCodeList', 'noPendingCodes', pendingDtc);

    setStatus('Online', 'offline');
    sendLog('success');
    connectBtn.innerHTML = 'Repeat scan';
    connectBtn.disabled = false;
  } catch (e) {
    setStatus(`Error: ${e.message}`, 'offline');
    connectBtn.disabled = false;
    console.log(e);
    sendLog('error');
  }
};
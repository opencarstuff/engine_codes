const debug = {
  logTx: (str) => console.log(`TX ${str.replace(/\r/g, '\\r')}`),
  logRx: (str) => console.log(`RX ${str.replace(/\r/g, '\\r')}`),
};
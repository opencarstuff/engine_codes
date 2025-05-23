const logBuf = [];

function log(evt, data={}) {
  logBuf.push({ t: Date.now(), evt, ...data });
}

async function sendLog(result, extra={}) {
  const get = (name) => logBuf.find((e) => e[name])?.[name];
  const device = get('device');
  const service = get('service');
  const vin = get('vin');
  const dtc = get('dtc');
  const pendingDtc = get('pendingDtc');
  const summary = {
    result,
    ...vin && {
      wmi: vin.slice(0,3),
      typeCode: vin.slice(3,10),
    },
    ...device && { device },
    ...service && { service },
    ...dtc && { dtc },
    ...pendingDtc && { pendingDtc },
    events: logBuf.map(({ t, evt }) => ({ t: t - logBuf[0].t, evt })),
    ...extra,
  };
  logBuf.length = 0;
  return fetch('/log', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      Authorization: 'Bearer ${logToken}',
    },
    body: JSON.stringify(summary)
  });
}
import fs from 'fs';

export function cache(fn) {
  if (process.env.NODE_ENV === 'production') {
    const content = fn();
    return (req) => req?.query?.debug ? fn(req) : content;
  }
  return fn;
}

export function toJS(json, varName) {
  const js = JSON.stringify(json)
    .replace(/"([^"]+)":/g, (_, key) => /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(key) ? `${key}:` : `"${key}":`);
  return `const ${varName} = ${js};`;
}

export function getDonglePrice(req, price = 10) {
  if (req.country) {
    const cc = req.country.toUpperCase();
    if (cc === 'UK' || cc === 'GB') return `£${price}`;
    if (['AT','BE','CY','EE','FI','FR','DE','GR','IE','IT','LV','LT','LU','MT','NL','PT','SK','SI','ES','AD','MC','SM','VA','LI','CH','NO','IS','SE'].includes(cc)) return `${price}€`;
  }
  return `$${price}`;
}

export function loadJsAssets(filenames, debug = false) {
  return filenames.map((f) => {
    const js = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[^*]+\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\n\n+/g, '\n');
    if (debug) {
      return js;
    }
    return js.replace(/[^\n]*if *\(debug\b[^\n]*\n/g, '');
  });
}
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import expressLayouts from 'express-ejs-layouts';
import expressWinston from 'express-winston';
import { rateLimit } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { cache, getDonglePrice, loadJsAssets, toJS } from './util.js';
import geoip from 'geoip-lite';
import winston from 'winston';

const app = express();
app.set('view engine', 'ejs');
app.use(express.json());
app.use(expressLayouts);

const activeLogTokens = new Map();
const LOG_TOKEN_TTL_MS = 20 * 60_000;

setInterval(()=>{
  const now = Date.now();
  for (const [token, exp] of activeLogTokens) if (exp < now) activeLogTokens.delete(token);
}, 60_000);

app.use(
  rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.header('do-connecting-ip') || req.socket.remoteAddress,
    handler: (req, res, next, options) => res.status(options.statusCode).setHeader('Content-Type: text/plain').send(options.message),
  }),
);

app.use((req, res, next) => {
  const ip = req.header('do-connecting-ip') || req.header('x-forwarded-for') || req.socket.remoteAddress;
  const geo = geoip.lookup(ip);

  if (geo) {
    const { country, region } = geo;
    if (['CU', 'IR', 'SY', 'KP', 'SD', 'RU', 'BY', 'UA'].includes(country)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    req.country = country;
    req.region = region;
  }
  next();
});

if (process.env.BETTERSTACK_SOURCE_TOKEN) {
  const betterStack = new winston.transports.Http({
    host: 's1313073.eu-nbg-2.betterstackdata.com',
    headers: { 'Authorization': `Bearer ${process.env.BETTERSTACK_SOURCE_TOKEN}` },
    ssl: true,
  });

  app.use(expressWinston.logger({
    transports: [betterStack],
    meta: false,
    level: (req, res) => {
      if (res.statusCode >= 500) {
        return 'error';
      }
      if (res.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    dynamicMeta: (req) => ({
      route: req.path
    }),
    msg: "HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{req.country}} {{res.responseTime}}ms",
  }));

  const scanLogger = winston.createLogger({
    level: 'info',
    defaultMeta: { service: 'scan-summary' },
    transports: [betterStack]
  });

  app.use('/log', (req, res, next) => {
    const rawLogToken = req.header('Authorization')?.replace('Bearer ', '');
    if (!rawLogToken) {
      return res.status(401).json({ error: 'Authorization required' })
    }
    try {
      const logToken = jwt.verify(rawLogToken, process.env.JWT_SECRET);
      if (logToken.allowedAddress === req.header('do-connecting-ip') || req.socket.remoteAddress) {
        return next();
      }
    } catch (e) {
      // Fall through to error response.
    }
    return res.status(403).json({ error: 'Unauthorized' });
  });

  app.post('/log', (req, res) => {
    const payload = {
      ...req.body,
      ...req.country && { country: req.country },
      ...req.region && req.country === 'US' && { region: req.region },
      userAgent: req.header('User-Agent'),
    };
    scanLogger.info('scan finished', payload);
    res.sendStatus(204);
  });
}

const css = cache(() => fs.readFileSync('assets/style.css', 'utf8'));
const js = cache(
  (req) => '(async () => {\n' + loadJsAssets(
    [
      'assets/availability.js',
      ...(req?.query?.debug === 'console' ? [ 'assets/debug_console.js' ] : []),
      'assets/logger.js',
      'assets/scanner.js',
    ],
    req?.query?.debug,
  ).flat().join('\n') + '\n})();',
);

const brand = 'Engine.codes';
function render(template, options = {}) {
  return (req, res) => {
    let finalJs;
    if (template === 'index') {
      const logToken = jwt.sign(
        { allowedAddress: req.header('do-connecting-ip') || req.socket.remoteAddress },
        process.env.JWT_SECRET,
        { expiresIn: '20m' },
      );
      activeLogTokens.set(logToken, Date.now() + LOG_TOKEN_TTL_MS);
      finalJs = js(req).replace(/\$\{logToken\}/g, logToken);
    }
    if (finalJs) {
      const hash = crypto.createHash('sha256').update(finalJs).digest('base64');
      res.setHeader(
        'Content-Security-Policy',
        `script-src 'sha256-${hash}'; object-src 'none'; base-uri 'none'`,
      );
    } else {
      res.setHeader(
        'Content-Security-Policy',
        `script-src 'none'; object-src 'none'; base-uri 'none';`,
      );
    }
    return res.render(
      template,
      {
        brand: brand,
        css: css(),
        domain: 'engine.codes',
        donglePrice: getDonglePrice(req),
        ...finalJs && { js: finalJs },
        scannerPrice: getDonglePrice(req, 300),
        ...!options.title && { title: brand },
        ...options,
      },
    );
  };
}

app.get('/', render('index'));
app.get('/scan', (req, res) => res.redirect(301, '/'));
app.get('/legal', render('legal', { title: `${brand}: Legal and Privacy Notice` }));
app.use(express.static('static'))

const port = process.env.HTTP_PORT || 8080;
app.listen(port, () => console.log(`🚀 http://localhost:${port}`));
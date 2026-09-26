const { getDefaultConfig } = require('expo/metro-config');

const { proxyErcot } = require('./server/ercotProxy');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const previousEnhance = config.server?.enhanceMiddleware;

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const next = previousEnhance
      ? previousEnhance(middleware, server)
      : middleware;

    return (req, res, nextMiddleware) => {
      const path = (req.url ?? '').split('?')[0];
      const match = path.match(/^\/api\/ercot\/([a-z0-9-]+\.json)$/);
      if (!match || req.method !== 'GET') {
        return next(req, res, nextMiddleware);
      }

      const feed = match[1];
      proxyErcot(feed)
        .then((result) => {
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(result.body);
        })
        .catch(() => {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'ERCOT is unreachable' }));
        });
    };
  },
};

module.exports = config;

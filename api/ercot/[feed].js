const { proxyErcot } = require('../../server/ercotProxy');

module.exports = async function handler(req, res) {
  const feed = Array.isArray(req.query.feed) ? req.query.feed[0] : req.query.feed;

  try {
    const result = await proxyErcot(typeof feed === 'string' ? feed : '');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(result.status).send(result.body);
  } catch {
    res.status(502).json({ error: 'ERCOT is unreachable' });
  }
};

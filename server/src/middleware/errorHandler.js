"use strict";

function notFound(req, res) {
  res.status(404).json({ error: "not found", path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const body = { error: err.message || "internal error" };
  if (err.pgcode) body.pgcode = err.pgcode;
  if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };

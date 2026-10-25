import { z } from 'zod';

export function requireItem(items, itemId, label) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw Object.assign(new Error(`${label} não encontrado.`), { status: 404 });
  return item;
}

export function localRequest(request, response, next) {
  const host = request.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    return response.status(403).json({ error: 'Acesso somente pela máquina local.' });
  const origin = request.headers.origin;
  const allowed = [`http://${host}`];
  if (process.env.NODE_ENV !== 'production')
    allowed.push('http://127.0.0.1:5173', 'http://localhost:5173');
  if (origin && !allowed.includes(origin))
    return response.status(403).json({ error: 'Origem não autorizada.' });
  if (request.path.startsWith('/api') && request.headers['sec-fetch-site'] === 'cross-site')
    return response.status(403).json({ error: 'Requisição externa recusada.' });
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (request.path.startsWith('/api')) {
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-disparo'] !== '1')
      return response.status(403).json({ error: 'Use o aplicativo para esta operação.' });
  }
  next();
}

export function errorResponse(error, _request, response, _next) {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      : error.code === 'LIMIT_FILE_SIZE'
        ? 'Arquivo acima do limite de 25 MB.'
        : error.message;
  response
    .status(error.status || 400)
    .json({ error: message || 'Não foi possível concluir a operação.' });
}

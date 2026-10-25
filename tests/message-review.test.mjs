import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMessage } from '../shared/message-review.mjs';

test('review reports exact empty-field counts, including blank fallbacks, without rejecting populated fields', () => {
  const recipients = [
    { nome: 'Ana', empresa: '' },
    { nome: '', empresa: 'Loja' },
  ];
  const issues = reviewMessage('Oi {{nome|}} da {{empresa|sua empresa}}.', recipients);
  assert.equal(issues.filter((issue) => issue.id.startsWith('field:')).length, 1);
  assert.match(issues.find((issue) => issue.id === 'field:nome').explanation, /1 de 2/);
  assert.equal(reviewMessage('Olá {{nome|pessoal}}', recipients).length, 0);
});
test('review distinguishes audience not selected, malformed personalization and attachment-only messages', () => {
  assert.ok(reviewMessage('Oi {{nome}}').some((issue) => issue.id === 'select-audience'));
  assert.ok(reviewMessage('Oi {{nome').some((issue) => issue.id === 'unfinished-field'));
  assert.ok(reviewMessage('Oi {{ }}').some((issue) => issue.id === 'unnamed-field'));
  assert.ok(reviewMessage('   ').some((issue) => issue.id === 'empty-message'));
  assert.equal(reviewMessage(' ', [], { attachmentCount: 1 }).length, 0);
});
test('review catches incomplete protocols, empty domains and bad escapes, preserving valid URL punctuation', () => {
  const bad = reviewMessage(
    'https:/loja.com https//loja.com www..com https:// https://loja.com/%zz',
  );
  assert.equal(bad.filter((issue) => issue.id.startsWith('link:')).length, 5);
  const good = reviewMessage(
    'Veja https://loja.com.br/oferta?dia=24, (https://exemplo.com/a(b)). Ou www.loja.com e https://[2001:db8::1]/.',
  );
  assert.equal(good.filter((issue) => issue.id.startsWith('link:')).length, 0);
});
test('review treats dynamic links as unverified and inspects whole-link field values and fallbacks locally', () => {
  const dynamic = reviewMessage('Veja https://{{dominio}}/oferta.', [{ dominio: 'loja.com' }]);
  assert.ok(dynamic.some((issue) => issue.id === 'dynamic-link'));
  assert.equal(dynamic.filter((issue) => issue.id.startsWith('link:')).length, 0);
  assert.ok(
    reviewMessage('Veja {{link}}', [{ link: 'https:/loja.com' }]).some((issue) =>
      issue.id.startsWith('link:'),
    ),
  );
  assert.ok(
    reviewMessage('Veja {{link|https:/loja.com}}', [{ link: '' }]).some((issue) =>
      issue.id.startsWith('link:'),
    ),
  );
});
test('clarity suggestions explain measurable thresholds and disappear when corrected', () => {
  const issues = reviewMessage('ESTA MENSAGEM TEM MUITAS LETRAS MAIÚSCULAS PARA O NOSSO TESTE!!!!');
  assert.ok(
    issues.some((issue) => issue.id === 'mostly-uppercase' && /80%/.test(issue.explanation)),
  );
  assert.ok(
    issues.some((issue) => issue.id === 'repeated-punctuation' && /“!!!!”/.test(issue.explanation)),
  );
  assert.ok(reviewMessage('a'.repeat(501)).some((issue) => issue.id === 'long-paragraph'));
  assert.ok(reviewMessage('Olá [NOME]').some((issue) => issue.id === 'possible-placeholder'));
  assert.equal(
    reviewMessage('Olá! Confira as novidades da sua empresa em https://exemplo.com.').length,
    0,
  );
});

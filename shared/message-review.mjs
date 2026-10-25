const fieldPattern = /\{\{\s*([^{}|]+?)(?:\|([^{}]*))?\s*\}\}/g;
const linkPattern = /\b(?:https?:[^\s<>|]*|https?\/\/[^\s<>|]*|www\.[^\s<>|]*)/gi;
const dynamicMarker = 'disparocampodinamico';

function trimLink(value) {
  let result = value.replace(/[.,!?;:}]+$/, '');
  while (
    result.endsWith(')') &&
    (result.match(/\)/g) || []).length > (result.match(/\(/g) || []).length
  )
    result = result.slice(0, -1);
  return result;
}

function linkProblem(link) {
  if (!/^https?:\/\//i.test(link) && !/^www\./i.test(link))
    return 'O prefixo está incompleto. Use http://, https:// ou www.';
  try {
    const url = new URL(/^www\./i.test(link) ? `https://${link}` : link);
    const hostname = url.hostname;
    const ipv6 = /^\[[a-f\d:.]+\]$/i.test(hostname);
    if (
      !ipv6 &&
      (!hostname.includes('.') ||
        !hostname.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))
    )
      return 'O domínio parece incompleto ou contém uma parte vazia/inválida. Confira o endereço; links internos podem ser uma exceção.';
    if (/%(?![a-f\d]{2})/i.test(link))
      return 'Há um sinal % sem dois dígitos hexadecimais depois dele. Confira a codificação do endereço.';
    return null;
  } catch {
    return 'Não foi possível interpretar este endereço como um link HTTP/HTTPS. Confira o domínio e a pontuação.';
  }
}

/** Deterministic, advisory checks. No requests, DNS checks, scoring or send blocking. */
export function reviewMessage(template, recipientFields = [], { attachmentCount = 0 } = {}) {
  const issues = [];
  const push = (id, level, title, explanation) => issues.push({ id, level, title, explanation });
  if (!template.trim() && !attachmentCount)
    push(
      'empty-message',
      'warning',
      'Mensagem vazia',
      'O texto contém apenas espaços ou está vazio, e não há anexos selecionados.',
    );

  const fields = [...template.matchAll(fieldPattern)];
  const missing = new Map();
  for (const [, rawKey, fallback] of fields) {
    const key = rawKey.trim();
    if (!key) {
      if (!issues.some((issue) => issue.id === 'unnamed-field'))
        push(
          'unnamed-field',
          'warning',
          'Campo sem nome',
          'Há um campo de personalização com o nome vazio. Informe o nome entre as chaves, por exemplo {{nome|pessoal}}.',
        );
      continue;
    }
    if ((fallback || '').trim()) continue;
    const count = recipientFields.filter(
      (values) => !Object.hasOwn(values, key) || !String(values[key] ?? '').trim(),
    ).length;
    if (count) missing.set(key, count);
  }
  for (const [key, count] of missing)
    push(
      `field:${key}`,
      'warning',
      `Campo “${key}” sem valor`,
      `${count} de ${recipientFields.length} destinatários selecionados não têm esse campo preenchido e a alternativa está vazia ou ausente. Use {{${key}|texto alternativo}} ou confira o cadastro.`,
    );
  if (fields.length && !recipientFields.length)
    push(
      'select-audience',
      'info',
      'Preenchimento ainda não conferido',
      'Selecione destinatários para verificar quais campos ficarão vazios.',
    );
  const withoutFields = template.replace(fieldPattern, dynamicMarker);
  if (/\{\{|\}\}/.test(withoutFields))
    push(
      'unfinished-field',
      'warning',
      'Campo de personalização incompleto',
      'Há chaves duplas fora do formato reconhecido. Confira a abertura, o nome e o fechamento, por exemplo {{nome|pessoal}}.',
    );

  const links = new Set((withoutFields.match(linkPattern) || []).map(trimLink));
  // Whole-link variables can also contain an address; inspect only values actually used.
  for (const [, , fallback] of fields)
    for (const match of (fallback || '').match(linkPattern) || []) links.add(trimLink(match));
  for (const key of new Set(fields.map(([, rawKey]) => rawKey.trim())))
    for (const values of recipientFields) {
      const value = Object.hasOwn(values, key) ? String(values[key] ?? '') : '';
      for (const match of value.match(linkPattern) || []) links.add(trimLink(match));
    }
  let dynamicLink = false;
  let invalidLinks = 0;
  for (const link of links) {
    if (link.includes(dynamicMarker)) {
      dynamicLink = true;
      continue;
    }
    const problem = linkProblem(link);
    if (problem) {
      invalidLinks++;
      if (invalidLinks <= 5)
        push(`link:${link}`, 'warning', 'Confira este link', `“${link}”: ${problem}`);
    }
  }
  if (invalidLinks > 5)
    push(
      'more-invalid-links',
      'warning',
      'Outros links para conferir',
      `Foram encontrados ${invalidLinks} endereços distintos com observações de sintaxe. Os primeiros cinco estão detalhados acima.`,
    );
  if (dynamicLink)
    push(
      'dynamic-link',
      'info',
      'Link montado com personalização',
      'Um endereço contém campos variáveis. Confira o link completo na prévia de cada destinatário; a montagem final desse endereço não foi validada aqui.',
    );

  const prose = withoutFields.replace(linkPattern, '').replaceAll(dynamicMarker, '');
  const letters = prose.match(/\p{L}/gu) || [];
  const upper = prose.match(/\p{Lu}/gu) || [];
  if (letters.length >= 30 && upper.length / letters.length > 0.8)
    push(
      'mostly-uppercase',
      'info',
      'Texto predominantemente em maiúsculas',
      `${upper.length} de ${letters.length} letras estão em maiúsculas (mais de 80%). Considere usar maiúsculas apenas nos destaques para facilitar a leitura.`,
    );
  const punctuation = prose.match(/[!?]{4,}/g);
  if (punctuation?.length)
    push(
      'repeated-punctuation',
      'info',
      'Pontuação repetida',
      `Há ${punctuation.length} trecho(s) com quatro ou mais sinais de ! ou ? seguidos, como “${punctuation[0]}”. Considere reduzir para deixar a intenção mais clara.`,
    );
  const longest = Math.max(
    0,
    ...prose.split(/\n\s*\n/).map((paragraph) => paragraph.trim().length),
  );
  if (longest > 500)
    push(
      'long-paragraph',
      'info',
      'Parágrafo longo',
      `Um parágrafo tem ${longest} caracteres, acima da referência de leitura de 500 usada nesta revisão. Considere separar as ideias com uma linha em branco. Esse valor não é um limite do WhatsApp.`,
    );
  const placeholders = template.match(/\[(?:NOME|EMPRESA|LINK|INSIRA[^\]\n]*|COLOQUE[^\]\n]*)\]/gi);
  if (placeholders?.length)
    push(
      'possible-placeholder',
      'info',
      'Possível marcador pendente',
      `O texto contém “${placeholders[0]}”. Confira se deve substituir esse trecho ou mantê-lo literalmente.`,
    );
  return issues;
}

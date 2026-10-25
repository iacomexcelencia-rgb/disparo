// Personalization is resolved once into a campaign snapshot, so preview equals delivery.
export function renderTemplate(template, fields, random = Math.random) {
  const own = (key) => (Object.hasOwn(fields, key) ? String(fields[key] ?? '').trim() : '');
  return template.replace(
    /\{\{\s*([^{}|]+?)(?:\|([^{}]*))?\s*\}\}|\{([^{}]*\|[^{}]*)\}/g,
    (_, key, fallback, alternatives) => {
      if (key !== undefined) return own(key.trim()) || (fallback ?? '').trim();
      const choices = alternatives.split('|');
      return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
    },
  );
}
export function analyzeTemplate(template, contacts) {
  const keys = [...template.matchAll(/\{\{\s*([^{}|]+?)(?:\|([^{}]*))?\s*\}\}/g)];
  const missing = keys
    .filter(
      ([, key, fallback]) =>
        fallback === undefined &&
        contacts.some(
          (contact) =>
            !Object.hasOwn(contact, key.trim()) || !String(contact[key.trim()] ?? '').trim(),
        ),
    )
    .map(([, key]) => key.trim());
  return [...new Set(missing)];
}
export function contactFields(contact) {
  return {
    ...contact.fields,
    nome: contact.name,
    primeiro_nome: contact.name?.split(/\s+/)[0] || '',
    empresa: contact.company,
    telefone: contact.phone,
  };
}

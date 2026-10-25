import { z } from 'zod';
import { id } from '../store.mjs';
import { listSchema, contactSchema, identifier } from '../schemas.mjs';
import { requireItem } from '../http.mjs';
import { parseImport, normalizePhone, csvEncode } from '../importer.mjs';
import { upload } from '../uploads.mjs';

export function installContactRoutes(api, { store }) {
  const imports = new Map();
  api.post('/lists', (request, response) => {
    const input = listSchema.parse(request.body);
    if (store.data.lists.some((list) => list.name.toLowerCase() === input.name.toLowerCase()))
      throw new Error('Já existe uma lista com esse nome.');
    const list = { id: id(), ...input };
    store.data.lists.push(list);
    store.save();
    response.status(201).json(list);
  });
  api.delete('/lists/:id', (request, response) => {
    requireItem(store.data.lists, request.params.id, 'Lista');
    store.data.lists = store.data.lists.filter((list) => list.id !== request.params.id);
    for (const contact of store.data.contacts)
      contact.listIds = contact.listIds.filter((listId) => listId !== request.params.id);
    store.save();
    response.json({ ok: true });
  });
  const saveContact = (request, response, update = false) => {
    const input = contactSchema.parse(request.body);
    const phone = normalizePhone(input.phone, input.country);
    if (!phone)
      throw new Error('Telefone inválido. Informe o DDD e o número ou use +código do país.');
    if (input.listIds.some((listId) => !store.data.lists.some((list) => list.id === listId)))
      throw new Error('Lista inválida.');
    if (
      store.data.contacts.some(
        (contact) => contact.phone === phone && contact.id !== request.params.id,
      )
    )
      throw new Error('Este telefone já está na sua base.');
    const { country: _, ...fields } = input;
    const contact = update
      ? requireItem(store.data.contacts, request.params.id, 'Contato')
      : { id: id(), createdAt: new Date().toISOString() };
    Object.assign(contact, fields, { phone, updatedAt: new Date().toISOString() });
    if (!update) store.data.contacts.push(contact);
    store.save();
    response.status(update ? 200 : 201).json(contact);
  };
  api.post('/contacts', (request, response) => saveContact(request, response));
  api.put('/contacts/:id', (request, response) => saveContact(request, response, true));
  api.delete('/contacts/:id', (request, response) => {
    requireItem(store.data.contacts, request.params.id, 'Contato');
    store.data.contacts = store.data.contacts.filter((contact) => contact.id !== request.params.id);
    store.save();
    response.json({ ok: true });
  });
  api.get('/contacts/export', (_, response) => {
    response.setHeader('Content-Disposition', 'attachment; filename="contatos-disparo.csv"');
    response
      .type('text/csv')
      .send(
        csvEncode([
          ['Nome', 'Telefone', 'Empresa', 'Listas', 'Nao receber'],
          ...store.data.contacts.map((contact) => [
            contact.name,
            contact.phone,
            contact.company,
            contact.listIds
              .map((listId) => store.data.lists.find((list) => list.id === listId)?.name || '')
              .join(', '),
            contact.optedOut ? 'Sim' : 'Nao',
          ]),
        ]),
      );
  });
  api.post('/imports/preview', upload.single('file'), async (request, response) => {
    if (!request.file) throw new Error('Selecione um arquivo.');
    for (const [key, item] of imports) if (item.expires < Date.now()) imports.delete(key);
    if (imports.size >= 5)
      throw new Error('Conclua uma das importações em aberto antes de iniciar outra.');
    const parsed = await parseImport(request.file.buffer, request.file.originalname);
    const token = id();
    imports.set(token, { ...parsed, expires: Date.now() + 20 * 60000 });
    response.json({
      token,
      headers: parsed.headers,
      mapping: parsed.mapping,
      rows: parsed.rows.slice(0, 8),
      total: parsed.rows.length,
      filename: request.file.originalname,
    });
  });
  api.post('/imports/commit', (request, response) => {
    const input = z
      .object({
        token: identifier,
        mapping: z.object({ phone: z.string().min(1), name: z.string(), company: z.string() }),
        country: z
          .enum(['BR', 'US', 'PT', 'AR', 'MX', 'GB', 'ES', 'DE', 'FR', 'CO', 'CL'])
          .default('BR'),
        listIds: z.array(identifier).default([]),
      })
      .parse(request.body);
    const parsed = imports.get(input.token);
    if (!parsed || parsed.expires < Date.now())
      throw new Error('A prévia expirou. Selecione o arquivo novamente.');
    if (!parsed.headers.includes(input.mapping.phone))
      throw new Error('Selecione a coluna de telefone.');
    if (input.listIds.some((listId) => !store.data.lists.some((list) => list.id === listId)))
      throw new Error('Selecione uma lista válida.');
    let added = 0;
    let updated = 0;
    const invalid = [];
    const known = new Map(store.data.contacts.map((contact) => [contact.phone, contact]));
    for (let index = 0; index < parsed.rows.length; index++) {
      const row = parsed.rows[index];
      const phone = normalizePhone(row[input.mapping.phone], input.country);
      if (!phone) {
        invalid.push({ row: index + 2, value: row[input.mapping.phone] });
        continue;
      }
      const existing = known.get(phone);
      const fields = Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => !['__proto__', 'constructor', 'prototype'].includes(key),
        ),
      );
      if (existing) {
        existing.name = row[input.mapping.name] || existing.name;
        existing.company = row[input.mapping.company] || existing.company;
        existing.fields = { ...existing.fields, ...fields };
        existing.listIds = [...new Set([...existing.listIds, ...input.listIds])];
        existing.updatedAt = new Date().toISOString();
        updated++;
      } else {
        const contact = {
          id: id(),
          name: row[input.mapping.name] || '',
          company: row[input.mapping.company] || '',
          phone,
          listIds: input.listIds,
          fields,
          optedOut: false,
          createdAt: new Date().toISOString(),
        };
        store.data.contacts.push(contact);
        known.set(phone, contact);
        added++;
      }
    }
    store.save();
    imports.delete(input.token);
    response.json({ added, updated, invalid, total: parsed.rows.length });
  });
}

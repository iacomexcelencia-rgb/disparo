import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sendTrackedMessage } from '../server/outbound.mjs';
import { recordMessage, refreshDelivery, mergeAck } from '../server/delivery.mjs';
import { WhatsAppManager } from '../server/whatsapp.mjs';

const now = 1803420000000;
const destination = '5511912345678@c.us';
const message = (id, extra = {}) => ({
  id: { _serialized: id, remote: destination },
  fromMe: true,
  to: destination,
  timestamp: now / 1000,
  type: 'chat',
  body: 'Olá',
  ack: 0,
  ...extra,
});
const options = { now: () => now, eventWaitMs: 1 };

test('send waits for the send result and captures an acknowledgement that arrives before the return', async () => {
  const client = new EventEmitter();
  let calls = 0;
  client.sendMessage = async (_chat, _body, sendOptions) => {
    calls++;
    assert.equal(sendOptions.waitUntilMsgSent, true);
    assert.equal(sendOptions.sendSeen, false);
    client.emit('message_ack', message('exact-id', { ack: 2 }), 2);
    return message('exact-id', { ack: 0 });
  };
  const result = await sendTrackedMessage(client, destination, 'Olá', options);
  assert.deepEqual(result, { messageId: 'exact-id', ack: 2 });
  assert.equal(calls, 1);
  assert.equal(client.listenerCount('message_ack'), 0);
  assert.equal(client.listenerCount('message_create'), 0);
});

test('an undefined return recovers one matching outgoing text event without sending again', async () => {
  const client = new EventEmitter();
  let calls = 0;
  client.sendMessage = async () => {
    calls++;
    client.emit('message_create', message('event-id'));
    client.emit('message_ack', message('event-id'), 1);
    return undefined;
  };
  const observed = [];
  assert.deepEqual(
    await sendTrackedMessage(client, destination, 'Olá', {
      ...options,
      onMessage: (record) => observed.push(record),
    }),
    { messageId: 'event-id', ack: 1 },
  );
  assert.equal(calls, 1);
  assert.equal(observed.length, 1);
});

test('media recovery requires the exact file hash and a known phone/LID alias', async () => {
  const client = new EventEmitter();
  const media = { data: Buffer.from('arquivo simulado').toString('base64') };
  const hash = createHash('sha256').update(Buffer.from(media.data, 'base64')).digest('base64');
  client.sendMessage = async () => {
    client.emit(
      'message_create',
      message('wrong-file', { type: 'image', rawData: { filehash: 'another-file' } }),
    );
    client.emit(
      'message_ack',
      message('media-id', {
        type: 'image',
        to: '123@lid',
        id: { _serialized: 'media-id', remote: '123@lid' },
        rawData: { filehash: hash },
      }),
      2,
    );
  };
  assert.deepEqual(
    await sendTrackedMessage(client, destination, media, {
      ...options,
      aliases: [destination, '123@lid'],
    }),
    { messageId: 'media-id', ack: 2 },
  );
});

test('wrong recipient, old/incoming events and reused identifiers do not confirm a send', async () => {
  const client = new EventEmitter();
  let calls = 0;
  client.sendMessage = async () => {
    calls++;
    client.emit(
      'message_create',
      message('wrong', { to: 'other@c.us', id: { _serialized: 'wrong', remote: 'other@c.us' } }),
    );
    client.emit('message_create', message('old', { timestamp: now / 1000 - 1 }));
    client.emit('message_create', message('incoming', { fromMe: false }));
    client.emit('message_create', message('used'));
  };
  await assert.rejects(
    sendTrackedMessage(client, destination, 'Olá', { ...options, usedIds: ['used'] }),
    /não retornou o identificador/,
  );
  assert.equal(calls, 1);
  assert.equal(client.listenerCount('message_create'), 0);
});

test('ambiguous matches remain uncertain and a missing return has a useful error', async () => {
  const client = new EventEmitter();
  client.sendMessage = async () => {
    client.emit('message_create', message('one'));
    client.emit('message_create', message('two'));
  };
  await assert.rejects(
    sendTrackedMessage(client, destination, 'Olá', options),
    /Mais de uma mensagem/,
  );
  client.sendMessage = async () => undefined;
  await assert.rejects(
    sendTrackedMessage(client, destination, 'Olá', options),
    /não retornou o identificador/,
  );
});

test('dispatch handles undefined text returns, still sends the attachment and records both identifiers', async (t) => {
  const client = new EventEmitter();
  const manager = new WhatsAppManager('.', () => {});
  const records = [];
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'outbound-'));
  const file = path.join(directory, 'anexo.txt');
  fs.writeFileSync(file, 'Anexo simulado');
  t.after(() => {
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  manager.sessions.set('account', { status: 'ready', client });
  manager.onMessage = (_account, recipientId, record) => {
    assert.equal(recipientId, 'recipient');
    records.push(record);
  };
  client.getNumberId = async () => ({ _serialized: destination });
  client.getContactLidAndPhone = async () => [{ pn: destination, lid: '123@lid' }];
  let calls = 0;
  client.sendMessage = async (_chat, content) => {
    calls++;
    const outgoing = message(`part-${calls}`, {
      body: typeof content === 'string' ? content : '',
      timestamp: Math.floor(Date.now() / 1000),
      ack: 1,
    });
    client.emit('message_ack', outgoing, 1);
    return calls === 1 ? undefined : outgoing;
  };
  const result = await manager.dispatch(
    'account',
    { id: 'recipient', type: 'contact', address: '+5511912345678', body: 'Olá' },
    [{ path: file, name: 'anexo.txt' }],
    0,
  );
  assert.equal(calls, 2);
  assert.equal(records.length, 2);
  assert.deepEqual(result.messageIds, ['part-1', 'part-2']);
  assert.equal(result.messageAcks['part-2'], 1);
});

test('a text accepted without a return does not prevent a real image from being submitted and tracked independently', async (t) => {
  const client = new EventEmitter();
  const manager = new WhatsAppManager('.', () => {});
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'image-'));
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const file = path.join(directory, 'imagem.png');
  fs.writeFileSync(file, bytes);
  t.after(() => {
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  manager.sessions.set('account', { status: 'ready', client });
  client.getNumberId = async () => ({ _serialized: destination });
  const parts = [];
  client.sendMessage = async (chatId, content, sendOptions) => {
    assert.equal(chatId, destination);
    assert.equal(sendOptions.waitUntilMsgSent, true);
    const isText = typeof content === 'string';
    parts.push(isText ? 'text' : 'image');
    if (!isText) {
      assert.equal(content.mimetype, 'image/png');
      assert.equal(content.filename, 'minha-imagem.png');
      assert.deepEqual(Buffer.from(content.data, 'base64'), bytes);
    }
    const outgoing = message(isText ? 'text-accepted' : 'image-accepted', {
      timestamp: Math.floor(Date.now() / 1000),
      type: isText ? 'chat' : 'image',
      body: isText ? content : '',
      ack: isText ? 2 : 1,
      ...(isText
        ? {}
        : { rawData: { filehash: createHash('sha256').update(bytes).digest('base64') } }),
    });
    client.emit('message_create', outgoing);
    client.emit('message_ack', outgoing, outgoing.ack);
    // The real reported failure was a submitted text with an undefined return.
    // Also exercise that response for media: identify each original event once.
    return undefined;
  };
  const result = await manager.dispatch(
    'account',
    { id: 'recipient', type: 'contact', address: '+5511912345678', body: 'Olá' },
    [{ path: file, name: 'minha-imagem.png' }],
    0,
  );
  assert.deepEqual(parts, ['text', 'image']);
  assert.deepEqual(result.messageIds, ['text-accepted', 'image-accepted']);
  assert.equal(result.messageAcks['text-accepted'], 2);
  assert.equal(result.messageAcks['image-accepted'], 1);
  const recipient = { status: 'confirming', expectedMessages: 2 };
  recordMessage(recipient, 'text-accepted', 2);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'uncertain');
  recordMessage(recipient, 'image-accepted', 0);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'confirming');
  recordMessage(recipient, 'image-accepted', 1);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'sent');
  assert.equal(recipient.ack, 1);
});

test('only server confirmations mark sent; late acknowledgements advance and never regress the status', () => {
  const recipient = { status: 'confirming', expectedMessages: 1 };
  recordMessage(recipient, 'one', 0);
  refreshDelivery(recipient, now);
  assert.equal(recipient.status, 'confirming');
  assert.equal(recipient.sentAt, undefined);
  recordMessage(recipient, 'one', 1);
  refreshDelivery(recipient, now);
  assert.equal(recipient.status, 'sent');
  assert.equal(recipient.sentAt, new Date(now).toISOString());
  recordMessage(recipient, 'one', 3);
  recordMessage(recipient, 'one', 0);
  recordMessage(recipient, 'one', -1);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'sent');
  assert.equal(recipient.ack, 3);
  assert.equal(mergeAck(-1, 2), 2);
});

test('an unidentifiable text does not discard the selected image or retry either part', async (t) => {
  const client = new EventEmitter();
  const manager = new WhatsAppManager('.', () => {});
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'partial-image-'));
  const file = path.join(directory, 'imagem.png');
  fs.writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  t.after(() => {
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  manager.sessions.set('account', { status: 'ready', client });
  client.getNumberId = async () => ({ _serialized: destination });
  const sent = [];
  client.sendMessage = async (_chat, content) => {
    sent.push(typeof content === 'string' ? 'text' : 'image');
    if (typeof content === 'string') return undefined; // No usable text event, even though it could have arrived.
    return message('image-id', { type: 'image', timestamp: Math.floor(Date.now() / 1000), ack: 1 });
  };
  let failure;
  await assert.rejects(
    manager.dispatch(
      'account',
      { id: 'recipient', type: 'contact', address: '+5511912345678', body: 'Olá' },
      [{ path: file, name: 'imagem.png' }],
      0,
    ),
    (error) => {
      failure = error;
      return true;
    },
  );
  assert.deepEqual(sent, ['text', 'image']);
  assert.deepEqual(failure.messageIds, ['image-id']);
  assert.equal(failure.messageAcks['image-id'], 1);
  assert.equal(failure.partErrors.length, 1);
  assert.equal(failure.partErrors[0].part, 'Texto');
  const recipient = { status: 'uncertain', expectedMessages: 2 };
  recordMessage(recipient, 'image-id', 1);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'uncertain');
});

test('a failed attachment does not discard later attachments and disconnect stops the remaining parts', async (t) => {
  const client = new EventEmitter();
  const manager = new WhatsAppManager('.', () => {});
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'media-sequence-'));
  const file = path.join(directory, 'arquivo.txt');
  fs.writeFileSync(file, 'Arquivo de teste');
  t.after(() => {
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  manager.sessions.set('account', { status: 'ready', client });
  client.getNumberId = async () => ({ _serialized: destination });
  let calls = 0;
  client.sendMessage = async (_chat, content) => {
    calls++;
    return message(`part-${calls}`, {
      timestamp: Math.floor(Date.now() / 1000),
      ack: calls === 2 ? -1 : 1,
    });
  };
  const recipient = { id: 'recipient', type: 'contact', address: '+5511912345678', body: 'Olá' };
  const files = [
    { path: file, name: 'primeiro.txt' },
    { path: file, name: 'segundo.txt' },
  ];
  await assert.rejects(
    manager.dispatch('account', recipient, files, 0),
    (error) =>
      error.partErrors.length === 1 &&
      error.partErrors[0].part.includes('primeiro.txt') &&
      error.messageIds.includes('part-3'),
  );
  assert.equal(calls, 3);
  calls = 0;
  client.sendMessage = async () => {
    calls++;
    manager.sessions.get('account').status = 'disconnected';
    return message('text-before-disconnect', { ack: 1 });
  };
  await assert.rejects(
    manager.dispatch('account', recipient, files, 0),
    (error) => error.partErrors.length === 2 && /conexão foi interrompida/.test(error.message),
  );
  assert.equal(calls, 1);
});

test('all text and attachment parts must be confirmed; partial or unknown parts stay uncertain', () => {
  const recipient = { status: 'uncertain', expectedMessages: 2, error: 'Falha na segunda parte' };
  recordMessage(recipient, 'text', 2);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'uncertain');
  recordMessage(recipient, 'media', 0);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'confirming');
  recordMessage(recipient, 'media', -1);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'uncertain');
  assert.match(recipient.error, /Entrega parcial/);
  recordMessage(recipient, 'media', 2);
  refreshDelivery(recipient);
  assert.equal(recipient.status, 'sent');
  assert.equal(recipient.ack, 2);
  assert.match(recipient.lastError, /Entrega parcial/);
  const failed = { status: 'confirming', expectedMessages: 1 };
  recordMessage(failed, 'failed', -1);
  refreshDelivery(failed);
  assert.equal(failed.status, 'failed');
});

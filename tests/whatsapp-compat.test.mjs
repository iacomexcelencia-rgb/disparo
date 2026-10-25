import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { sendTrackedMessage } from '../server/outbound.mjs';
const require = createRequire(import.meta.url);
const { LoadUtils } = require('whatsapp-web.js/src/util/Injected/Utils.js');
const WA = require('whatsapp-web.js');

function browserFixture(idProperty = '$1') {
  const destination = '5511912345678@c.us';
  const wid = {
    [idProperty]: destination,
    isLid: () => false,
    isGroup: () => false,
    isStatus: () => false,
  };
  const stored = new Map();
  const calls = [];
  class MsgKey {
    constructor({ id, to }) {
      this.id = id;
      this.remote = to;
      this.fromMe = true;
      this[idProperty] = `true_${destination}_${id}`;
    }
    static async newId() {
      return 'unique-message';
    }
  }
  const modules = {
    WAWebChatGetters: { getIsNewsletter: () => false, getIsBroadcast: () => false },
    WALinkify: { findLink: () => undefined, findLinks: () => [] },
    WAWebUserPrefsMeUser: { getMaybeMeLidUser: () => wid, getMaybeMePnUser: () => wid },
    WAWebMsgKey: MsgKey,
    WAWebGetEphemeralFieldsMsgActionsUtils: { getEphemeralFields: () => ({}) },
    WAWebCollections: { Msg: { get: (key) => stored.get(key) } },
    WAWebSendMsgChatAction: {
      addAndSendMsgToChat: (_chat, payload) => {
        calls.push(payload);
        // WhatsApp's model constructor uses this private slot ahead of public id.
        const internalId = Object.hasOwn(payload, '__x_id') ? payload.__x_id : payload.id;
        if (!internalId?.id) throw new Error('Data passed to getter must include an id property');
        const model = {
          id: payload.id,
          body: payload.body,
          caption: payload.caption,
          mediaObject: payload.type === 'image',
          serialize: () => ({ ...payload, id: { ...payload.id }, from: wid, to: wid }),
        };
        stored.set(payload.id[idProperty], model);
        return [Promise.resolve(model), Promise.resolve()];
      },
    },
  };
  const context = vm.createContext({
    window: {
      require: (name) => {
        if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
        return modules[name];
      },
    },
  });
  vm.runInContext(`(${LoadUtils.toString()})()`, context);
  context.window.WWebJS.processMediaData = async (media) => ({
    __x_id: { opaqueMediaId: 'not-a-message-key' },
    type: 'image',
    preview: 'preview',
    toJSON: () => ({
      type: 'image',
      directPath: '/test-only',
      filehash: 'hash',
      size: Buffer.from(media.data, 'base64').length,
    }),
  });
  return { context, api: context.window.WWebJS, chat: { id: wid }, destination, calls };
}

test('installed upstream send reproduces old MediaData ID collision and fixes image model construction', async () => {
  const fixture = browserFixture();
  const source = fixture.api.sendMessage.toString();
  const brokenSource = source.replace(
    /if \(message\.__x_id\) \{\s*delete message\.__x_id;\s*\}/,
    '',
  );
  assert.notEqual(brokenSource, source);
  const brokenSend = vm.runInContext(`(${brokenSource})`, fixture.context);
  const media = { data: Buffer.from('image-bytes').toString('base64'), mimetype: 'image/jpeg' };
  await assert.rejects(brokenSend(fixture.chat, '', { media }), /Data passed to getter/);
  const sent = await fixture.api.sendMessage(fixture.chat, '', { media, waitUntilMsgSent: true });
  assert.equal(sent.id.$1, `true_${fixture.destination}_unique-message`);
  assert.equal(Object.hasOwn(fixture.calls.at(-1), '__x_id'), false);
  assert.equal(fixture.calls.at(-1).directPath, '/test-only');
  assert.equal(fixture.calls.at(-1).type, 'image');
});

for (const idProperty of ['$1', '_serialized'])
  test(`real injected send and Message class preserve ${idProperty} identifiers through tracking`, async () => {
    const fixture = browserFixture(idProperty);
    const client = new EventEmitter();
    client.sendMessage = async () => {
      const model = await fixture.api.sendMessage(fixture.chat, 'Olá', { waitUntilMsgSent: true });
      const message = new WA.Message(client, fixture.api.getMessageModel(model));
      client.emit('message_ack', message, 2);
      return message;
    };
    const result = await sendTrackedMessage(client, fixture.destination, 'Olá');
    assert.equal(result.messageId, `true_${fixture.destination}_unique-message`);
    assert.equal(result.ack, 2);
  });

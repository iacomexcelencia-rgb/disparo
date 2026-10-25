import fs from 'node:fs';
import path from 'node:path';
import { id } from '../store.mjs';
import { requireItem } from '../http.mjs';
import { upload } from '../uploads.mjs';

export function installAttachmentRoutes(api, { store, dataDir }) {
  api.post('/attachments', upload.single('file'), (request, response) => {
    if (!request.file || request.file.size === 0)
      throw new Error('Selecione um arquivo não vazio de até 25 MB.');
    const attachmentId = id();
    const extension = path
      .extname(request.file.originalname)
      .slice(0, 12)
      .replace(/[^.a-z0-9]/gi, '');
    const directory = path.join(dataDir, 'attachments');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, attachmentId + extension);
    fs.writeFileSync(file, request.file.buffer);
    const attachment = {
      id: attachmentId,
      name: path.basename(request.file.originalname),
      path: file,
      size: request.file.size,
      mimetype: request.file.mimetype,
      createdAt: new Date().toISOString(),
    };
    store.data.attachments.push(attachment);
    store.save();
    const { path: _, ...publicAttachment } = attachment;
    response.status(201).json(publicAttachment);
  });
  api.get('/attachments/:id/download', (request, response) => {
    const attachment = requireItem(store.data.attachments, request.params.id, 'Anexo');
    if (!fs.existsSync(attachment.path))
      throw Object.assign(new Error('O arquivo do anexo não está disponível.'), { status: 404 });
    response.download(attachment.path, attachment.name);
  });
}

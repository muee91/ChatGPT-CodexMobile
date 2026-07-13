/**
 * 测试 server/static-service.js：本地文件服务、可编辑扩展名与安全路径。
 *
 * Keywords: static-service, test, local-file
 *
 * Exports: 无导出，内含用例
 *
 * Inward: static-service.js
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticService } from './static-service.js';

const MINIMAL_DOCX_BASE64 = 'UEsDBBQAAAAIAERpslzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgARGmyXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgARGmyXEu+PFPNAAAAPgEAABEAAAB3b3JkL2RvY3VtZW50LnhtbHVPMU4DMRDs84qVe+KDAqHTnVOA6JBSgKgde0msnHctr8ldfo99Ih00oxmNZnZ22C1xggtmCUyjut92CpAc+0DHUX28v949KZBiyduJCUd1RVE7sxnm3rP7jkgFagNJP4/qVErqtRZ3wmhlywmpel+coy1V5qOeOfuU2aFIPRAn/dB1jzraQMpsAGrrgf210VUkUyE3KOaZPS5vfAgTwmetgX3GS8B50M1tmFdMf6Zf2C3gmH4/BYl8Rigo5f+8oCv7rNdh+rassdvn5gdQSwECFAMUAAAACABEabJc13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAERpslwgG4bqsgAAAC4BAAALAAAAAAAAAAAAAACAASIBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAERpslxLvjxTzQAAAD4BAAARAAAAAAAAAAAAAACAAf0BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAD5AgAAAAA=';
const MINIMAL_XLSX_BASE64 = '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';
const MINIMAL_PPTX_BASE64 = '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';

function req(headers = {}) {
  return { headers };
}

function res() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk = '') {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      this.body = Buffer.concat([this.body, buffer]);
    },
    end(body = '') {
      if (body) {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        this.body = Buffer.concat([this.body, buffer]);
      }
    }
  };
}

async function withTempService(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-static-'));
  const clientDist = path.join(root, 'dist');
  const generatedRoot = path.join(root, 'generated');
  const certPath = path.join(root, 'tls', 'root.cer');
  await fs.mkdir(clientDist, { recursive: true });
  await fs.mkdir(generatedRoot, { recursive: true });
  await fs.mkdir(path.dirname(certPath), { recursive: true });
  await fs.writeFile(path.join(clientDist, 'index.html'), '<h1>CodexMobile</h1>');
  await fs.writeFile(path.join(clientDist, 'worker.mjs'), 'export default null;');
  await fs.writeFile(path.join(generatedRoot, 'image.png'), Buffer.from([137, 80, 78, 71]));
  await fs.writeFile(path.join(root, 'report.md'), '# Report');
  await fs.writeFile(path.join(root, 'page.html'), '<h1 onclick="bad()">报告</h1><script>alert(1)</script>');
  await fs.writeFile(path.join(root, 'table.csv'), '姓名,金额\n青甜,1200\n');
  await fs.writeFile(path.join(root, 'brief.pdf'), Buffer.from('%PDF-1.7'));
  await fs.writeFile(path.join(root, 'brief.docx'), Buffer.from(MINIMAL_DOCX_BASE64, 'base64'));
  await fs.writeFile(path.join(root, 'table.xlsx'), Buffer.from(MINIMAL_XLSX_BASE64, 'base64'));
  await fs.writeFile(path.join(root, 'slides.pptx'), Buffer.from(MINIMAL_PPTX_BASE64, 'base64'));
  await fs.writeFile(path.join(root, 'clip.mp3'), Buffer.from([0x49, 0x44, 0x33, 0x04]));
  await fs.writeFile(path.join(root, '甘肃临夏萌宠乐园丨政府汇报项目前置简介.md'), '# 中文文件名');
  await fs.writeFile(path.join(root, 'secret.txt'), 'secret');
  await fs.writeFile(certPath, 'cert');
  try {
    await fn(createStaticService({ clientDist, generatedRoot, httpsRootCaPath: certPath }), root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('serveStatic returns a normal PWA file', async () => {
  await withTempService(async (service) => {
    const response = res();
    await service.serveStatic(req(), response, new URL('http://local/'));

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.equal(response.body.toString('utf8'), '<h1>CodexMobile</h1>');
  });
});

test('serveStatic returns mjs files as JavaScript for module workers', async () => {
  await withTempService(async (service) => {
    const response = res();
    await service.serveStatic(req(), response, new URL('http://local/worker.mjs'));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/javascript; charset=utf-8');
  });
});

test('serveStatic blocks traversal outside the PWA root', async () => {
  await withTempService(async (service) => {
    const response = res();
    await service.serveStatic(req(), response, new URL('http://local/..%2fsecret.txt'));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.toString('utf8'), 'Forbidden');
  });
});

test('serveStatic returns generated files from the generated root', async () => {
  await withTempService(async (service) => {
    const response = res();
    await service.serveStatic(req(), response, new URL('http://local/generated/image.png'));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.deepEqual([...response.body], [137, 80, 78, 71]);
  });
});

test('sendLocalFile serves markdown files inline from absolute paths', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'report.md');
    const response = res();
    await service.sendLocalFile(req(), response, new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/markdown; charset=utf-8');
    assert.match(response.headers['content-disposition'], /^inline;/);
  });
});

test('sendLocalFile serves pdf files with pdf content type', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'brief.pdf');
    const response = res();
    await service.sendLocalFile(req(), response, new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/pdf');
    assert.match(response.headers['content-disposition'], /^inline;/);
  });
});

test('sendLocalFile serves apk files as attachment with the original filename', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'CodexMobile-2.0.5-debug.apk');
    await fs.writeFile(filePath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const response = res();
    await service.sendLocalFile(req(), response, new URL(`http://local/api/local-file/CodexMobile-2.0.5-debug.apk?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/octet-stream');
    assert.match(response.headers['content-disposition'], /^attachment;/);
    assert.match(response.headers['content-disposition'], /filename="CodexMobile-2\.0\.5-debug\.apk"/);
  });
});

test('sendLocalFile respects explicit download requests for previewable files', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'report.md');
    const response = res();
    await service.sendLocalFile(req(), response, new URL(`http://local/api/local-file/report.md?path=${encodeURIComponent(filePath)}&download=1`));

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-disposition'], /^attachment;/);
  });
});

test('sendLocalFilePreview converts docx files into sanitized html', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'brief.docx');
    const response = res();
    await service.sendLocalFilePreview(req(), response, new URL(`http://local/api/local-file-preview?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    const payload = JSON.parse(response.body.toString('utf8'));
    assert.equal(payload.kind, 'word');
    assert.match(payload.html, /CodexMobile Word Preview/);
    assert.doesNotMatch(payload.html, /<script/i);
    assert.ok(payload.mtimeMs > 0);
  });
});

test('sendLocalFilePreview returns sanitized html preview for local html files', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'page.html');
    const response = res();
    await service.sendLocalFilePreview(req(), response, new URL(`http://local/api/local-file-preview?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body.toString('utf8'));
    assert.equal(payload.kind, 'html');
    assert.match(payload.html, /<h1>报告<\/h1>/);
    assert.doesNotMatch(payload.html, /script|onclick/i);
  });
});

test('sendLocalFilePreview returns table preview for csv files', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'table.csv');
    const response = res();
    await service.sendLocalFilePreview(req(), response, new URL(`http://local/api/local-file-preview?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body.toString('utf8'));
    assert.equal(payload.kind, 'spreadsheet');
    assert.deepEqual(payload.sheets[0].rows, [['姓名', '金额'], ['青甜', '1200']]);
  });
});

test('sendLocalFilePreview returns sheet preview for xlsx files', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'table.xlsx');
    const response = res();
    await service.sendLocalFilePreview(req(), response, new URL(`http://local/api/local-file-preview?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body.toString('utf8'));
    assert.equal(payload.kind, 'spreadsheet');
    assert.equal(payload.sheets[0].name, 'Sheet1');
    assert.deepEqual(payload.sheets[0].rows, [['姓名', '金额'], ['青甜', '1200']]);
  });
});

test('sendLocalFilePreview returns readable slide text for pptx files', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'slides.pptx');
    const response = res();
    await service.sendLocalFilePreview(req(), response, new URL(`http://local/api/local-file-preview?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body.toString('utf8'));
    assert.equal(payload.kind, 'presentation');
    assert.equal(payload.slides[0].title, '项目汇报标题');
    assert.deepEqual(payload.slides[0].texts, ['项目汇报标题', '第一页重点内容']);
  });
});

test('sendLocalFile streams byte ranges for media-style preview requests', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'brief.pdf');
    const response = res();
    await service.sendLocalFile(
      req({ range: 'bytes=1-3' }),
      response,
      new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`)
    );

    assert.equal(response.statusCode, 206);
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers['content-range'], 'bytes 1-3/8');
    assert.equal(response.headers['content-length'], 3);
    assert.equal(response.body.toString('utf8'), 'PDF');
  });
});

test('sendLocalFile exposes audio mime types for native preview controls', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'clip.mp3');
    const response = res();
    await service.sendLocalFile(req(), response, new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'audio/mpeg');
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers['content-length'], 4);
    assert.deepEqual([...response.body], [0x49, 0x44, 0x33, 0x04]);
  });
});

test('sendLocalFile tolerates Codex style line suffixes on file links', async () => {
  await withTempService(async (service, root) => {
    const filePath = `${path.join(root, 'report.md')}:12`;
    const response = res();
    await service.sendLocalFile(req(), response, new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/markdown; charset=utf-8');
    assert.equal(response.body.toString('utf8'), '# Report');
  });
});

test('sendLocalFile encodes non-ascii filenames in content-disposition', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, '甘肃临夏萌宠乐园丨政府汇报项目前置简介.md');
    const response = res();
    await service.sendLocalFile(req(), response, new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-disposition'], /filename\*=UTF-8''/);
    assert.doesNotMatch(response.headers['content-disposition'], /[\u0080-\uFFFF]/);
    assert.equal(response.body.toString('utf8'), '# 中文文件名');
  });
});

test('sendRemoteImage proxies image bytes inline without upstream attachment headers', async () => {
  const upstreamBody = Buffer.from([137, 80, 78, 71]);
  const service = createStaticService({
    clientDist: os.tmpdir(),
    generatedRoot: os.tmpdir(),
    httpsRootCaPath: path.join(os.tmpdir(), 'missing.cer'),
    fetchRemoteImage: async (url) => {
      assert.equal(url, 'https://imageobsidian.s3.bitiful.net/webpictures/a.png');
      return new Response(upstreamBody, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-disposition': 'attachment; filename="a.png"'
        }
      });
    }
  });

  const response = res();
  await service.sendRemoteImage(
    req(),
    response,
    new URL('http://local/api/remote-image?url=https%3A%2F%2Fimageobsidian.s3.bitiful.net%2Fwebpictures%2Fa.png')
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.equal(response.headers['content-disposition'], undefined);
  assert.deepEqual([...response.body], [...upstreamBody]);
});

test('writeLocalFile saves editable text files with conflict protection and backup', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'report.md');
    const initialStat = await fs.stat(filePath);
    const saveResponse = res();
    await service.writeLocalFile(
      req(),
      saveResponse,
      new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`),
      { content: '# Updated', baseMtimeMs: Math.round(initialStat.mtimeMs) }
    );

    assert.equal(saveResponse.statusCode, 200);
    const payload = JSON.parse(saveResponse.body.toString('utf8'));
    assert.equal(payload.ok, true);
    assert.ok(payload.backupPath);
    assert.equal(await fs.readFile(filePath, 'utf8'), '# Updated');
    assert.equal(await fs.readFile(payload.backupPath, 'utf8'), '# Report');

    const conflictResponse = res();
    await service.writeLocalFile(
      req(),
      conflictResponse,
      new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`),
      { content: '# Stale', baseMtimeMs: 1 }
    );

    assert.equal(conflictResponse.statusCode, 409);
    assert.equal(await fs.readFile(filePath, 'utf8'), '# Updated');
  });
});

test('deleteLocalFile removes regular files and keeps a backup copy', async () => {
  await withTempService(async (service, root) => {
    const filePath = path.join(root, 'secret.txt');
    const deleteResponse = res();

    await service.deleteLocalFile(
      req(),
      deleteResponse,
      new URL(`http://local/api/local-file?path=${encodeURIComponent(filePath)}`)
    );

    assert.equal(deleteResponse.statusCode, 200);
    const payload = JSON.parse(deleteResponse.body.toString('utf8'));
    assert.equal(payload.ok, true);
    assert.ok(payload.backupPath);
    await assert.rejects(() => fs.stat(filePath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(payload.backupPath, 'utf8'), 'secret');
  });
});

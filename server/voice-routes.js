/**
 * 语音相关 HTTP API：录音上传转写、TTS 与语音路由装配。
 *
 * Keywords: voice-routes, stt, tts, multipart-upload
 *
 * Exports:
 * - createVoiceRouteHandler — 返回语音接口处理函数。
 *
 * Inward（本模块依赖/组装的关键符号）: http-utils、upload-service、voice-transcriber、voice-speaker。
 *
 * Outward（谁在用/调用场景）: server/index 挂载路由。
 *
 * 不负责: Realtime WebSocket 代理（见 realtime-voice）。
 */
import { readBody, sendJson } from './http-utils.js';
import { readVoiceUpload as defaultReadVoiceUpload } from './upload-service.js';
import { synthesizeSpeech as defaultSynthesizeSpeech } from './voice-speaker.js';
import { transcribeAudio as defaultTranscribeAudio } from './voice-transcriber.js';

function safeVoiceMessage(message, fallback) {
  return String(message || fallback)
    .replace(/sk-\[hidden\][A-Za-z0-9*._-]*/g, 'sk-[hidden]')
    .replace(/sk-[A-Za-z0-9._-]+/g, 'sk-[hidden]');
}

export function createVoiceRouteHandler({
  getCacheSnapshot,
  transcribeAudio = defaultTranscribeAudio,
  synthesizeSpeech = defaultSynthesizeSpeech,
  readVoiceUpload = defaultReadVoiceUpload,
  maxVoiceBytes,
  remoteAddress = () => ''
}) {
  if (!getCacheSnapshot) {
    throw new Error('createVoiceRouteHandler requires getCacheSnapshot');
  }

  return async function handleVoiceApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/voice/')) {
      return false;
    }

    if (method === 'POST' && pathname === '/api/voice/transcribe') {
      const startedAt = Date.now();
      try {
        const audio = await readVoiceUpload(req, { maxVoiceBytes });
        const config = getCacheSnapshot().config || {};
        const result = await transcribeAudio(audio, config);
        console.log(`[voice] transcribed size=${audio.data.length} mime=${audio.mimeType} provider=${result.provider} model=${result.model} remote=${remoteAddress(req)}`);
        sendJson(res, 200, { text: result.text || '', durationMs: Date.now() - startedAt });
      } catch (error) {
        const statusCode = error.statusCode || 502;
        const providerInfo = error.providerHost ? ` provider=${error.providerHost}` : '';
        const safeMessage = safeVoiceMessage(error.message, '语音转写失败');
        console.warn(`[voice] transcribe failed status=${statusCode}${providerInfo} remote=${remoteAddress(req)} message=${safeMessage}`);
        sendJson(res, statusCode, {
          error: safeMessage || '语音转写失败'
        });
      }
      return true;
    }

    if (method === 'POST' && pathname === '/api/voice/speech') {
      const startedAt = Date.now();
      try {
        const body = await readBody(req);
        const config = getCacheSnapshot().config || {};
        const result = await synthesizeSpeech(body.text, config);
        console.log(`[voice] synthesized bytes=${result.data.length} provider=${result.provider} model=${result.model} voice=${result.voice} remote=${remoteAddress(req)}`);
        res.writeHead(200, {
          'content-type': result.mimeType,
          'content-length': result.data.length,
          'cache-control': 'no-store',
          'x-codexmobile-duration-ms': String(Date.now() - startedAt)
        });
        res.end(result.data);
      } catch (error) {
        const statusCode = error.statusCode || 502;
        const safeMessage = safeVoiceMessage(error.message, '语音合成失败');
        console.warn(`[voice] speech failed status=${statusCode} remote=${remoteAddress(req)} message=${safeMessage}`);
        sendJson(res, statusCode, {
          error: safeMessage || '语音合成失败'
        });
      }
      return true;
    }

    sendJson(res, 404, { error: 'Voice API route not found' });
    return true;
  };
}

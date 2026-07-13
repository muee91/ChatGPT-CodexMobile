/**
 * 摄像头二维码扫描器：封装前端扫码生命周期与配对 URL 解析入口。
 *
 * Keywords: qr, camera, pairing, scanner
 *
 * Exports:
 * - isQrScannerSupported — 判断当前环境是否能启动摄像头扫码。
 * - startQrScanner / stopQrScanner — 管理扫描器实例与摄像头流。
 *
 * Inward（本模块依赖/组装的关键符号）: qr-scanner、浏览器 MediaDevices。
 *
 * Outward（谁在用/调用场景）: app/PairingScreen.jsx。
 *
 * 不负责: 扫码结果的业务语义判断。
 */
import QrScanner from 'qr-scanner';
import qrWorkerUrl from 'qr-scanner/qr-scanner-worker.min.js?url';

QrScanner.WORKER_PATH = qrWorkerUrl;

export function isQrScannerSupported() {
  return typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export async function startQrScanner(videoElement, { onDecode, onError } = {}) {
  if (!videoElement) {
    throw new Error('扫码视频容器不存在');
  }
  const scanner = new QrScanner(
    videoElement,
    (result) => onDecode?.(typeof result === 'string' ? result : result?.data || ''),
    {
      preferredCamera: 'environment',
      highlightScanRegion: false,
      highlightCodeOutline: false,
      returnDetailedScanResult: true,
      onDecodeError: (error) => {
        if (/No QR code found/i.test(String(error?.message || ''))) {
          return;
        }
        onError?.(error);
      }
    }
  );
  await scanner.start();
  return scanner;
}

export async function stopQrScanner(scanner) {
  if (!scanner) {
    return;
  }
  try {
    await scanner.stop();
  } finally {
    scanner.destroy();
  }
}

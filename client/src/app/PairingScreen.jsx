/**
 * 设备配对门禁：支持扫码、局域网发现与手动输入配对码完成 Cookie 登录。
 *
 * Keywords: pairing, qr, lan-scan, device-auth, cookie
 *
 * Exports:
 * - default — `PairingScreen`（未认证时由 `App` 全屏展示）。
 *
 * Inward: `pairing-flow`、`server-scan`、`qr-scanner`、`api`、`/api/status.pairing`。
 *
 * Outward: `App.jsx` 在 `authenticated === false` 时渲染。
 */

import { Camera, Check, Loader2, RefreshCw, ScanSearch, Server, Terminal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getServerUrl, normalizeServerUrl, setServerUrl } from '../api.js';
import {
  completePairing,
  normalizePairingCode,
  pairingRequestFromSearch,
  pairingRequestFromText,
  pairingServerUrlFromQr,
  startPairingRequest
} from '../pairing-flow.js';
import { isQrScannerSupported, startQrScanner, stopQrScanner } from '../qr-scanner.js';
import { scanLanServers } from '../server-scan.js';
import { unlockPairingPageScroll } from './pairing-scroll-lock.js';

const SERVER_URL_PLACEHOLDER = '192.168.10.133:3321';
const DEFAULT_SERVER_URL = normalizeServerUrl(SERVER_URL_PLACEHOLDER);

export default function PairingScreen({ pairing: pairingStatus = {}, authCanPair = true, onPaired, onServerChanged }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairingRequest, setPairingRequest] = useState(null);
  const [requestingPair, setRequestingPair] = useState(false);
  const [inputActive, setInputActive] = useState(false);
  const [serverInput, setServerInput] = useState(() => getServerUrl() || DEFAULT_SERVER_URL);
  const [serverMessage, setServerMessage] = useState('');
  const [serverScanResults, setServerScanResults] = useState([]);
  const [serverScanLoading, setServerScanLoading] = useState(false);
  const [serverScanDiagnostics, setServerScanDiagnostics] = useState(null);
  const [serverScanDiagnosticsOpen, setServerScanDiagnosticsOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const autoPairRef = useRef(pairingRequestFromSearch(globalThis.location?.search || ''));
  const formRef = useRef(null);
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const scannerSupported = useMemo(() => isQrScannerSupported(), []);
  const terminalCommands = Array.isArray(pairingStatus?.commands) && pairingStatus.commands.length
    ? pairingStatus.commands
    : ['cd <CodexMobile 项目目录>', 'npm run pair'];

  function pairingErrorMessage(pairError) {
    if (pairError?.status === 410 || /expired/i.test(pairError?.message || '')) {
      return '这个配对码已过期，请在电脑上重新运行 npm run pair。';
    }
    if (pairError?.status === 403 || pairError?.status === 404 || /invalid|not found/i.test(pairError?.message || '')) {
      return '配对码无效，请检查电脑终端里的 10 位代码，或重新运行 npm run pair。';
    }
    return pairError?.message || '配对失败，请确认电脑端 CodexMobile 正在运行。';
  }

  function pairingRequestErrorMessage(pairError) {
    if (pairError?.status === 403) {
      return '当前网络不能直接从手机发起配对。请先选中电脑地址，再在电脑端执行 npm run pair。';
    }
    if (pairError?.status === 429 || pairError?.retryAfterSeconds) {
      return '配对请求太频繁，请稍后再试。';
    }
    return pairError?.message || '无法发起配对请求，请确认手机和电脑在同一网络。';
  }

  function scannerErrorMessage(rawMessage = '') {
    const message = String(rawMessage || '');
    if (/notallowed|permission denied/i.test(message)) {
      return '没有摄像头权限，请允许相机访问后重试。';
    }
    if (/notfound|overconstrained/i.test(message)) {
      return '当前设备没有可用的后置摄像头。';
    }
    return '无法启动扫码，请确认相机权限和当前设备支持情况。';
  }

  useEffect(() => unlockPairingPageScroll(), []);

  function activeServerUrl() {
    return normalizeServerUrl(serverInput) || getServerUrl();
  }

  useEffect(() => () => {
    void stopQrScanner(scannerRef.current);
    scannerRef.current = null;
  }, []);

  useEffect(() => {
    const fromSearch = autoPairRef.current;
    if (!fromSearch) {
      return;
    }
    setCode(fromSearch.code);
    if (typeof globalThis.window?.history?.replaceState === 'function') {
      globalThis.window.history.replaceState(null, '', '/');
    }
  }, []);

  useEffect(() => {
    const fromSearch = autoPairRef.current;
    if (!fromSearch || pairing) {
      return;
    }
    autoPairRef.current = null;
    setPairing(true);
    setError('');
    const pairingServerUrl = pairingServerUrlFromQr(fromSearch.serverUrl, activeServerUrl());
    if (fromSearch.serverUrl) {
      setServerInput(setServerUrl(pairingServerUrl));
    }
    completePairing({ requestId: fromSearch.requestId, code: fromSearch.code, serverUrl: pairingServerUrl })
      .then(() => onPaired())
      .catch((pairError) => setError(pairingErrorMessage(pairError)))
      .finally(() => setPairing(false));
  }, [onPaired, pairing]);

  useEffect(() => {
    if (!scannerOpen) {
      setScannerBusy(false);
      setScannerMessage('');
      void stopQrScanner(scannerRef.current);
      scannerRef.current = null;
      return;
    }
    let cancelled = false;
    setScannerBusy(true);
    setScannerMessage('正在启动摄像头…');
    startQrScanner(videoRef.current, {
      onDecode: async (text) => {
        if (cancelled || pairing) {
          return;
        }
        const parsed = pairingRequestFromText(text);
        if (!parsed) {
          setScannerMessage('识别到了二维码，但不是 CodexMobile 配对二维码。');
          return;
        }
        const lockedServer = normalizeServerUrl(serverInput) || '';
        if (lockedServer && parsed.serverUrl && lockedServer !== parsed.serverUrl) {
          setScannerMessage(`二维码来自 ${parsed.serverUrl}，和当前选中的 ${lockedServer} 不一致。`);
          return;
        }
        setPairing(true);
        setError('');
        setScannerMessage('已识别二维码，正在配对…');
        try {
          const pairingServerUrl = pairingServerUrlFromQr(parsed.serverUrl, activeServerUrl());
          if (parsed.serverUrl) {
            setServerInput(setServerUrl(pairingServerUrl));
          }
          await completePairing({ requestId: parsed.requestId, code: parsed.code, serverUrl: pairingServerUrl });
          await stopQrScanner(scannerRef.current);
          scannerRef.current = null;
          setScannerOpen(false);
          await onPaired?.();
        } catch (pairError) {
          setError(pairingErrorMessage(pairError));
          setScannerMessage('');
        } finally {
          setPairing(false);
        }
      },
      onError: (scanError) => {
        if (!cancelled) {
          setScannerMessage(scannerErrorMessage(scanError?.message || scanError));
        }
      }
    })
      .then((scanner) => {
        if (cancelled) {
          void stopQrScanner(scanner);
          return;
        }
        scannerRef.current = scanner;
        setScannerBusy(false);
        setScannerMessage('把电脑端显示的配对二维码放进取景框。');
      })
      .catch((scanError) => {
        if (!cancelled) {
          setScannerBusy(false);
          setScannerMessage(scannerErrorMessage(scanError?.message || scanError));
        }
      });
    return () => {
      cancelled = true;
      void stopQrScanner(scannerRef.current);
      scannerRef.current = null;
    };
  }, [onPaired, pairing, scannerOpen, serverInput]);

  async function handlePair(event) {
    event.preventDefault();
    if (!code.trim()) {
      setError('请输入配对码');
      return;
    }
    setPairing(true);
    setError('');
    try {
      await completePairing({ requestId: pairingRequest?.requestId, code, serverUrl: activeServerUrl() });
      await onPaired?.();
    } catch (pairError) {
      setError(pairingErrorMessage(pairError));
    } finally {
      setPairing(false);
    }
  }

  async function handleStartPairingRequest() {
    setRequestingPair(true);
    setError('');
    try {
      const serverUrl = activeServerUrl();
      const request = await startPairingRequest({ serverUrl });
      setPairingRequest(request);
      setCode('');
      window.setTimeout(scrollFormIntoView, 120);
    } catch (pairError) {
      setError(pairingRequestErrorMessage(pairError));
    } finally {
      setRequestingPair(false);
    }
  }

  function scrollFormIntoView() {
    formRef.current?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  function handleCodeFocus() {
    setInputActive(true);
    window.setTimeout(scrollFormIntoView, 120);
    window.setTimeout(scrollFormIntoView, 360);
  }

  function diagnosticsList(value) {
    return Array.isArray(value) && value.length ? value.filter(Boolean).join(', ') : '-';
  }

  function handleSaveServerUrl(event) {
    event.preventDefault();
    const normalized = normalizeServerUrl(serverInput);
    if (!normalized) {
      setServerMessage('请输入局域网地址或完整地址。');
      return;
    }
    setServerUrl(normalized);
    setServerInput(normalized);
    setServerMessage('服务地址已保存。');
    onServerChanged?.();
  }

  function handleUseScannedServerUrl(url) {
    const normalized = setServerUrl(url);
    setServerInput(normalized);
    setServerMessage(`已选中 ${normalized}。请在电脑端执行 npm run pair 后扫码。`);
    onServerChanged?.();
  }

  async function handleScanServerSubnet() {
    setServerScanLoading(true);
    setServerMessage('正在扫描当前设备所在局域网…');
    setError('');
    try {
      const { seeds, results, diagnostics } = await scanLanServers({
        serverInput,
        currentServerUrl: getServerUrl(),
        locationHref: globalThis.location?.href || ''
      });
      setServerScanResults(results);
      setServerScanDiagnostics(diagnostics || null);
      setServerScanDiagnosticsOpen(results.length === 0);
      if (results.length === 1) {
        handleUseScannedServerUrl(results[0].url);
      } else if (results.length > 1) {
        setServerMessage(`找到 ${results.length} 台可连接电脑，请先选一台。`);
      } else if (seeds.length) {
        setServerMessage('当前网段没有找到可用地址。');
      } else {
        setServerMessage('暂时拿不到手机本机网段，请检查 Wi-Fi 和局域网权限。');
      }
    } catch (scanError) {
      setServerScanResults([]);
      setServerScanDiagnostics(null);
      setServerMessage(scanError?.message || '局域网扫描失败。');
    } finally {
      setServerScanLoading(false);
    }
  }

  return (
    <main className={inputActive ? 'pairing-screen is-input-active' : 'pairing-screen'}>
      <div className="pairing-panel">
        <div className="pairing-brand" aria-label="CodexMobile">
          <img className="pairing-logo" src="/codex-icon-180.png" alt="" aria-hidden="true" />
          <img className="pairing-wordmark" src="/pairing-wordmark.png" alt="" aria-hidden="true" />
        </div>
        <h1>连接你的 Codex</h1>
        <p className="pairing-lead">
          优先用手机扫码电脑端二维码；如果不方便，再输入 10 位配对码。
        </p>

        <form className="pairing-form" onSubmit={handleSaveServerUrl}>
          <label htmlFor="server-url">电脑地址</label>
          <div className="pairing-input-row pairing-server-input-row">
            <input
              id="server-url"
              className="pairing-url-input"
              inputMode="url"
              placeholder={SERVER_URL_PLACEHOLDER}
              value={serverInput}
              onBlur={() => setInputActive(false)}
              onFocus={handleCodeFocus}
              onChange={(event) => {
                setServerInput(event.target.value);
                setServerMessage('');
              }}
            />
            <button type="submit" disabled={!serverInput.trim()}>
              <Server size={18} />
              保存
            </button>
          </div>
          <div className="pairing-actions">
            <button type="button" className="pairing-secondary-button" onClick={handleScanServerSubnet} disabled={serverScanLoading}>
              {serverScanLoading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              扫描当前局域网
            </button>
          </div>
          {serverMessage ? <p className="pairing-request-hint">{serverMessage}</p> : null}
          {serverScanResults.length ? (
            <div className="pairing-saved-list" aria-label="扫描到的电脑">
              {serverScanResults.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  className={`pairing-saved-item ${normalizeServerUrl(serverInput) === item.url ? 'is-active' : ''}`}
                  onClick={() => handleUseScannedServerUrl(item.url)}
                >
                  <strong>{item.hostName || item.url}</strong>
                  {item.hostName ? <span>{item.url}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {serverScanDiagnostics ? (
            <div className="pairing-scan-debug-wrap">
              <button
                type="button"
                className="pairing-scan-debug-toggle"
                onClick={() => setServerScanDiagnosticsOpen((value) => !value)}
                aria-expanded={serverScanDiagnosticsOpen ? 'true' : 'false'}
              >
                {serverScanDiagnosticsOpen ? '收起扫描诊断' : '查看扫描诊断'}
              </button>
              {serverScanDiagnosticsOpen ? (
                <div className="pairing-scan-diagnostics" aria-label="扫描诊断">
                  <code>finalMode: {serverScanDiagnostics.finalMode || '-'}</code>
                  <code>localAddresses: {diagnosticsList(serverScanDiagnostics.localAddresses)}</code>
                  <code>localSeeds: {diagnosticsList(serverScanDiagnostics.localSeeds)}</code>
                  <code>fallbackSeeds: {diagnosticsList(serverScanDiagnostics.fallbackSeeds)}</code>
                  <code>native.localResults: {diagnosticsList(serverScanDiagnostics.native?.localResults?.map((item) => item?.url))}</code>
                  <code>native.fallbackResults: {diagnosticsList(serverScanDiagnostics.native?.fallbackResults?.map((item) => item?.url))}</code>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>

        <div className="pairing-terminal" aria-label="电脑终端命令">
          <div className="pairing-terminal-title">
            <Terminal size={15} />
            <span>电脑终端</span>
          </div>
          {terminalCommands.map((command) => (
            <code key={command}>{command}</code>
          ))}
        </div>

        <div className="pairing-actions">
          <button
            type="button"
            className="pairing-secondary-button"
            onClick={() => setScannerOpen((value) => !value)}
            disabled={!scannerSupported || pairing}
          >
            {scannerOpen ? <X size={17} /> : <Camera size={17} />}
            {scannerOpen ? '关闭扫码' : '扫码配对'}
          </button>
          <button
            type="button"
            className="pairing-secondary-button"
            onClick={handleStartPairingRequest}
            disabled={!authCanPair || requestingPair || pairing}
          >
            {requestingPair ? <Loader2 className="spin" size={17} /> : <ScanSearch size={17} />}
            在手机上发起配对
          </button>
          {!scannerSupported ? (
            <p className="pairing-request-hint">当前环境不支持摄像头扫码，请改用安卓客户端或手动输入配对码。</p>
          ) : null}
          {pairingRequest?.requestId ? (
            <p className="pairing-request-hint">已在电脑端生成配对码，请查看终端或系统通知后输入。</p>
          ) : !authCanPair ? (
            <p className="pairing-request-hint">当前网络不能直接从手机发起配对。请先选中电脑地址，再在电脑端执行 npm run pair。</p>
          ) : null}
        </div>

        {scannerOpen ? (
          <div className="pairing-scanner" aria-label="扫码取景框">
            <video ref={videoRef} className="pairing-scanner-video" muted playsInline />
            <div className="pairing-scanner-overlay" aria-hidden="true" />
            <p className="pairing-request-hint">
              {scannerBusy ? '正在启动摄像头…' : scannerMessage || '把电脑端二维码放进取景框。'}
            </p>
          </div>
        ) : null}

        <form ref={formRef} className="pairing-form" onSubmit={handlePair}>
          <label htmlFor="pairing-code">配对码</label>
          <div className="pairing-input-row">
            <input
              id="pairing-code"
              inputMode="text"
              placeholder="输入 10 位代码"
              value={code}
              onBlur={() => setInputActive(false)}
              onFocus={handleCodeFocus}
              onChange={(event) => setCode(normalizePairingCode(event.target.value, 10))}
            />
            <button type="submit" disabled={!code.trim() || pairing}>
              {pairing ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
              信任这台设备
            </button>
          </div>
        </form>
        {error ? <div className="pairing-error">{error}</div> : null}
        <p className="pairing-footnote">
          电脑端执行 npm run pair 会同时给出配对链接和二维码。配对成功后，这台手机会保存为可信设备。
        </p>
      </div>
    </main>
  );
}

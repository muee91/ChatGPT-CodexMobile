/**
 * 区分只读应用资源与可写运行数据。开发模式默认都在仓库内，桌面安装包可通过
 * CODEXMOBILE_DATA_ROOT 把状态、上传和日志放到用户数据目录。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const CODEXMOBILE_SOURCE_ROOT = path.resolve(moduleDirectory, '..');
export const CODEXMOBILE_DATA_ROOT = path.resolve(
  String(process.env.CODEXMOBILE_DATA_ROOT || '').trim() || CODEXMOBILE_SOURCE_ROOT
);
export const CODEXMOBILE_RUNTIME_ROOT = path.join(CODEXMOBILE_DATA_ROOT, '.codexmobile');

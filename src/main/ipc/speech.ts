import { IPC_CHANNELS } from '@shared/types';
import {
  SPEECH_SAMPLE_RATE,
  type SpeechStatusDto,
  type SpeechTranscribeResult,
} from '@shared/types/speech';
import { ipcMain, systemPreferences } from 'electron';
import {
  cancelSpeechDownload,
  deleteSpeechAssets,
  getSpeechStatus,
  setSpeechProgressSink,
  startSpeechDownload,
  transcribeSpeech,
} from '../services/speech/service';
import { sendToAllWindows } from '../windows/createAppWindow';
import { isMainWebContents } from '../windows/MainWindow';
import { isSettingsWebContents } from '../windows/SettingsWindow';

const UNSUPPORTED: SpeechStatusDto = { state: 'unsupported', approxBytes: 0, downloadedBytes: 0 };

function isTrustedWindow(webContentsId: number): boolean {
  return isMainWebContents(webContentsId) || isSettingsWebContents(webContentsId);
}

export function registerSpeechHandlers(): void {
  // 设置窗下载，主窗口据 done 事件重查状态决定是否显示麦克风
  // （主窗口 UI 在 WebContentsView 里，win.webContents.send 送不到）
  setSpeechProgressSink((progress) => sendToAllWindows(IPC_CHANNELS.SPEECH_PROGRESS, progress));

  ipcMain.handle(IPC_CHANNELS.SPEECH_STATUS, (event) =>
    isTrustedWindow(event.sender.id) ? getSpeechStatus() : UNSUPPORTED
  );

  ipcMain.handle(IPC_CHANNELS.SPEECH_DOWNLOAD, (event) => {
    if (!isTrustedWindow(event.sender.id)) return false;
    void startSpeechDownload();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SPEECH_CANCEL, (event) =>
    isTrustedWindow(event.sender.id) ? cancelSpeechDownload() : false
  );

  ipcMain.handle(IPC_CHANNELS.SPEECH_DELETE, (event) =>
    isTrustedWindow(event.sender.id) ? deleteSpeechAssets() : false
  );

  ipcMain.handle(
    IPC_CHANNELS.SPEECH_TRANSCRIBE,
    (event, audio: unknown): Promise<SpeechTranscribeResult> | SpeechTranscribeResult => {
      if (!isMainWebContents(event.sender.id)) return { ok: false, error: 'disabled' };
      if (!(audio instanceof Float32Array)) return { ok: false, error: 'invalid-audio' };
      return transcribeSpeech(audio, SPEECH_SAMPLE_RATE);
    }
  );

  // macOS 必须由主进程发起授权；拒绝过则只能去系统设置里打开
  ipcMain.handle(IPC_CHANNELS.SPEECH_MIC_ACCESS, async (event) => {
    if (!isMainWebContents(event.sender.id)) return false;
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });
}

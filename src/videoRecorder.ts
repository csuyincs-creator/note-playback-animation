export type RecordingState = 'idle' | 'preparing' | 'recording' | 'finalizing' | 'downloaded' | 'canceled' | 'error';
export type RecorderCallbacks = {onState: (state: RecordingState, message?: string) => void};

const MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

export function supportedRecordingTypes(isTypeSupported: (mimeType: string) => boolean) {
  return MIME_TYPES.filter(isTypeSupported);
}

export function recordingFilename(title: string, mimeType: string, date = new Date()) {
  const extension = mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'score-motion';
  return `${safeTitle}-${date.toISOString().slice(0, 10)}.${extension}`;
}

export function beginVideoRecording(canvas: HTMLCanvasElement, audio: MediaStream, callbacks: RecorderCallbacks, title = 'score-motion') {
  if (!canvas.captureStream) throw new Error('当前浏览器不支持从画布录制视频。');
  if (!window.MediaRecorder) throw new Error('当前浏览器不支持 MediaRecorder 视频录制。');
  const audioTracks = audio.getAudioTracks();
  if (!audioTracks.length) throw new Error('录制音轨尚未准备好，请先点击播放后再试。');
  const supported = supportedRecordingTypes(type => MediaRecorder.isTypeSupported(type));
  if (!supported.length) throw new Error('当前浏览器没有可用的 MP4 或 WebM 录制格式。');
  const video = canvas.captureStream(30);
  const stream = new MediaStream([...video.getVideoTracks(), ...audioTracks]);
  let recorder: MediaRecorder | undefined;
  let cancelled = false;
  const chunks: Blob[] = [];
  const completion = new Promise<void>((resolve, reject) => {
    let lastError: unknown;
    for (const mimeType of supported) {
      try {
        recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000});
        break;
      } catch (error) { lastError = error; }
    }
    if (!recorder) {
      video.getTracks().forEach(track => track.stop());
      reject(new Error(`浏览器无法初始化视频编码器：${lastError instanceof Error ? lastError.message : '未知错误'}`));
      callbacks.onState('error', '视频编码器无法启动。');
      return;
    }
    const active = recorder;
    active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    active.onerror = () => { callbacks.onState('error', '视频编码中断，请缩短录制时长后重试。'); reject(new Error('视频编码中断。')); };
    active.onstop = () => {
      video.getTracks().forEach(track => track.stop());
      if (cancelled) { chunks.length = 0; callbacks.onState('canceled', '录制已取消，没有下载文件。'); resolve(); return; }
      const mimeType = active.mimeType || chunks.find(chunk => chunk.type)?.type || '';
      if (!mimeType || !chunks.length) { callbacks.onState('error', '浏览器没有生成可下载的视频数据。'); reject(new Error('没有录制到有效视频数据。')); return; }
      const blob = new Blob(chunks, {type: mimeType});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = recordingFilename(title, mimeType);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      callbacks.onState('downloaded', `${link.download} · ${(blob.size / 1024 / 1024).toFixed(1)} MB · ${mimeType}`);
      resolve();
    };
    try {
      active.start(1000);
      callbacks.onState('recording', active.mimeType || supported[0]);
    } catch (error) {
      video.getTracks().forEach(track => track.stop());
      callbacks.onState('error', '无法开始视频录制。');
      reject(error);
    }
  });
  return {
    completion,
    stop() { if (recorder?.state === 'recording') { callbacks.onState('finalizing'); recorder.stop(); } },
    cancel() { if (recorder?.state === 'recording') { cancelled = true; recorder.stop(); } },
  };
}

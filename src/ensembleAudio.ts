import {Sequencer, WorkletSynthesizer} from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export class EnsembleAudio {
  readonly context = new AudioContext();
  readonly output = this.context.createGain();
  readonly recordingDestination = this.context.createMediaStreamDestination();
  private synth?: WorkletSynthesizer;
  private sequencer?: Sequencer;
  private mediaSource?: MediaElementAudioSourceNode;
  private mediaElement?: HTMLAudioElement;
  private midiSignature?: string;

  constructor() {
    this.output.connect(this.context.destination);
    this.output.connect(this.recordingDestination);
  }

  async resume() {
    if (this.context.state === 'closed') throw new Error('音频会话已关闭，请重新载入曲目。');
    if (this.context.state !== 'running') await this.context.resume();
  }

  async loadMidi(file: File) {
    const signature = `${file.name}:${file.size}:${file.lastModified}`;
    if (this.sequencer && signature === this.midiSignature) return this.sequencer.duration;
    if (this.sequencer) this.sequencer.pause();
    if (this.synth) this.synth.destroy();
    this.sequencer = undefined;
    this.synth = undefined;
    if (!this.context.audioWorklet) throw new Error('当前浏览器不支持 AudioWorklet，无法播放完整合奏 MIDI。');
    try {
      const [soundFontResponse, midiBuffer] = await Promise.all([
        fetch('/__local_examples/summer/generaluser.sf2'), file.arrayBuffer(),
      ]);
      if (!soundFontResponse.ok) throw new Error(`本地采样音源读取失败（${soundFontResponse.status}）。请从项目的本地开发入口启动网页。`);
      const soundFont = await soundFontResponse.arrayBuffer();
      await this.context.audioWorklet.addModule(processorUrl);
      // The default is 17 stereo outputs (16 dry channels + effects). oneOutput
      // uses a 34-channel node, which exceeds the Web Audio 32-channel limit.
      const synth = new WorkletSynthesizer(this.context);
      synth.connect(this.output);
      this.synth = synth;
      await synth.isReady;
      await synth.soundBankManager.addSoundBank(soundFont, 'summer-generaluser');
      const sequencer = new Sequencer(synth);
      this.sequencer = sequencer;
      const loaded = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('MIDI 合奏解析超时。')), 45000);
        sequencer.eventHandler.addEvent('songChange', 'summer-song-ready', midi => {
          window.clearTimeout(timeout);
          if (!midi) { reject(new Error('MIDI 合奏没有可播放内容。')); return; }
          resolve();
        });
        sequencer.eventHandler.addEvent('midiError', 'summer-song-error', error => {
          window.clearTimeout(timeout);
          reject(error);
        });
      });
      sequencer.loadNewSongList([{binary: midiBuffer, fileName: file.name}]);
      await loaded;
      this.midiSignature = signature;
      return sequencer.duration;
    } catch (error) {
      this.sequencer = undefined;
      this.synth?.destroy();
      this.synth = undefined;
      this.midiSignature = undefined;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  attachMediaElement(element: HTMLAudioElement) {
    if (this.mediaElement === element) return;
    this.mediaElement?.pause();
    this.mediaSource?.disconnect();
    this.mediaSource = this.context.createMediaElementSource(element);
    this.mediaSource.connect(this.output);
    this.mediaElement = element;
  }

  detachMediaElement(element?: HTMLAudioElement) {
    if (element && this.mediaElement !== element) return;
    this.mediaElement?.pause();
    this.mediaSource?.disconnect();
    this.mediaSource = undefined;
    this.mediaElement = undefined;
  }

  get currentTime() {
    return this.sequencer?.currentHighResolutionTime ?? this.mediaElement?.currentTime ?? null;
  }

  get hasSequencer() { return !!this.sequencer; }
  get audioStream() { return this.recordingDestination.stream; }

  seek(seconds: number) {
    if (this.sequencer) this.sequencer.currentTime = seconds;
    if (this.mediaElement) this.mediaElement.currentTime = seconds;
  }

  async play(seconds: number, playbackRate: number) {
    await this.resume();
    if (this.sequencer) {
      this.sequencer.playbackRate = playbackRate;
      this.sequencer.currentTime = seconds;
      this.sequencer.play();
    }
    if (this.mediaElement) {
      this.mediaElement.currentTime = seconds;
      this.mediaElement.playbackRate = playbackRate;
      await this.mediaElement.play();
    }
  }

  pause() {
    this.sequencer?.pause();
    this.mediaElement?.pause();
  }

  close() {
    this.pause();
    this.synth?.destroy();
    this.mediaSource?.disconnect();
    void this.context.close();
  }
}

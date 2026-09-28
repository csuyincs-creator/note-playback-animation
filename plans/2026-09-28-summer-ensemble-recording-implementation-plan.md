# Summer 合奏曲谱动画与录制导出实现计划
> 给执行者：按 executing-plans 在本会话逐项实施；该仓库尚无 Git 基线，不执行提交步骤。
**Goal:** 在现有可复用曲谱工作台加入可本地体验的《Summer》合奏项目，并提供整首带音轨的视频录制下载。
**Architecture:** 解析 MusicXML 声部元信息并只保留钢琴谱与 MIDI 钢琴轨供双球动画；完整 MIDI 交给本地 SoundFont 播放器，音源总线同时接扬声器和录制流。三维预览继续由 Three.js 渲染，MediaRecorder 采集画布与混音，运行时选择 MP4/WebM。样例源素材仅由 Vite 开发中间件提供，不进入 dist。
**Tech Stack:** React 19、TypeScript、Vite 7、Verovio、@tonejs/midi、Three.js、SpessaSynth、MediaRecorder。
## Global Constraints
- 曲目：ScoreBase 上标注为 PDMX 的《Summer》合奏版，页面显示约 4 分钟、21 页、11 个声部。素材仅用于当前本地预览，不随公开发布物分发。
- 动画：只让钢琴左右手驱动现有双球落点和轨迹；完整合奏 MIDI 提供试听音频。
- 声音：由完整 MIDI 和采样乐器音色合成，音高、节奏和演奏时长遵循 MIDI。该声音不是久石让的原版录音。现有导入音频仍可用于用户拥有的项目。
- 录制：按钮从曲目 00:00 开始播放并录制整首，到曲目结束自动停止。显示录制进度和取消控制。
- 输出：运行时探测浏览器编码能力，优先 MP4；不支持时回退 WebM，并使用真实编码结果对应的扩展名。
- 时长：该数据集页面报告约 4 分钟；实际进度和停止点取处理后 MIDI 的真实时长。
- 从已确认的 ScoreBase 曲目页获取 MusicXML/MXL 与 MIDI。曲目页称来源为 PDMX；PDMX 研究数据集自述收录公共领域 MusicXML，但此曲版权状态没有独立核实。
- 素材只放在当前本地工作区用于预览和测试，不加入远程仓库、不发布到公开构建包，也不在导出的视频页面之外展示下载源文件。示例入口仅在开发模式显示；生产构建不携带这组素材。
- 在素材说明中记录来源 URL、获取日期和未核实的曲目授权状态。
- 如果来源下载失败、格式错误或 MIDI 与曲谱不是同一编配，不伪造曲目或匹配结果；显示可理解的错误，并保留现有工作台功能。
- 当前解析器只接受单一 MusicXML part；扩展为能从多 part MusicXML 中识别钢琴 part，优先依据 score-part / part-name / instrument 元数据，并兼容常见 Piano、Grand Piano 标记。
- 从完整 MIDI 中识别钢琴音轨，与提取的钢琴曲谱声部按音高和拍位匹配，供钢琴左右手的落点动画使用。
- 其余 MIDI 音轨保留为合奏音频。各 track 保留通道、GM 音色、力度、延音踏板、tempo 变化和 MIDI 起止时间。
- 只排钢琴双手所对应的 MusicXML 声部，隐藏不驱动双球的非钢琴谱行；完整 MIDI 仍保留作合奏音频。
- 显示钢琴声部匹配数、未匹配数和音轨/声部识别结果。匹配过低时允许查看曲谱，但阻止宣称落点准确，并提示核验来源编配。
- 新增可录制的音频输出总线，使 MIDI 采样合成声和用户上传音频都能进入扬声器及录制流；避免重复发声或因为 CORS/资源失败静默丢声。
- 从 Three.js WebGL renderer 的 canvas 建立视频流，目标 30 fps。
- 将工作台的主音频总线作为音频轨加入同一 MediaStream，再通过 MediaRecorder 录制。
- 开始录制时重置时间到 0，启动播放和录制；播放速度在录制期间锁定为 1×，并暂时锁定影响画面的设置，避免用户调整造成音画状态不一致。
- 状态机：idle → preparing → recording → finalizing → downloaded，另有 canceled 和 error。录制期间可取消；页面关闭、编码器报错、音轨缺失、空间不足或浏览器不支持格式时给出明确错误。
- 分段收集 MediaRecorder 数据，避免只在最终停止时缓存不受控的大块 Blob。录制期间保持页面活动，并在 UI 中说明整首录制按实时播放时长进行。
- 下载文件名包含曲名和日期；按实际 MIME 类型选择 `.mp4` 或 `.webm`。

### Task 1: 本地 Summer 素材与钢琴声部映射
**Files:** Create `src/midiMapping.ts`, `src/midiMapping.test.ts`, `examples/summer-local/README.md`; modify `src/types.ts`, `src/scoreProcessor.ts`, `vite.config.ts`, `.gitignore`, `package.json`、`package-lock.json`；本地源数据仅置于 `examples/summer-local/`。
**Interfaces:** `processFiles(scoreFile: File, midiFile: File, onStep: (s:string)=>void): Promise<ScoreProject>`；`ScoreProject` 加入 `partCount`、`pianoPartName`、`pianoTrackName`、`matchedCount`；开发静态路由 `/__local_examples/summer/{summer.mxl,summer.mid,generaluser.sf2}`。
- [ ] 先在 `src/midiMapping.test.ts` 覆盖真实困难映射：非钢琴音轨的同音高音符不占用钢琴谱符头；tempo 非恒定时按 MIDI tick 匹配；匹配阈值外事件计为未匹配。
- [ ] 运行 `npm test -- --run` 确认测试因模块不存在而失败，再实现并继续保持全套 TypeScript 严格检查。
- [ ] MusicXML 解析通过 `score-part` 与 part id 映射名字，选择 Piano/Grand Piano part；排版时只传入该钢琴声部并只测量其符头；分页预览上限设置为 24 页。
- [ ] MIDI 解析保留全部原始数据供播放器使用；基于轨道名、音色与音域选 Piano 轨，再用拍位/音高匹配钢琴谱音符。多轨同音不能串入映射。
- [ ] 添加 Vitest 及必要脚本，运行映射测试、`npm run build`。记录匹配数/率与曲谱、MIDI 识别结果。
- [ ] 本地取回 ScoreBase MXL/MIDI 与 GeneralUser GS 音源，素材说明写明 URL/下载日期/曲目授权未核验及音源许可证。Vite 只挂载仅开发中间件提供文件；验证 `dist` 中找不到三种原始文件。

### Task 2: 合奏播放与可录制音频总线
**Files:** Create `src/ensembleAudio.ts`; modify `src/App.tsx`, `src/types.ts`, `src/styles.css`, `package.json`、`package-lock.json`。
**Interfaces:** `createEnsembleAudio(): Promise<{play(fromSeconds:number):Promise<void>; seek(seconds:number):void; pause():void; connectRecording(stream:MediaStream):()=>void; close():void}>`; 播放器每轨应用 MIDI program/channel/controller/tempo 信息，钢琴动画仍仅消费映射事件。
- [ ] 安装并锁定 SpessaSynth 版本；将 Worklet 脚本用 Vite worker/worklet URL 本地打包，SF2 从仅开发服务 fetch。SoundFont 节点连接主 GainNode，GainNode 同时接 AudioContext.destination 与 MediaStreamAudioDestinationNode。
- [ ] 编写完整曲目播放服务，使用 SpessaSynth sequencer 播完整 MIDI；精确 seek/pause/tempo 与自然结束事件同步 React `timeRef`。audio upload 模式通过 CORS-safe HTMLAudioElement + MediaElementAudioSourceNode 接入相同总线；加载失败须报错，不静默改为三角波。
- [ ] 用户首次点击播放/录制后初始化 AudioContext；创建失败、worklet/SF2 fetch 失败和无声轨各给明确信息。现有上传文件和舒伯特项目回归。
- [ ] 使用真实开发页面点击 Summer 项目，确认 11 parts、识别 Piano 音轨、钢琴左右手映射非空且可播放；短时检测音频输出含非零 RMS，浏览器 Console 无未捕获错误。

### Task 3: 整首录制、MP4/WebM 与 UI 验收
**Files:** Create `src/videoRecorder.ts`, `src/videoRecorder.test.ts`; modify `src/ScoreStage.tsx`, `src/App.tsx`, `src/styles.css`, `README.md`。
**Interfaces:** `startRecording({canvas:HTMLCanvasElement,audio:MediaStream,durationSeconds:number,onProgress:(seconds:number)=>void,onState:(state:RecordingState)=>void}):Promise<void>`；`cancelRecording():void`；`RecordingState='idle'|'preparing'|'recording'|'finalizing'|'downloaded'|'canceled'|'error'`。
- [ ] 用 fake MediaRecorder 测试 MIME 探测顺序和 Blob 扩展名：先尝试 video/mp4;codecs=h264,aac，再 video/mp4，再 video/webm;codecs=vp9,opus，最后 video/webm；实际 recorder.mimeType 决定扩展名；测试编码器出错及取消不下载。
- [ ] 从 ScoreStage 暴露 renderer canvas 的稳定 ref，并用 `canvas.captureStream(30)` 加入共享主音频 track；检查录制 stream 有一个视频轨和至少一个音轨后开始。
- [ ] App 增加录制按钮/状态/进度/取消；preparing 期间暂停预览播放并复位 0；设置快照和 1×播放冻结到录制终态；MIDI 与画布用同一主计时时钟；轨道结束后延迟音频尾响 2 秒并 finalize。
- [ ] 录制分段每 1 秒 flush 一次；停止/取消及时释放 recorder、track、audio route、定时器；取消丢弃所有片段；pagehide 尽力终止并提示用户未完成。
- [ ] 开始浏览器实例，开发模式加载 Summer；实际录 10 秒短样片、取消一次、成功一次；用 ffprobe 核查输出容器/MIME/时长/视频音轨，抽取画格核对曲谱与双球；检查浏览器控制台、响应式视图与进度/下载状态。
- [ ] 运行 `npm run build`、`npm test -- --run`；生产构建不得包含 Summer 曲谱、MIDI、SoundFont 源素材或开发示例入口。更新 README 如实列出本地素材来源、录制能力、限制和使用方法。

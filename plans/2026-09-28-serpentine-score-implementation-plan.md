# Serpentine Score Direction 实现计划
> 给执行者：依次完成以下任务；本工作区没有 Git 仓库，不执行提交步骤。
**Goal:** 在工作台加入标准/蛇形方向选择，并让谱面符头、小球、轨迹和镜头按所选系统方向一致运动。
**Architecture:** 保留 `ScoreProject` 的标准坐标作为源数据；新增纯派生布局函数，镜像奇数序号谱行并反射事件 x 坐标，同时对音符与文字组做局部反射以保持字形正向。`App` 根据已持久化的方向派生显示项目，`ScoreStage` 从事件坐标与 system 序号生成对应转弯路径。
**Tech Stack:** React 19, TypeScript, SVG DOM, Three.js, Vite.
## Global Constraints
- System 1 runs left to right.
- System 2 runs right to left.
- System 3 runs left to right, continuing this pattern for every system.
- The direction alternation continues across page boundaries; it does not reset at each page.
- The treble and bass staves within one grand-staff system share the same direction.
- On right-to-left systems, move the note groups to reversed horizontal positions while keeping note glyphs, stems, beams, clefs, and text upright. Do not mirror the rendered notation image.
- Keep each event's MIDI time and `scoreId` paired with its original notehead; update its displayed coordinates along with the layout transform.
- At a right edge, route down and continue from the next system's right edge toward the left.
- At a left edge, route down and continue from the next system's left edge toward the right.
- The ball, its trail, and the following camera use the same direction-aware path.
- Store the direction in the existing persisted view settings so it survives refreshes. Imported project data remains compatible: absent direction uses `蛇形` as the default; saved settings can select `标准`.
### Task 1: Derive the display layout
**Files:** Create `src/scoreLayout.ts`; modify `src/types.ts`.
**Interfaces:** `applyScoreDirection(project: ScoreProject, direction: ScoreDirection): ScoreProject`; `ScoreDirection = 'serpentine' | 'standard'`.
- [ ] Add `ScoreDirection` and DOM-based transform helpers. For each odd-indexed `.system`, reflect the system around its SVG bounds and wrap upright symbol groups in local counter-reflections.
- [ ] Reflect each event's x coordinate around the matching system center; standard mode returns the original project unchanged.
- [ ] Build and inspect TypeScript diagnostics.
### Task 2: Persist and expose direction
**Files:** Modify `src/types.ts`, `src/App.tsx`, `src/styles.css`.
**Interfaces:** `ViewSettings.direction: ScoreDirection`; render/export/save from a memoized display project derived from the source project and settings.
- [ ] Default to `serpentine`, merge older localStorage and project settings safely, and add a two-option `曲谱方向` control.
- [ ] Feed the derived display project to `ScoreStage`; export its SVG and preserve source project data in project JSON with current settings.
- [ ] Build and inspect both options in the browser.
### Task 3: Follow alternating rows
**Files:** Modify `src/performance.ts`, `src/ScoreStage.tsx`.
**Interfaces:** `scorePathPoint(a, b, u)` selects the left or right return edge from the destination system's parity.
- [ ] Route even-to-odd row transitions around the right edge and odd-to-even transitions around the left edge; same-row motion interpolates transformed notehead coordinates.
- [ ] Use the shared path for the trail and camera, retaining the long-rest fade-in.
- [ ] Build, load the multi-system Schubert sample, switch both settings, and inspect left/right row turns and notehead alignment.

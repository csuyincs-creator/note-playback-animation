const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'images');
const TEMP_FRAMES_DIR = path.join(__dirname, '..', 'temp_frames');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_FRAMES_DIR)) {
  fs.mkdirSync(TEMP_FRAMES_DIR, { recursive: true });
}

async function run() {
  let browser = null;
  try {
    console.log('Launching browser (with GPU acceleration)...');
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--enable-gpu',
        '--use-gl=angle',
        '--window-size=1600,950',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });

    console.log('Navigating to http://127.0.0.1:5173/ ...');
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for canvas to initialize and render
    await page.waitForSelector('.stage-viewport canvas', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    console.log('Capturing workbench preview screenshot...');
    const workbenchPreviewPath = path.join(OUTPUT_DIR, 'workbench-preview.png');
    await page.screenshot({ path: workbenchPreviewPath, type: 'png' });
    console.log('Saved:', workbenchPreviewPath);

    // Click play button to start playback
    console.log('Starting playback for animation capture...');
    const playBtn = await page.$('.play-button');
    if (playBtn) {
      await playBtn.click();
    } else {
      await page.keyboard.press('Space');
    }

    // Wait 0.8s for ball to enter and start jumping
    await new Promise(r => setTimeout(r, 800));

    // Capture 45 frames for GIF (~3 seconds at 15 fps)
    console.log('Capturing frames for animated GIF...');
    const totalFrames = 45;
    for (let f = 0; f < totalFrames; f++) {
      const framePath = path.join(TEMP_FRAMES_DIR, `frame_${String(f).padStart(3, '0')}.png`);
      // Capture the stage-viewport element for clean focus
      const stageViewport = await page.$('.stage-viewport');
      if (stageViewport) {
        await stageViewport.screenshot({ path: framePath });
      } else {
        await page.screenshot({ path: framePath });
      }
      await new Promise(r => setTimeout(r, 65));
    }

    // Enter full-screen expanded mode for another preview
    console.log('Entering fullscreen mode for aurora showcase...');
    await page.keyboard.press('Space'); // pause first
    await new Promise(r => setTimeout(r, 300));
    
    const expandBtn = await page.$('.expand-button');
    if (expandBtn) {
      await expandBtn.click();
      await new Promise(r => setTimeout(r, 500));
      await page.keyboard.press('Space'); // resume in fullscreen
      await new Promise(r => setTimeout(r, 600));

      const fullscreenPath = path.join(OUTPUT_DIR, 'fullscreen-preview.png');
      await page.screenshot({ path: fullscreenPath, type: 'png' });
      console.log('Saved:', fullscreenPath);
    }

    console.log('Browser capture finished successfully.');
  } finally {
    if (browser) {
      console.log('Closing browser process safely...');
      await browser.close();
    }
  }

  // Generate optimized animated GIF with ffmpeg
  try {
    const gifOutput = path.join(OUTPUT_DIR, 'motion-demo.gif');
    console.log('Generating motion-demo.gif via ffmpeg...');
    const framesPattern = path.join(TEMP_FRAMES_DIR, 'frame_%03d.png');
    const cmd = `ffmpeg -y -framerate 15 -i "${framesPattern}" -vf "fps=15,scale=920:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" "${gifOutput}"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('Successfully generated GIF:', gifOutput);
  } catch (err) {
    console.error('Error generating GIF:', err.message);
  } finally {
    // Clean up temp frames directory
    try {
      if (fs.existsSync(TEMP_FRAMES_DIR)) {
        fs.rmSync(TEMP_FRAMES_DIR, { recursive: true, force: true });
        console.log('Cleaned up temp frames.');
      }
    } catch {}
  }
}

run().catch(err => {
  console.error('Capture script error:', err);
  process.exit(1);
});

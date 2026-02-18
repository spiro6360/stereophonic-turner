// ============================================================
// Spatial Hall Reverb — original speed preserved
//
// · No speed/pitch change
// · Medium hall reverb (RT60 2.8s, wet 58%)
// · Minimal EQ correction (preserves original tone)
// · Subtle stereo widening (1.25×)
// ============================================================

(function () {
  const c = document.getElementById('stars');
  for (let i = 0; i < 130; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const z = Math.random() * 2.5 + 0.5;
    s.style.cssText = `width:${z}px;height:${z}px;left:${Math.random()*100}%;top:${Math.random()*100}%;--d:${(Math.random()*4+2).toFixed(1)}s;animation-delay:${(Math.random()*4).toFixed(1)}s`;
    c.appendChild(s);
  }
})();

const uploadArea        = document.getElementById('uploadArea');
const fileInput         = document.getElementById('fileInput');
const filePreview       = document.getElementById('filePreview');
const fileNameEl        = document.getElementById('fileName');
const fileSizeEl        = document.getElementById('fileSize');
const removeBtn         = document.getElementById('removeBtn');
const convertBtn        = document.getElementById('convertBtn');
const uploadSection     = document.getElementById('uploadSection');
const processingSection = document.getElementById('processingSection');
const resultSection     = document.getElementById('resultSection');
const processingLabel   = document.getElementById('processingLabel');
const progressFill      = document.getElementById('progressFill');
const progressPercent   = document.getElementById('progressPercent');
const downloadBtn       = document.getElementById('downloadBtn');
const resetBtn          = document.getElementById('resetBtn');

let selectedFile = null, downloadUrl = null, downloadName = null;

const fmtBytes = b => b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(2)+' MB';

function setProgress(pct, label) {
  progressFill.style.width = pct + '%';
  progressPercent.textContent = Math.round(pct) + '%';
  if (label) processingLabel.textContent = label;
}

function handleFile(file) {
  if (!file?.type.startsWith('audio/')) { alert('Please select an audio file.'); return; }
  if (file.size > 200 * 1048576) { alert('Please use a file under 200 MB.'); return; }
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = fmtBytes(file.size);
  filePreview.classList.add('visible');
  convertBtn.disabled = false;
}
function clearFile() {
  selectedFile = null; fileInput.value = '';
  filePreview.classList.remove('visible');
  convertBtn.disabled = true;
}
uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => { e.preventDefault(); uploadArea.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
removeBtn.addEventListener('click', clearFile);

// ── WAV Encoder ───────────────────────────────────────────
function encodeWAV(buf) {
  const nCh=buf.numberOfChannels, sr=buf.sampleRate, n=buf.length;
  const blk=nCh*2, data=n*blk, ab=new ArrayBuffer(44+data), v=new DataView(ab);
  const ws=(o,s)=>{for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i));};
  ws(0,'RIFF'); v.setUint32(4,36+data,true); ws(8,'WAVE');
  ws(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true);
  v.setUint16(22,nCh,true); v.setUint32(24,sr,true); v.setUint32(28,sr*blk,true);
  v.setUint16(32,blk,true); v.setUint16(34,16,true);
  ws(36,'data'); v.setUint32(40,data,true);
  let off=44;
  for(let i=0;i<n;i++) for(let c=0;c<nCh;c++){
    const s=Math.max(-1,Math.min(1,buf.getChannelData(c)[i]));
    v.setInt16(off,s<0?s*0x8000:s*0x7FFF,true); off+=2;
  }
  return ab;
}

// ── Hall Reverb IR ────────────────────────────────────────
function makeHallIR(ctx, decaySec, predelayMs) {
  const sr = ctx.sampleRate;
  const pd = Math.floor(sr * predelayMs / 1000);
  const total = Math.floor(sr * decaySec) + pd;
  const ir = ctx.createBuffer(2, total, sr);
  const airA = Math.exp(-2 * Math.PI * 9500 / sr);

  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < pd; i++) d[i] = 0;
    const tail = total - pd;
    for (let i = 0; i < tail; i++)
      d[pd + i] = (Math.random()*2-1) * Math.exp(-6.9 * i/tail);
    let y = 0;
    for (let i = pd; i < total; i++) { y = airA*y + (1-airA)*d[i]; d[i] = d[i]*0.4 + y*0.6; }
    if (ch === 1) {
      const sh = Math.floor(sr * 0.006);
      for (let i = total-1; i >= pd+sh; i--) d[i] = d[i-sh];
      for (let i = pd; i < pd+sh; i++) d[i] = 0;
    }
    let peak = 0;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < total; i++) d[i] = d[i]/peak * 0.88;
  }
  return ir;
}

// ── M-S Widening ─────────────────────────────────────────
function applyMSWiden(buf, w) {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < buf.length; i++) {
    const m = (L[i]+R[i])*0.5, s = (L[i]-R[i])*0.5;
    L[i] = m + w*s; R[i] = m - w*s;
  }
}

// ── Peak Normalize ────────────────────────────────────────
function normalizePeak(buf, db) {
  const target = Math.pow(10, db/20);
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0) {
    const sc = target/peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= sc;
    }
  }
}

// ── Main Conversion ───────────────────────────────────────
async function convert() {
  uploadSection.hidden = true;
  processingSection.hidden = false;
  resultSection.hidden = true;
  setProgress(0, 'Reading file...');

  let arrayBuf;
  try { arrayBuf = await selectedFile.arrayBuffer(); }
  catch { alert('Failed to read file.'); resetUI(); return; }

  setProgress(10, 'Decoding audio...');
  let src;
  try {
    const tmp = new AudioContext();
    src = await tmp.decodeAudioData(arrayBuf);
    await tmp.close();
  } catch { alert('Decoding failed.'); resetUI(); return; }

  const { sampleRate: sr, duration } = src;
  setProgress(20, 'Building processing chain...');

  const totalFrames = Math.ceil((duration + 4) * sr);  // 4s reverb tail
  const off = new OfflineAudioContext(2, totalFrames, sr);

  const source = off.createBufferSource();
  source.buffer = src;
  // playbackRate 1.0 — no speed/pitch change

  const master = off.createGain();
  master.gain.value = 0.88;
  master.connect(off.destination);

  // ── Dry signal (preserve original as much as possible) ──
  const dryGain = off.createGain();
  dryGain.gain.value = 0.60;

  source.connect(dryGain);
  dryGain.connect(master);

  // ── Wet signal: hall reverb ───────────────────────────
  const preDelay = off.createDelay(0.2);
  preDelay.delayTime.value = 0.022;       // 22ms pre-delay

  const conv = off.createConvolver();
  conv.buffer = makeHallIR(off, 2.8, 22);

  const wetGain = off.createGain();
  wetGain.gain.value = 0.58;              // wet 58%

  source.connect(preDelay);
  preDelay.connect(conv);
  conv.connect(wetGain);
  wetGain.connect(master);

  // ── Rendering ────────────────────────────────────────
  source.start(0);
  setProgress(28, 'Rendering...');

  const estMs = Math.min(duration * 400, 30000);
  const t0 = Date.now();
  const ticker = setInterval(() => {
    setProgress(28 + Math.min(58, ((Date.now()-t0)/estMs)*58), 'Rendering...');
  }, 200);

  let rendered;
  try { rendered = await off.startRendering(); }
  catch (e) { clearInterval(ticker); alert('Rendering error: ' + e.message); resetUI(); return; }
  clearInterval(ticker);

  setProgress(89, 'Widening stereo...');
  applyMSWiden(rendered, 1.25);

  setProgress(95, 'Optimizing levels...');
  normalizePeak(rendered, -0.5);

  setProgress(99, 'Encoding WAV...');
  let wav;
  try { wav = encodeWAV(rendered); }
  catch { alert('Encoding error.'); resetUI(); return; }

  setProgress(100, 'Done!');
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl  = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  downloadName = selectedFile.name.replace(/\.[^.]+$/, '') + '_reverb.wav';

  await new Promise(r => setTimeout(r, 350));
  processingSection.hidden = true;
  resultSection.hidden = false;
}

downloadBtn.addEventListener('click', () => {
  if (!downloadUrl) return;
  Object.assign(document.createElement('a'), { href: downloadUrl, download: downloadName }).click();
});

function resetUI() {
  uploadSection.hidden = false;
  processingSection.hidden = true;
  resultSection.hidden = true;
  setProgress(0, 'Ready...');
  clearFile();
}
resetBtn.addEventListener('click', resetUI);
convertBtn.addEventListener('click', () => {
  if (!selectedFile) return;
  convert().catch(e => { console.error(e); alert('Error: ' + e.message); resetUI(); });
});

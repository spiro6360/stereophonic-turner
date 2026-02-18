// ============================================================
// 공간감 리버브 — 원본 속도 유지, 자연스러운 홀 잔향
//
// · 속도/피치 변화 없음
// · 중형 홀 잔향 (RT60 2.2s, wet 38%) — 과하지 않게
// · 원음 EQ 최소 보정 (원곡 톤 최대한 보존)
// · 스테레오 살짝 확장 (1.25×)
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
  if (!file?.type.startsWith('audio/')) { alert('오디오 파일을 선택해주세요.'); return; }
  if (file.size > 200 * 1048576) { alert('200 MB 이하 파일을 사용해주세요.'); return; }
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

// ── WAV 인코더 ────────────────────────────────────────────
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

// ── 홀 잔향 IR ────────────────────────────────────────────
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

// ── M-S 와이드닝 ─────────────────────────────────────────
function applyMSWiden(buf, w) {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < buf.length; i++) {
    const m = (L[i]+R[i])*0.5, s = (L[i]-R[i])*0.5;
    L[i] = m + w*s; R[i] = m - w*s;
  }
}

// ── 피크 노멀라이즈 ───────────────────────────────────────
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

// ── 메인 변환 ─────────────────────────────────────────────
async function convert() {
  uploadSection.hidden = true;
  processingSection.hidden = false;
  resultSection.hidden = true;
  setProgress(0, '파일 읽는 중...');

  let arrayBuf;
  try { arrayBuf = await selectedFile.arrayBuffer(); }
  catch { alert('파일 읽기 실패'); resetUI(); return; }

  setProgress(10, '오디오 디코딩 중...');
  let src;
  try {
    const tmp = new AudioContext();
    src = await tmp.decodeAudioData(arrayBuf);
    await tmp.close();
  } catch { alert('디코딩 실패'); resetUI(); return; }

  const { sampleRate: sr, duration } = src;
  setProgress(20, '처리 체인 구성 중...');

  const totalFrames = Math.ceil((duration + 4) * sr);  // 잔향 꼬리 4초
  const off = new OfflineAudioContext(2, totalFrames, sr);

  const source = off.createBufferSource();
  source.buffer = src;
  // playbackRate 1.0 — 속도/피치 변화 없음

  const master = off.createGain();
  master.gain.value = 0.88;
  master.connect(off.destination);

  // ── 드라이 신호 (원음 최대한 보존) ──────────────────────
  const dryGain = off.createGain();
  dryGain.gain.value = 0.60;

  source.connect(dryGain);
  dryGain.connect(master);

  // ── 웻 신호: 홀 잔향 ─────────────────────────────────
  const preDelay = off.createDelay(0.2);
  preDelay.delayTime.value = 0.022;      // 22ms pre-delay

  const conv = off.createConvolver();
  conv.buffer = makeHallIR(off, 2.8, 22);

  const wetGain = off.createGain();
  wetGain.gain.value = 0.58;             // wet 58%

  source.connect(preDelay);
  preDelay.connect(conv);
  conv.connect(wetGain);
  wetGain.connect(master);

  // ── 렌더링 ───────────────────────────────────────────
  source.start(0);
  setProgress(28, '렌더링 중...');

  const estMs = Math.min(duration * 400, 30000);
  const t0 = Date.now();
  const ticker = setInterval(() => {
    setProgress(28 + Math.min(58, ((Date.now()-t0)/estMs)*58), '렌더링 중...');
  }, 200);

  let rendered;
  try { rendered = await off.startRendering(); }
  catch (e) { clearInterval(ticker); alert('렌더링 오류: ' + e.message); resetUI(); return; }
  clearInterval(ticker);

  setProgress(89, '스테레오 확장 중...');
  applyMSWiden(rendered, 1.25);

  setProgress(95, '레벨 최적화 중...');
  normalizePeak(rendered, -0.5);

  setProgress(99, 'WAV 인코딩 중...');
  let wav;
  try { wav = encodeWAV(rendered); }
  catch { alert('인코딩 오류'); resetUI(); return; }

  setProgress(100, '완료!');
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
  setProgress(0, '변환 준비 중...');
  clearFile();
}
resetBtn.addEventListener('click', resetUI);
convertBtn.addEventListener('click', () => {
  if (!selectedFile) return;
  convert().catch(e => { console.error(e); alert('오류: ' + e.message); resetUI(); });
});

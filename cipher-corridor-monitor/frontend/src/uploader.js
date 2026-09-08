/**
 * uploader.js — Upload-First Ingestion & Extraction Engine
 * Synthesizes industrial-brutalist-ui, minimalist-ui, and stitch-design-taste.
 * Handles drag-and-drop .xlsx workbook ingestion, 5-stage mechanical telemetry stepper,
 * and live dashboard activation.
 */

let appShell = null;
let selectedFile = null;
let isExtracting = false;

/**
 * Initializes the Ingestion module
 * @param {object} appShellRef
 */
export function initUploader(appShellRef) {
  appShell = appShellRef;
  bindIngestionEvents();
}

/**
 * Formats bytes to readable MB/KB
 */
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  if (bytes > 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  return (bytes / 1024).toFixed(1) + ' KB';
}

/**
 * Binds dropzone, file input, and action triggers
 */
function bindIngestionEvents() {
  const dropzone = document.getElementById('main-dropzone');
  const fileInput = document.getElementById('main-file-input');
  const btnRun = document.getElementById('btn-run-pipeline');
  const btnDemo = document.getElementById('btn-load-demo');
  const preview = document.getElementById('file-chosen-preview');
  const fileNameEl = document.getElementById('chosen-file-name');
  const fileSizeEl = document.getElementById('chosen-file-size');

  if (!dropzone || !fileInput) return;

  // Click to browse
  dropzone.addEventListener('click', () => {
    if (!isExtracting) fileInput.click();
  });

  // Drag over
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isExtracting) dropzone.classList.add('dragover');
  });

  // Drag leave
  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });

  // Drop
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    if (isExtracting) return;

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  // Run pipeline button
  if (btnRun) {
    btnRun.addEventListener('click', () => {
      if (selectedFile && !isExtracting) {
        startUploadPipeline(selectedFile);
      }
    });
  }

  // Demo shortcut button
  if (btnDemo) {
    btnDemo.addEventListener('click', () => {
      if (!isExtracting) {
        startDemoPipeline();
      }
    });
  }
}

/**
 * Validates and displays selected file
 */
export function handleFileSelected(file) {
  if (!file) return;

  const btnRun = document.getElementById('btn-run-pipeline');
  const preview = document.getElementById('file-chosen-preview');
  const fileNameEl = document.getElementById('chosen-file-name');
  const fileSizeEl = document.getElementById('chosen-file-size');

  const name = file.name || '';
  if (!name.toLowerCase().endsWith('.xlsx')) {
    alert('[ INVALID FILE FORMAT ] Only .xlsx Excel workbooks are supported.');
    return;
  }

  selectedFile = file;

  if (preview && fileNameEl && fileSizeEl) {
    fileNameEl.textContent = name.toUpperCase();
    fileSizeEl.textContent = formatFileSize(file.size);
    preview.style.display = 'flex';
  }

  if (btnRun) {
    btnRun.disabled = false;
    btnRun.classList.add('btn-ready');
  }
}

/**
 * Animates stepper telemetry through 5 phases
 */
async function animateStep(stepNum, durationMs = 600) {
  const stepEl = document.getElementById(`step-${stepNum}`);
  if (!stepEl) return;

  const statusEl = stepEl.querySelector('.step-status');
  if (statusEl) {
    statusEl.textContent = 'RUNNING';
    statusEl.className = 'step-status mono-text status-running';
  }

  await new Promise(r => setTimeout(r, durationMs));

  if (statusEl) {
    statusEl.textContent = 'DONE [OK]';
    statusEl.className = 'step-status mono-text status-done';
  }
}

/**
 * Resets stepper UI
 */
function resetStepper() {
  for (let i = 1; i <= 5; i++) {
    const stepEl = document.getElementById(`step-${i}`);
    if (stepEl) {
      const statusEl = stepEl.querySelector('.step-status');
      if (statusEl) {
        statusEl.textContent = 'WAITING';
        statusEl.className = 'step-status mono-text status-wait';
      }
    }
  }
}

function setStepState(stepNum, stateText, stateClass) {
  const stepEl = document.getElementById(`step-${stepNum}`);
  if (!stepEl) return;
  const statusEl = stepEl.querySelector('.step-status');
  if (statusEl) {
    statusEl.textContent = stateText;
    statusEl.className = `step-status mono-text ${stateClass}`;
  }
}

/**
 * Runs upload extraction pipeline
 */
async function startUploadPipeline(file) {
  isExtracting = true;
  const stepper = document.getElementById('extraction-stepper');
  const btnRun = document.getElementById('btn-run-pipeline');
  const btnDemo = document.getElementById('btn-load-demo');
  const elapsedEl = document.getElementById('upload-elapsed-sec');

  if (btnRun) btnRun.disabled = true;
  if (btnDemo) btnDemo.disabled = true;
  if (stepper) {
    resetStepper();
    stepper.style.display = 'block';
  }
  if (elapsedEl) elapsedEl.textContent = '0';

  let timerInterval = null;
  let elapsedSec = 0;

  setStepState(1, 'RUNNING', 'status-running');
  timerInterval = setInterval(() => {
    elapsedSec++;
    if (elapsedEl) elapsedEl.textContent = elapsedSec;
    if (elapsedSec === 3) {
      setStepState(1, 'DONE [OK]', 'status-done');
      setStepState(2, 'RUNNING', 'status-running');
    } else if (elapsedSec === 15) {
      setStepState(2, 'DONE [OK]', 'status-done');
      setStepState(3, 'RUNNING', 'status-running');
    } else if (elapsedSec === 40) {
      setStepState(3, 'DONE [OK]', 'status-done');
      setStepState(4, 'RUNNING', 'status-running');
    } else if (elapsedSec === 65) {
      setStepState(4, 'DONE [OK]', 'status-done');
      setStepState(5, 'RUNNING', 'status-running');
    }
  }, 1000);

  const formData = new FormData();
  formData.append('file', file);

  const startTime = performance.now();
  const uploadPromise = fetch('/upload', {
    method: 'POST',
    body: formData,
  });

  try {
    const res = await uploadPromise;
    clearInterval(timerInterval);

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const payload = await res.json();
    const durationSec = ((performance.now() - startTime) / 1000).toFixed(1);
    if (payload.metadata) {
      payload.metadata.pipeline_duration_seconds = durationSec;
    }

    for (let i = 1; i <= 5; i++) {
      setStepState(i, 'DONE [OK]', 'status-done');
    }

    await new Promise(r => setTimeout(r, 400));

    if (appShell) {
      if (typeof appShell.activateDashboard === 'function') {
        appShell.activateDashboard(payload);
      } else if (typeof appShell.replaceData === 'function') {
        appShell.replaceData(payload);
      } else if (typeof appShell === 'function') {
        appShell(payload);
      }
    }
  } catch (err) {
    clearInterval(timerInterval);
    console.error('[uploader] Pipeline failure:', err);
    alert(`[ EXTRACTION FAILURE ]: ${err.message || 'Check server logs'}`);
    if (stepper) stepper.style.display = 'none';
  } finally {
    clearInterval(timerInterval);
    isExtracting = false;
    if (btnRun) btnRun.disabled = false;
    if (btnDemo) btnDemo.disabled = false;
  }
}

/**
 * Runs demo extraction shortcut pipeline
 */
async function startDemoPipeline() {
  isExtracting = true;
  const stepper = document.getElementById('extraction-stepper');
  const btnRun = document.getElementById('btn-run-pipeline');
  const btnDemo = document.getElementById('btn-load-demo');

  if (btnRun) btnRun.disabled = true;
  if (btnDemo) btnDemo.disabled = true;
  if (stepper) {
    resetStepper();
    stepper.style.display = 'block';
  }

  const demoPromise = fetch('/load-demo')
    .then(r => r.ok ? r : fetch('/dashboard_data.json'))
    .catch(() => fetch('/dashboard_data.json'));

  try {
    await animateStep(1, 500);
    await animateStep(2, 600);
    await animateStep(3, 500);

    const res = await demoPromise;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = await res.json();

    await animateStep(4, 500);
    await animateStep(5, 500);

    await new Promise(r => setTimeout(r, 400));

    if (appShell) {
      if (typeof appShell.activateDashboard === 'function') {
        appShell.activateDashboard(payload);
      } else if (typeof appShell.replaceData === 'function') {
        appShell.replaceData(payload);
      } else if (typeof appShell === 'function') {
        appShell(payload);
      }
    }
  } catch (err) {
    console.error('[uploader] Demo load failure:', err);
    alert(`[ EXTRACTION FAILURE ]: ${err.message}`);
    if (stepper) stepper.style.display = 'none';
  } finally {
    isExtracting = false;
    if (btnRun) btnRun.disabled = false;
    if (btnDemo) btnDemo.disabled = false;
  }
}

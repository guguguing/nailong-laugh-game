/*
 * 奶龙大笑相似度
 * 纯前端、本地音频分析。录音不会离开浏览器。
 *
 * 依赖：Meyda 5.6.3（由 index.html 通过 CDN 引入）
 */
(function () {
  'use strict';

  /* ==================== 可调参数 ==================== */

  const FRAME_SIZE = 1024;
  const HOP_SIZE = 512;
  const MAX_RECORD_MS = 10000;
  const MAX_CLIP_SECONDS = 10;
  const MEL_BANDS = 26;
  const MFCC_COEFFICIENTS = 13;
  const ENVELOPE_POINTS = 100;
  const ENVELOPE_BIN_SECONDS = 0.05;
  const FRAMES_PER_SLICE = 32;

  const SILENCE_PEAK_THRESHOLD = 0.01;
  const SILENCE_RMS_THRESHOLD = 0.001;
  const MIN_VALID_DURATION_SECONDS = 0.18;
  const TRIM_ABSOLUTE_THRESHOLD = 0.004;
  const TRIM_RELATIVE_THRESHOLD = 0.06;
  const TRIM_PADDING_SECONDS = 0.05;

  const START_LABEL = '开始录音';
  const STOP_LABEL = '停止录音';
  const REFERENCE_CANDIDATES = ['./reference.mp3', './reference.wav'];
  const REFERENCE_FILES_LABEL = 'reference.mp3 / reference.wav';
  const DEFAULT_SITE_HINT = '需要参考音频 reference.mp3 或 reference.wav 才能评分 · 最长 10 秒';

  const VERDICTS = {
    win: '奶龙本龙！',
    good: '有内味了',
    practice: '再练练',
    low: '不太像，再来一次'
  };

  /* ==================== 运行状态 ==================== */

  let appState = 'idle';
  let audioContext = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let currentMimeType = '';
  let finalizeStarted = false;
  let recorderFailureHandled = false;

  let analyserNode = null;
  let sourceNode = null;
  let silentGainNode = null;
  let meterFloatData = null;
  let meterByteData = null;
  let meterAnimationId = 0;

  let recordingStartedAt = 0;
  let recordingStoppedAt = 0;
  let countdownTimer = 0;
  let autoStopTimer = 0;

  let meydaConfiguredSampleRate = 0;
  let hannWindow = null;

  let referenceBytesCache = null;
  let referenceBytesPromise = null;
  let referenceAudioBuffer = null;
  let referenceMonoCache = null;
  let referenceFeatureCache = null;
  let referenceAvailabilityChecked = false;

  const dom = {};

  class AppError extends Error {
    constructor(code, title, message) {
      super(message);
      this.name = 'AppError';
      this.code = code;
      this.title = title;
      this.isUserFacing = true;
    }
  }

  /* ==================== 初始化 ==================== */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    cacheDom();
    bindEvents();

    if (!hasMeyda()) {
      showMeydaNotice();
    }

    void checkReferenceAvailability().catch(function () {
      // checkReferenceAvailability 自己会处理可预期的失败；这里只兜底，避免未捕获异常。
    });
  }

  function cacheDom() {
    const ids = [
      'meydaAlert',
      'referenceAlert',
      'referenceAlertTitle',
      'referenceAlertBody',
      'screenStart',
      'screenRecord',
      'screenResult',
      'screenError',
      'startBtn',
      'startHint',
      'startError',
      'stopBtn',
      'retryBtn',
      'errorHomeBtn',
      'recordLive',
      'analyzingPanel',
      'recordHeading',
      'recordStateText',
      'countdownText',
      'levelTrack',
      'levelBar',
      'recordHint',
      'analyzingDetail',
      'analyzingBar',
      'resultHeading',
      'scoreValue',
      'similarityPercent',
      'verdict',
      'silentNotice',
      'resultWinMedia',
      'resultMidMedia',
      'resultLowMedia',
      'debugRecordDuration',
      'debugEffectiveDuration',
      'debugFrameCount',
      'debugMfccDims',
      'debugCosine',
      'debugEnvelope',
      'errorTitle',
      'errorMessage'
    ];

    ids.forEach(function (id) {
      dom[id] = document.getElementById(id);
    });
    dom.countdown = dom.countdownText ? dom.countdownText.closest('.countdown') : null;
  }

  function bindEvents() {
    dom.startBtn.addEventListener('click', function () {
      void beginRecording().catch(function () {
        resetToStart();
        showStartError('启动录音时遇到了意外问题，请刷新页面后重试。');
      });
    });

    dom.stopBtn.addEventListener('click', function () {
      try {
        stopRecording('manual');
      } catch (error) {
        showFatalError('录音没有正常结束', '结束录音时遇到问题。请检查麦克风后重新录制一次。');
      }
    });

    dom.retryBtn.addEventListener('click', function () {
      resetToStart();
      void beginRecording().catch(function () {
        resetToStart();
        showStartError('启动录音时遇到了意外问题，请刷新页面后重试。');
      });
    });

    dom.errorHomeBtn.addEventListener('click', function () {
      resetToStart();
      dom.startBtn.focus();
    });

    window.addEventListener('pagehide', function () {
      clearRecordingTimers();
      stopMeter();
      releaseMediaResources();
    });
  }

  /* ==================== 参考音频检查 ==================== */

  async function checkReferenceAvailability() {
    if (referenceAvailabilityChecked) {
      return;
    }
    referenceAvailabilityChecked = true;

    if (window.location.protocol === 'file:') {
      showReferenceNotice(
        '请通过本地服务器打开',
        '直接双击 index.html 时，浏览器会阻止读取参考音频。请双击文件夹里的“启动游戏.bat”，或按 README 使用 localhost / HTTPS 打开。'
      );
      return;
    }

    if (typeof window.fetch !== 'function') {
      showReferenceNotice(
        '浏览器版本过旧',
        '当前浏览器不支持 fetch，无法读取参考音频。请升级浏览器后重试。'
      );
      return;
    }

    try {
      await prefetchReferenceBytes();
      hideReferenceNotice();
    } catch (error) {
      // prefetchReferenceBytes 内部会给出具体提示；这里只做兜底。
      if (dom.referenceAlert && dom.referenceAlert.hidden) {
        showReferenceNotice(
          '无法读取参考音频',
          '请确认 reference.mp3 或 reference.wav 已放在项目根目录，并通过本地服务器或 HTTPS 访问页面。'
        );
      }
    }
  }

  function showReferenceMissingNotice() {
    showReferenceNotice(
      '缺少参考音频 reference.mp3 / reference.wav',
      '请把 reference.mp3 或 reference.wav 放到 index.html 同目录（项目根目录），然后刷新页面。补齐之前无法评分。'
    );
  }

  function showReferenceNotice(title, message) {
    if (!dom.referenceAlert) {
      return;
    }
    dom.referenceAlertTitle.textContent = title;
    dom.referenceAlertBody.textContent = message;
    dom.referenceAlert.hidden = false;
  }

  function hideReferenceNotice() {
    if (dom.referenceAlert) {
      dom.referenceAlert.hidden = true;
    }
  }

  function showMeydaNotice() {
    if (dom.meydaAlert) {
      dom.meydaAlert.hidden = false;
    }
  }

  function prefetchReferenceBytes() {
    if (referenceBytesCache) {
      return Promise.resolve(referenceBytesCache);
    }
    if (referenceBytesPromise) {
      return referenceBytesPromise;
    }

    const promise = (async function () {
      const failures = [];

      // 优先使用用户提供的 reference.mp3；也兼容旧的 reference.wav。
      for (let index = 0; index < REFERENCE_CANDIDATES.length; index += 1) {
        const url = REFERENCE_CANDIDATES[index];
        const controller = new AbortController();
        const timeoutId = window.setTimeout(function () {
          controller.abort();
        }, 12000);

        try {
          const response = await window.fetch(url, {
            cache: 'no-store',
            signal: controller.signal
          });

          if (response.status === 404 || response.status === 410) {
            failures.push({ kind: 'missing', url: url });
            continue;
          }

          if (!response.ok) {
            failures.push({ kind: 'http', url: url, status: response.status });
            continue;
          }

          const contentType = (response.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('text/html')) {
            // 某些静态托管会把不存在的路径回退到 404 页面。
            failures.push({ kind: 'missing', url: url });
            continue;
          }

          const bytes = await response.arrayBuffer();
          if (!bytes || bytes.byteLength === 0) {
            failures.push({ kind: 'empty', url: url });
            continue;
          }

          referenceBytesCache = bytes;
          hideReferenceNotice();
          return bytes;
        } catch (error) {
          failures.push({
            kind: error && error.name === 'AbortError' ? 'timeout' : 'network',
            url: url
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
      }

      const allMissing = failures.length > 0 && failures.every(function (failure) {
        return failure.kind === 'missing';
      });

      if (allMissing) {
        showReferenceMissingNotice();
        throw new AppError(
          'reference-missing',
          '缺少参考音频 reference.mp3 / reference.wav',
          '请把 reference.mp3 或 reference.wav 放到 index.html 同目录（项目根目录），然后刷新页面或再试一次。'
        );
      }

      if (failures.some(function (failure) { return failure.kind === 'empty'; })) {
        showReferenceNotice(
          '参考音频是空文件',
          'reference.mp3 或 reference.wav 没有可读取的数据，请换一个有效的音频文件。'
        );
        throw new AppError(
          'reference-empty',
          '参考音频是空文件',
          '参考音频没有可读取的数据，请换一个有效的 MP3 或 WAV 文件后重试。'
        );
      }

      if (failures.some(function (failure) { return failure.kind === 'timeout'; })) {
        showReferenceNotice(
          '读取参考音频超时',
          '读取 reference.mp3 或 reference.wav 超时。请检查文件大小与本地服务器状态后再试。'
        );
        throw new AppError(
          'reference-timeout',
          '读取参考音频超时',
          '读取参考音频超时。请确认文件存在且本地服务器仍在运行，然后再试一次。'
        );
      }

      const httpFailure = failures.find(function (failure) {
        return failure.kind === 'http';
      });

      showReferenceNotice(
        '无法读取参考音频',
        '读取 reference.mp3 或 reference.wav 时服务器返回异常。请确认文件存在、文件名拼写正确，并通过本地服务器或 HTTPS 访问。'
      );
      throw new AppError(
        'reference-unavailable',
        '无法读取参考音频',
        httpFailure
          ? '读取参考音频失败（HTTP ' + httpFailure.status + '）。请确认文件存在且文件名拼写正确。'
          : '读取参考音频失败。请确认 reference.mp3 或 reference.wav 放在 index.html 同目录，并通过本地服务器或 HTTPS 访问页面。'
      );
    })();

    referenceBytesPromise = promise;
    promise.then(
      function () {
        referenceBytesPromise = null;
      },
      function () {
        referenceBytesPromise = null;
      }
    );

    return promise;
  }

  async function loadReferenceAudio(context) {
    if (referenceAudioBuffer) {
      return referenceAudioBuffer;
    }

    const bytes = await prefetchReferenceBytes();
    let decoded;

    try {
      // decodeAudioData 会转移输入 ArrayBuffer，传副本以保留原始缓存。
      decoded = await decodeAudioData(context, bytes.slice(0));
    } catch (error) {
      referenceBytesCache = null;
      showReferenceNotice(
        '参考音频无法解码',
        'reference.mp3 或 reference.wav 可能已损坏，或浏览器不支持这种音频编码。请换用常见 MP3 或 16-bit PCM WAV 后重试。'
      );
      throw new AppError(
        'reference-decode',
        '参考音频无法解码',
        '参考音频无法被浏览器解码。请确认 reference.mp3 或 reference.wav 是有效的 MP3 / WAV 文件，并重新放置到项目根目录。'
      );
    }

    if (!decoded || !decoded.length) {
      referenceBytesCache = null;
      throw new AppError(
        'reference-empty-audio',
        '参考音频没有可用内容',
        '参考音频解码后没有音频数据，请换一个有效的 MP3 或 WAV 文件。'
      );
    }

    referenceAudioBuffer = decoded;
    referenceMonoCache = null;
    referenceFeatureCache = null;
    hideReferenceNotice();
    return decoded;
  }

  /* ==================== 开始录音 ==================== */

  async function beginRecording() {
    if (appState === 'starting' || appState === 'recording' || appState === 'stopping' || appState === 'analyzing') {
      return;
    }

    if (!hasMeyda()) {
      showMeydaNotice();
      resetToStart();
      showStartError('Meyda 音频分析库没有加载成功，暂时无法评分。请检查网络，或按 README 使用本地 vendor 版本。');
      return;
    }

    const compatibilityError = getCompatibilityError();
    if (compatibilityError) {
      resetToStart();
      showStartError(compatibilityError);
      return;
    }

    resetToStart();
    appState = 'starting';
    setStartBusy(true);

    try {
      const context = ensureAudioContext();
      const resumePromise = context.state === 'suspended'
        ? context.resume().catch(function () {
            // 录音本身不依赖播放；如果恢复失败，仍继续尝试录音。
            return null;
          })
        : Promise.resolve(null);

      // 按需求直接请求 audio: true。调用发生在用户点击的同一任务中，以保留权限手势。
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await resumePromise;

      if (!stream || typeof stream.getAudioTracks !== 'function' || stream.getAudioTracks().length === 0) {
        if (stream) {
          stream.getTracks().forEach(function (track) {
            track.stop();
          });
        }
        throw new AppError(
          'no-audio-track',
          '没有可用的麦克风音轨',
          '浏览器没有返回可用的麦克风音轨，请检查系统麦克风设置后重试。'
        );
      }

      if (appState !== 'starting') {
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
        return;
      }

      await startRecorderSession(stream, context);
    } catch (error) {
      clearRecordingTimers();
      stopMeter();
      releaseMediaResources();
      detachMediaRecorder();
      appState = 'idle';
      resetToStart();
      showStartError(microphoneErrorMessage(error));
    }
  }

  async function startRecorderSession(stream, context) {
    mediaStream = stream;
    recordedChunks = [];
    recorderFailureHandled = false;
    finalizeStarted = false;

    try {
      const result = createMediaRecorder(stream);
      mediaRecorder = result.recorder;
      currentMimeType = result.mimeType;
    } catch (error) {
      releaseMediaResources();
      throw error;
    }

    mediaRecorder.ondataavailable = function (event) {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onerror = function (event) {
      handleRecorderFailure(event);
    };

    mediaRecorder.onstop = function () {
      finalizeRecording().catch(function () {
        if (appState !== 'error') {
          showFatalError(
            '音频分析失败',
            '产生结果时遇到了意外问题。请刷新页面后重试，或换用最新版 Chrome 或 Edge。'
          );
        }
      });
    };

    try {
      startMeter(stream, context);
      recordingStartedAt = performance.now();
      recordingStoppedAt = 0;
      mediaRecorder.start(250);
    } catch (error) {
      stopMeter();
      releaseMediaResources();
      detachMediaRecorder();
      throw new AppError(
        'recorder-start-failed',
        '无法开始录音',
        '麦克风已经打开，但录音器没有成功启动。请关闭其他占用麦克风的应用后重试。'
      );
    }

    appState = 'recording';
    prepareRecordPanelForTake();
    showScreen('record');
    dom.stopBtn.disabled = false;
    dom.recordHint.textContent = '最长 10 秒，倒计时结束会自动停止。';
    updateCountdown(MAX_RECORD_MS);

    countdownTimer = window.setInterval(tickCountdown, 100);
    autoStopTimer = window.setTimeout(function () {
      stopRecording('auto');
    }, MAX_RECORD_MS);

    window.setTimeout(function () {
      if (appState === 'recording') {
        dom.recordHeading.focus({ preventScroll: true });
      }
    }, 0);
  }

  function prepareRecordPanelForTake() {
    dom.recordLive.hidden = false;
    dom.analyzingPanel.hidden = true;
    dom.analyzingPanel.setAttribute('aria-busy', 'false');
    dom.analyzingBar.style.width = '4%';
    dom.analyzingDetail.textContent = '正在本地解码录音…';
    dom.recordStateText.textContent = '正在录音…';
    dom.stopBtn.disabled = true;
    dom.stopBtn.textContent = STOP_LABEL;
    dom.recordHint.textContent = '最长 10 秒，倒计时结束会自动停止。';
    dom.countdownText.textContent = '10.0';
    if (dom.countdown) {
      dom.countdown.classList.remove('is-urgent');
    }
    dom.levelBar.style.width = '0%';
    dom.levelTrack.setAttribute('aria-valuenow', '0');
    dom.startError.hidden = true;
    dom.startBtn.textContent = START_LABEL;
    dom.startBtn.disabled = false;
    dom.retryBtn.disabled = false;
  }

  function createMediaRecorder(stream) {
    const candidates = [
      { mimeType: 'audio/webm;codecs=opus', useOptions: true },
      { mimeType: 'audio/webm', useOptions: true },
      { mimeType: '', useOptions: false }
    ];
    let lastError = null;

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];

      if (
        candidate.useOptions &&
        typeof window.MediaRecorder.isTypeSupported === 'function' &&
        !window.MediaRecorder.isTypeSupported(candidate.mimeType)
      ) {
        continue;
      }

      try {
        const recorder = candidate.useOptions
          ? new window.MediaRecorder(stream, { mimeType: candidate.mimeType })
          : new window.MediaRecorder(stream);

        return {
          recorder: recorder,
          mimeType: recorder.mimeType || candidate.mimeType || ''
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw new AppError(
      'recorder-unsupported',
      '无法开始录音',
      '当前浏览器没有可用的录音编码格式，无法启动 MediaRecorder。请使用最新版 Chrome、Edge 或 Safari。'
    );
  }

  function startMeter(stream, context) {
    stopMeter();

    try {
      sourceNode = context.createMediaStreamSource(stream);
      analyserNode = context.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.62;

      // 将分析器接入一个 0 增益节点，保证音频图被驱动，同时不会把麦克风声音放出来。
      silentGainNode = context.createGain();
      silentGainNode.gain.value = 0;

      sourceNode.connect(analyserNode);
      analyserNode.connect(silentGainNode);
      silentGainNode.connect(context.destination);

      meterFloatData = new Float32Array(analyserNode.fftSize);
      meterByteData = new Uint8Array(analyserNode.fftSize);

      const draw = function () {
        try {
          if (!analyserNode) {
            return;
          }

          let rms = 0;

          if (typeof analyserNode.getFloatTimeDomainData === 'function') {
            analyserNode.getFloatTimeDomainData(meterFloatData);
            let sum = 0;
            for (let i = 0; i < meterFloatData.length; i += 1) {
              const value = meterFloatData[i];
              sum += value * value;
            }
            rms = Math.sqrt(sum / meterFloatData.length);
          } else if (typeof analyserNode.getByteTimeDomainData === 'function') {
            analyserNode.getByteTimeDomainData(meterByteData);
            let sum = 0;
            for (let i = 0; i < meterByteData.length; i += 1) {
              const value = (meterByteData[i] - 128) / 128;
              sum += value * value;
            }
            rms = Math.sqrt(sum / meterByteData.length);
          }

          // 用 dB 映射 RMS 到 0–100%，让说话声的指示条更容易看清。
          const db = 20 * Math.log10(Math.max(rms, 1e-8));
          const level = clamp((db + 60) / 48, 0, 1);
          const percent = Math.round(level * 100);

          dom.levelBar.style.width = percent + '%';
          dom.levelTrack.setAttribute('aria-valuenow', String(percent));

          meterAnimationId = window.requestAnimationFrame(draw);
        } catch (error) {
          stopMeter();
        }
      };

      draw();
    } catch (error) {
      stopMeter();
      dom.recordHint.textContent = '麦克风音量指示暂不可用，但仍然可以录音。';
    }
  }

  function stopMeter() {
    if (meterAnimationId) {
      window.cancelAnimationFrame(meterAnimationId);
      meterAnimationId = 0;
    }

    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch (error) {
        // 节点可能已经断开。
      }
    }
    if (analyserNode) {
      try {
        analyserNode.disconnect();
      } catch (error) {
        // 节点可能已经断开。
      }
    }
    if (silentGainNode) {
      try {
        silentGainNode.disconnect();
      } catch (error) {
        // 节点可能已经断开。
      }
    }

    sourceNode = null;
    analyserNode = null;
    silentGainNode = null;
    meterFloatData = null;
    meterByteData = null;

    if (dom.levelBar) {
      dom.levelBar.style.width = '0%';
    }
    if (dom.levelTrack) {
      dom.levelTrack.setAttribute('aria-valuenow', '0');
    }
  }

  function tickCountdown() {
    if (appState !== 'recording') {
      return;
    }

    const elapsed = performance.now() - recordingStartedAt;
    const remaining = Math.max(0, MAX_RECORD_MS - elapsed);
    updateCountdown(remaining);

    if (remaining <= 0) {
      stopRecording('auto');
    }
  }

  function updateCountdown(remainingMs) {
    const seconds = Math.max(0, remainingMs) / 1000;
    dom.countdownText.textContent = seconds.toFixed(1);

    if (dom.countdown) {
      dom.countdown.classList.toggle('is-urgent', seconds <= 3 && seconds > 0);
    }
  }

  function clearRecordingTimers() {
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = 0;
    }
    if (autoStopTimer) {
      window.clearTimeout(autoStopTimer);
      autoStopTimer = 0;
    }
  }

  function stopRecording(reason) {
    if (appState !== 'recording') {
      return;
    }

    appState = 'stopping';
    recordingStoppedAt = performance.now();
    clearRecordingTimers();
    stopMeter();

    dom.stopBtn.disabled = true;
    dom.stopBtn.textContent = '正在整理…';
    dom.recordStateText.textContent = '正在结束录音…';
    dom.recordHint.textContent = '正在把这段录音送到本地分析器…';

    if (reason === 'auto') {
      updateCountdown(0);
      dom.countdownText.textContent = '0.0';
    }

    try {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      } else {
        finalizeRecording().catch(function () {
          showFatalError(
            '音频分析失败',
            '录音结束后无法开始分析。请刷新页面后重新录制。'
          );
        });
      }
    } catch (error) {
      releaseMediaResources();
      detachMediaRecorder();
      showFatalError(
        '录音没有正常结束',
        '结束录音时遇到问题。请检查麦克风后重新录制一次。'
      );
    }
  }

  function handleRecorderFailure() {
    if (recorderFailureHandled) {
      return;
    }
    if (appState !== 'recording' && appState !== 'stopping') {
      return;
    }

    recorderFailureHandled = true;
    clearRecordingTimers();
    stopMeter();
    releaseMediaResources();
    detachMediaRecorder();
    finalizeStarted = true;

    showFatalError(
      '录音中断了',
      '录音过程中没有拿到有效数据。请确认麦克风没有被其他程序占用，然后重新录制。'
    );
  }

  async function finalizeRecording() {
    if (finalizeStarted) {
      return;
    }
    finalizeStarted = true;

    if (appState !== 'recording' && appState !== 'stopping') {
      releaseMediaResources();
      detachMediaRecorder();
      return;
    }

    if (appState === 'recording') {
      recordingStoppedAt = performance.now();
      clearRecordingTimers();
      stopMeter();
    }

    const stopAt = recordingStoppedAt || performance.now();
    const recordedSeconds = clamp((stopAt - recordingStartedAt) / 1000, 0, MAX_CLIP_SECONDS);
    const blobType = (mediaRecorder && mediaRecorder.mimeType) || currentMimeType || 'audio/webm';
    const blob = new Blob(recordedChunks, { type: blobType });

    recordedChunks = [];
    releaseMediaResources();
    detachMediaRecorder();

    if (!blob || blob.size === 0) {
      showFatalError(
        '没有录到声音',
        '这次没有收到任何音频数据。请检查麦克风权限，靠近麦克风后再录一次。'
      );
      return;
    }

    appState = 'analyzing';
    showAnalyzingView();
    await afterPaint();

    try {
      const result = await analyzeRecording(blob, recordedSeconds);

      if (appState !== 'analyzing') {
        return;
      }

      renderResult(result);
    } catch (error) {
      if (appState !== 'analyzing') {
        return;
      }
      handleAnalysisFailure(error);
    } finally {
      dom.analyzingPanel.setAttribute('aria-busy', 'false');
    }
  }

  function showAnalyzingView() {
    dom.startBtn.disabled = true;
    dom.stopBtn.disabled = true;
    dom.retryBtn.disabled = true;
    dom.recordLive.hidden = true;
    dom.analyzingPanel.hidden = false;
    dom.analyzingPanel.setAttribute('aria-busy', 'true');
    dom.analyzingDetail.textContent = '正在本地解码录音…';
    dom.analyzingBar.style.width = '4%';
    dom.recordHint.textContent = '分析中，按钮已暂时禁用，请稍候。';
    dom.stopBtn.textContent = STOP_LABEL;
    showScreen('record');
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function setAnalyzingProgress(percent, detail) {
    const safePercent = clamp(percent, 0, 100);
    if (typeof detail === 'string') {
      dom.analyzingDetail.textContent = detail;
    }
    dom.analyzingBar.style.width = safePercent.toFixed(1) + '%';
  }

  function releaseMediaResources() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (track) {
        try {
          track.stop();
        } catch (error) {
          // 音轨可能已经结束。
        }
      });
      mediaStream = null;
    }
    stopMeter();
  }

  function detachMediaRecorder() {
    if (mediaRecorder) {
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onerror = null;
      mediaRecorder.onstop = null;
    }
    mediaRecorder = null;
    currentMimeType = '';
  }

  function ensureAudioContext() {
    if (audioContext) {
      return audioContext;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new AppError(
        'no-web-audio',
        '无法分析音频',
        '当前浏览器不支持 Web Audio API，无法分析录音。请使用最新版 Chrome、Edge 或 Safari。'
      );
    }

    try {
      audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
    } catch (error) {
      try {
        audioContext = new AudioContextConstructor();
      } catch (fallbackError) {
        throw new AppError(
          'audio-context-failed',
          '无法初始化音频分析',
          '浏览器没有成功创建音频分析上下文。请刷新页面或更换浏览器后重试。'
        );
      }
    }

    return audioContext;
  }

  function getCompatibilityError() {
    if (!window.isSecureContext) {
      return '麦克风需要 HTTPS 或 localhost 环境。请通过本地服务器（例如 npx serve）打开页面，不要直接双击 index.html。';
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return '当前浏览器或当前环境不支持麦克风录音。请使用最新版 Chrome、Edge 或 Safari，并检查浏览器权限。';
    }
    if (typeof window.MediaRecorder === 'undefined') {
      return '当前浏览器不支持 MediaRecorder，无法录音。请升级浏览器后再试。';
    }
    if (!(window.AudioContext || window.webkitAudioContext)) {
      return '当前浏览器不支持 Web Audio，无法分析声音。请换用最新版 Chrome 或 Edge。';
    }
    if (!hasMeyda()) {
      return 'Meyda 音频分析库没有加载成功，暂时无法评分。请检查网络，或按 README 使用本地 vendor 版本。';
    }
    return '';
  }

  function microphoneErrorMessage(error) {
    if (error && error.isUserFacing) {
      return error.message;
    }
    if (!window.isSecureContext) {
      return '麦克风需要 HTTPS 或 localhost 环境。请通过本地服务器打开页面后重试。';
    }

    const name = error && error.name;

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return '麦克风权限被拒绝。请在浏览器地址栏的权限设置中允许麦克风，然后重试。';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return '没有找到可用的麦克风设备。请连接麦克风并检查系统声音设置。';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return '麦克风被其他程序占用或无法读取。请关闭占用麦克风的应用后重试。';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return '当前麦克风不满足录音条件。请更换输入设备后重试。';
    }
    if (name === 'AbortError') {
      return '麦克风启动被中断了，请再试一次。';
    }
    return '无法开始录音。请检查麦克风权限、设备连接和浏览器设置后重试。';
  }

  /* ==================== 音频分析 ==================== */

  async function analyzeRecording(blob, recordedSeconds) {
    const context = ensureAudioContext();
    const sampleRate = context.sampleRate;

    setAnalyzingProgress(7, '正在解码你的录音…');
    await afterPaint();

    let userAudioBuffer;

    try {
      const arrayBuffer = await blob.arrayBuffer();
      userAudioBuffer = await decodeAudioData(context, arrayBuffer);
    } catch (error) {
      throw new AppError(
        'user-decode-failed',
        '你的录音无法解码',
        '浏览器无法解码这段录音。请刷新页面后重新录制；如果仍然失败，请换用最新版 Chrome 或 Edge。'
      );
    }

    if (!userAudioBuffer || !userAudioBuffer.length) {
      throw new AppError(
        'user-audio-empty',
        '录音里没有可分析的声音',
        '这段录音解码后是空的，请重新录制。'
      );
    }

    setAnalyzingProgress(15, '正在读取参考音频 ' + REFERENCE_FILES_LABEL + '…');
    await afterPaint();

    const referenceBuffer = await loadReferenceAudio(context);

    setAnalyzingProgress(24, '正在做单声道、音量归一化与静音裁剪…');
    await afterPaint();

    const userMono = mixToMono(userAudioBuffer);
    const userRawStats = getRawAudioStats(userMono);

    const referenceMono = referenceMonoCache || mixToMono(referenceBuffer);
    referenceMonoCache = referenceMono;
    const referenceRawStats = getRawAudioStats(referenceMono);

    if (!referenceRawStats.peak || referenceRawStats.peak < 1e-5) {
      throw new AppError(
        'reference-silent',
        '参考音频没有有效声音',
        '参考音频几乎是静音，无法用来评分。请换一个包含清晰奶龙笑声的 MP3 或 WAV 文件。'
      );
    }

    const preparedReference = prepareAudioForFeatures(referenceMono, sampleRate);
    if (
      preparedReference.samples.length < FRAME_SIZE ||
      preparedReference.effectiveSeconds < MIN_VALID_DURATION_SECONDS
    ) {
      throw new AppError(
        'reference-too-short',
        '参考音频太短',
        '参考音频裁剪后不足 0.18 秒，无法提取有效特征。请换用至少约 1 秒的参考音频。'
      );
    }

    if (isNearlySilent(userRawStats)) {
      return createSilentResult(
        recordedSeconds,
        0,
        referenceFeatureCache ? referenceFeatureCache.frameCount : null
      );
    }

    const preparedUser = prepareAudioForFeatures(userMono, sampleRate);
    if (
      preparedUser.samples.length < FRAME_SIZE ||
      preparedUser.effectiveSeconds < MIN_VALID_DURATION_SECONDS
    ) {
      return createSilentResult(
        recordedSeconds,
        preparedUser.effectiveSeconds,
        referenceFeatureCache ? referenceFeatureCache.frameCount : null
      );
    }

    configureMeyda(sampleRate);

    let referenceFeatures = referenceFeatureCache;
    if (!referenceFeatures) {
      setAnalyzingProgress(31, '正在提取参考音频的 MFCC 特征…');
      await afterPaint();

      referenceFeatures = await extractFeatureSet(
        preparedReference.samples,
        sampleRate,
        '正在提取参考音频的 MFCC 特征…',
        function (fraction) {
          setAnalyzingProgress(31 + fraction * 22, '正在提取参考音频的 MFCC 特征…');
        }
      );

      referenceFeatureCache = referenceFeatures;
    }

    setAnalyzingProgress(54, '正在提取你的声音特征…');
    await afterPaint();

    const userFeatures = await extractFeatureSet(
      preparedUser.samples,
      sampleRate,
      '正在提取你的 MFCC 特征…',
      function (fraction) {
        setAnalyzingProgress(54 + fraction * 29, '正在提取你的 MFCC 特征…');
      }
    );

    setAnalyzingProgress(88, '正在计算相似度…');
    await afterPaint();

    const similarity = computeSimilarity(userFeatures, referenceFeatures);
    const score = Math.round(similarity.finalSimilarity * 100);
    const tier = pictureTierForScore(score);

    setAnalyzingProgress(100, '分析完成，正在整理结果…');
    await afterPaint();

    return {
      silent: false,
      score: score,
      similarity: similarity.finalSimilarity,
      verdict: verdictForScore(score),
      picture: tier,
      debug: {
        recordDurationSeconds: recordedSeconds,
        effectiveDurationSeconds: userFeatures.duration,
        userFrameCount: userFeatures.frameCount,
        referenceFrameCount: referenceFeatures.frameCount,
        mfccDimension: userFeatures.mfccDimension,
        rawCosine: similarity.rawCosine,
        envelopeCorrelation: similarity.envelopeCorrelation,
        envelopeValid: similarity.envelopeCorrelation !== null
      }
    };
  }

  async function decodeAudioData(context, arrayBuffer) {
    return new Promise(function (resolve, reject) {
      let settled = false;

      const done = function (buffer) {
        if (settled) {
          return;
        }
        settled = true;
        resolve(buffer);
      };

      const fail = function (error) {
        if (settled) {
          return;
        }
        settled = true;
        reject(error || new Error('decodeAudioData failed'));
      };

      try {
        const maybePromise = context.decodeAudioData(arrayBuffer, done, fail);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done, fail);
        }
      } catch (error) {
        fail(error);
      }
    });
  }

  function mixToMono(audioBuffer) {
    const channelCount = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);

    if (channelCount === 1) {
      mono.set(audioBuffer.getChannelData(0));
      return mono;
    }

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        mono[i] += data[i];
      }
    }

    for (let i = 0; i < length; i += 1) {
      mono[i] /= channelCount;
    }

    return mono;
  }

  function getRawAudioStats(samples) {
    let peak = 0;
    let sumSquares = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i];
      const abs = Math.abs(value);
      if (abs > peak) {
        peak = abs;
      }
      sumSquares += value * value;
    }

    return {
      peak: peak,
      rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0
    };
  }

  function isNearlySilent(stats) {
    return stats.peak < SILENCE_PEAK_THRESHOLD || stats.rms < SILENCE_RMS_THRESHOLD;
  }

  function peakNormalize(samples) {
    let peak = 0;

    for (let i = 0; i < samples.length; i += 1) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) {
        peak = abs;
      }
    }

    const output = new Float32Array(samples.length);
    if (peak < 1e-8) {
      return output;
    }

    const gain = 1 / peak;
    for (let i = 0; i < samples.length; i += 1) {
      output[i] = samples[i] * gain;
    }
    return output;
  }

  function prepareAudioForFeatures(samples, sampleRate) {
    const normalized = peakNormalize(samples);
    const trimmed = trimSilenceByRms(normalized, sampleRate);
    const maxSamples = Math.round(sampleRate * MAX_CLIP_SECONDS);
    const capped = trimmed.length > maxSamples ? trimmed.slice(0, maxSamples) : trimmed;

    return {
      samples: capped,
      effectiveSeconds: capped.length / sampleRate
    };
  }

  function trimSilenceByRms(samples, sampleRate) {
    if (samples.length < FRAME_SIZE) {
      return new Float32Array(0);
    }

    const energies = [];
    let maxEnergy = 0;

    for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
      let sum = 0;
      for (let i = start; i < start + FRAME_SIZE; i += 1) {
        sum += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sum / FRAME_SIZE);
      energies.push(rms);
      if (rms > maxEnergy) {
        maxEnergy = rms;
      }
    }

    if (!energies.length || maxEnergy < 1e-8) {
      return new Float32Array(0);
    }

    const threshold = Math.max(TRIM_ABSOLUTE_THRESHOLD, maxEnergy * TRIM_RELATIVE_THRESHOLD);
    let firstActive = -1;
    let lastActive = -1;

    for (let i = 0; i < energies.length; i += 1) {
      if (energies[i] >= threshold) {
        if (firstActive === -1) {
          firstActive = i;
        }
        lastActive = i;
      }
    }

    if (firstActive === -1 || lastActive === -1) {
      return new Float32Array(0);
    }

    const padding = Math.round(TRIM_PADDING_SECONDS * sampleRate);
    let startSample = Math.max(0, firstActive * HOP_SIZE - padding);
    let endSample = Math.min(samples.length, lastActive * HOP_SIZE + FRAME_SIZE + padding);

    if (endSample <= startSample) {
      return new Float32Array(0);
    }

    return samples.slice(startSample, endSample);
  }

  /* ==================== Meyda / 特征 ==================== */

  function hasMeyda() {
    return Boolean(
      window.Meyda &&
      typeof window.Meyda.extract === 'function'
    );
  }

  function configureMeyda(sampleRate) {
    const Meyda = window.Meyda;

    if (!Meyda || typeof Meyda.extract !== 'function') {
      throw new AppError(
        'meyda-missing',
        'Meyda 没有加载',
        '音频分析库 Meyda 不可用。请刷新页面或按 README 使用本地 vendor 版本。'
      );
    }

    if (meydaConfiguredSampleRate !== sampleRate) {
      // 上下文采样率变化时清除 Meyda 内部缓存的滤波器组，避免沿用旧采样率。
      Meyda.melFilterBank = undefined;
      Meyda.barkScale = undefined;
      Meyda.chromaFilterBank = undefined;
      meydaConfiguredSampleRate = sampleRate;
    }

    Meyda.bufferSize = FRAME_SIZE;
    Meyda.sampleRate = sampleRate;
    Meyda.melBands = MEL_BANDS;
    Meyda.numberOfMFCCCoefficients = MFCC_COEFFICIENTS;
    // 下方会手动乘 Hann 窗；这里关闭 Meyda 的默认窗函数，避免重复加窗。
    Meyda.windowingFunction = 'rect';
  }

  function getHannWindow() {
    if (hannWindow) {
      return hannWindow;
    }

    hannWindow = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i += 1) {
      hannWindow[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
    }
    return hannWindow;
  }

  async function extractFeatureSet(samples, sampleRate, progressLabel, onProgress) {
    const Meyda = window.Meyda;

    if (!Meyda || typeof Meyda.extract !== 'function') {
      throw new AppError(
        'meyda-missing',
        'Meyda 没有加载',
        '音频分析库 Meyda 不可用，无法提取声音特征。请刷新页面或使用本地 vendor 版本。'
      );
    }

    if (!samples || samples.length < FRAME_SIZE) {
      throw new AppError(
        'audio-too-short',
        '音频太短',
        '音频不足一帧，无法提取特征。'
      );
    }

    configureMeyda(sampleRate);

    const frameCount = Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1;
    if (frameCount < 1) {
      throw new AppError('no-frames', '音频太短', '没有完整的分析帧，请录长一点。');
    }

    const meydaOptions = {
      sampleRate: sampleRate,
      bufferSize: FRAME_SIZE,
      melBands: MEL_BANDS,
      numberOfMFCCCoefficients: MFCC_COEFFICIENTS
    };

    const windowValues = getHannWindow();
    const mfccSums = new Float64Array(MFCC_COEFFICIENTS);
    const deltaSums = new Float64Array(MFCC_COEFFICIENTS);
    const energyFrames = new Float32Array(frameCount);
    const frame = new Float32Array(FRAME_SIZE);
    let previousMfcc = null;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const offset = frameIndex * HOP_SIZE;
      let sumSquares = 0;

      for (let i = 0; i < FRAME_SIZE; i += 1) {
        const value = samples[offset + i];
        sumSquares += value * value;
        frame[i] = value * windowValues[i];
      }

      let mfcc;
      try {
        // 按约定调用；Meyda 5 的静态 extract 从全局配置读取 bufferSize 等参数。
        mfcc = Meyda.extract('mfcc', frame, meydaOptions);
      } catch (error) {
        throw new AppError(
          'mfcc-extract-failed',
          '音频特征提取失败',
          'Meyda 在提取 MFCC 时出错。请刷新页面，或按 README 使用本地 vendor 版本后重试。'
        );
      }

      if (!mfcc || mfcc.length < MFCC_COEFFICIENTS) {
        throw new AppError(
          'mfcc-invalid',
          '音频特征提取失败',
          '没有拿到完整的 13 维 MFCC。请刷新页面或更换浏览器后重试。'
        );
      }

      for (let d = 0; d < MFCC_COEFFICIENTS; d += 1) {
        const value = Number(mfcc[d]);
        if (!Number.isFinite(value)) {
          throw new AppError(
            'mfcc-non-finite',
            '音频特征提取失败',
            'MFCC 中包含无效数值。请换一段更清晰的录音后重试。'
          );
        }

        mfccSums[d] += value;
        if (previousMfcc) {
          deltaSums[d] += value - previousMfcc[d];
        }
      }

      previousMfcc = Array.prototype.slice.call(mfcc, 0, MFCC_COEFFICIENTS);
      energyFrames[frameIndex] = Math.sqrt(sumSquares / FRAME_SIZE);

      const finished = frameIndex + 1;
      if (finished % FRAMES_PER_SLICE === 0 || finished === frameCount) {
        if (typeof onProgress === 'function') {
          onProgress(finished / frameCount, progressLabel);
        }
        await yieldToMainThread();
      }
    }

    const mfccMeans = new Array(MFCC_COEFFICIENTS);
    const deltaMeans = new Array(MFCC_COEFFICIENTS);
    const denominator = Math.max(1, frameCount - 1);

    for (let d = 0; d < MFCC_COEFFICIENTS; d += 1) {
      mfccMeans[d] = mfccSums[d] / frameCount;
      deltaMeans[d] = frameCount > 1 ? deltaSums[d] / denominator : 0;
    }

    const featureVector = mfccMeans.concat(deltaMeans);
    const envelope = resampleEnvelope(energyFrames, ENVELOPE_POINTS);
    const duration = samples.length / sampleRate;
    const envelopeSeries = buildTimedEnvelope(energyFrames, sampleRate, duration, ENVELOPE_BIN_SECONDS);

    return {
      featureVector: featureVector,
      mfccMeans: mfccMeans,
      deltaMeans: deltaMeans,
      envelope: envelope,
      envelopeSeries: envelopeSeries,
      envelopeBinSeconds: ENVELOPE_BIN_SECONDS,
      frameCount: frameCount,
      mfccDimension: MFCC_COEFFICIENTS,
      duration: duration,
      sampleRate: sampleRate
    };
  }

  function buildTimedEnvelope(energyFrames, sampleRate, duration, binSeconds) {
    if (!energyFrames.length) {
      return [];
    }

    const hopSeconds = HOP_SIZE / sampleRate;
    const binCount = Math.max(2, Math.round(duration / binSeconds));
    const output = new Array(binCount);

    for (let i = 0; i < binCount; i += 1) {
      const time = (i / (binCount - 1)) * duration;
      const position = Math.min(
        energyFrames.length - 1,
        Math.max(0, time / hopSeconds)
      );
      const lower = Math.floor(position);
      const upper = Math.min(energyFrames.length - 1, lower + 1);
      const weight = position - lower;
      output[i] = energyFrames[lower] * (1 - weight) + energyFrames[upper] * weight;
    }

    return output;
  }

  function resampleEnvelope(energies, targetLength) {
    if (!energies.length) {
      return [];
    }

    if (energies.length === 1) {
      return new Array(targetLength).fill(energies[0]);
    }

    const output = new Array(targetLength);

    for (let i = 0; i < targetLength; i += 1) {
      const position = (i * (energies.length - 1)) / (targetLength - 1);
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      const weight = position - lower;
      output[i] = energies[lower] * (1 - weight) + energies[upper] * weight;
    }

    return output;
  }

  /* ==================== 相似度 ==================== */

  function cosineSimilarity(vectorA, vectorB) {
    const length = Math.min(vectorA.length, vectorB.length);
    if (!length) {
      return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < length; i += 1) {
      dot += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    if (normA < 1e-12 || normB < 1e-12) {
      return 0;
    }

    const value = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  }

  function pearsonCorrelation(envelopeA, envelopeB) {
    const length = Math.min(envelopeA.length, envelopeB.length);
    if (length < 2) {
      return null;
    }

    let meanA = 0;
    let meanB = 0;

    for (let i = 0; i < length; i += 1) {
      meanA += envelopeA[i];
      meanB += envelopeB[i];
    }

    meanA /= length;
    meanB /= length;

    let numerator = 0;
    let varianceA = 0;
    let varianceB = 0;

    for (let i = 0; i < length; i += 1) {
      const a = envelopeA[i] - meanA;
      const b = envelopeB[i] - meanB;
      numerator += a * b;
      varianceA += a * a;
      varianceB += b * b;
    }

    if (varianceA < 1e-12 || varianceB < 1e-12) {
      return null;
    }

    const value = numerator / Math.sqrt(varianceA * varianceB);
    return Number.isFinite(value) ? clamp(value, -1, 1) : null;
  }

  function buildSpectralShapeVector(features) {
    if (Array.isArray(features.mfccMeans) && Array.isArray(features.deltaMeans)) {
      // 去掉第 0 维能量系数 c0：它对音量、麦克风增益和整体响度极其敏感，
      // 保留 c1–c12 的频谱包络与一阶变化，更能代表“音色和发声方式”。
      return features.mfccMeans.slice(1).concat(features.deltaMeans.slice(1));
    }

    if (Array.isArray(features.featureVector)) {
      return features.featureVector.slice(1, MFCC_COEFFICIENTS)
        .concat(features.featureVector.slice(MFCC_COEFFICIENTS + 1));
    }

    return [];
  }

  function bestAlignedEnvelopeCorrelation(userFeatures, referenceFeatures) {
    const userSeries = userFeatures.envelopeSeries;
    const referenceSeries = referenceFeatures.envelopeSeries;

    if (!Array.isArray(userSeries) || !Array.isArray(referenceSeries) ||
        userSeries.length < 2 || referenceSeries.length < 2) {
      return pearsonCorrelation(userFeatures.envelope, referenceFeatures.envelope);
    }

    // 两段录音长度/节奏起点往往不同。用固定 50ms 时间分辨率，把较短一方的包络
    // 在较长一方上滑动，取最匹配位置的 Pearson 相关系数，而不是强行首尾对齐。
    const userIsShorter = userSeries.length <= referenceSeries.length;
    const shorter = userIsShorter ? userSeries : referenceSeries;
    const longer = userIsShorter ? referenceSeries : userSeries;

    if (shorter.length === longer.length) {
      return pearsonCorrelation(longer, shorter);
    }

    let best = null;
    const maxOffset = longer.length - shorter.length;

    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const window = longer.slice(offset, offset + shorter.length);
      const correlation = pearsonCorrelation(window, shorter);

      if (correlation !== null && (best === null || correlation > best)) {
        best = correlation;
      }
    }

    return best;
  }

  function computeSimilarity(userFeatures, referenceFeatures) {
    const userSpectral = buildSpectralShapeVector(userFeatures);
    const referenceSpectral = buildSpectralShapeVector(referenceFeatures);
    const rawCosine = cosineSimilarity(userSpectral, referenceSpectral);
    const envelopeCorrelation = bestAlignedEnvelopeCorrelation(userFeatures, referenceFeatures);

    // 负相关视为 0；平方锐化可以压低“泛泛相似”的基线。
    const mfccSimilarity = Math.pow(clamp(rawCosine, 0, 1), 2);

    let finalSimilarity;
    if (envelopeCorrelation === null) {
      // 包络无效（例如音量几乎恒定）时，只使用 MFCC 频谱相似度。
      finalSimilarity = mfccSimilarity;
    } else {
      const envelopeSimilarity = clamp(envelopeCorrelation, 0, 1);
      finalSimilarity = 0.8 * mfccSimilarity + 0.2 * envelopeSimilarity;
    }

    return {
      rawCosine: rawCosine,
      envelopeCorrelation: envelopeCorrelation,
      mfccSimilarity: mfccSimilarity,
      finalSimilarity: clamp(finalSimilarity, 0, 1)
    };
  }

  function verdictForScore(score) {
    if (score >= 85) {
      return VERDICTS.win;
    }
    if (score >= 70) {
      return VERDICTS.good;
    }
    if (score >= 50) {
      return VERDICTS.practice;
    }
    return VERDICTS.low;
  }

  function pictureTierForScore(score) {
    if (score >= 85) {
      return 'win';
    }
    if (score >= 50) {
      return 'mid';
    }
    return 'low';
  }

  function createSilentResult(recordedSeconds, effectiveSeconds, referenceFrameCount) {
    return {
      silent: true,
      score: 0,
      similarity: 0,
      verdict: VERDICTS.low,
      picture: 'low',
      debug: {
        recordDurationSeconds: recordedSeconds,
        effectiveDurationSeconds: Math.max(0, effectiveSeconds || 0),
        userFrameCount: 0,
        referenceFrameCount: referenceFrameCount || null,
        mfccDimension: MFCC_COEFFICIENTS,
        rawCosine: null,
        envelopeCorrelation: null,
        envelopeValid: false
      }
    };
  }

  /* ==================== 结果与错误渲染 ==================== */

  function renderResult(result) {
    appState = 'result';
    dom.startBtn.disabled = false;
    dom.stopBtn.disabled = true;
    dom.retryBtn.disabled = false;
    dom.analyzingPanel.setAttribute('aria-busy', 'false');

    dom.scoreValue.textContent = String(result.score);
    dom.similarityPercent.textContent = (result.similarity * 100).toFixed(1) + '%';
    dom.verdict.textContent = result.verdict;
    dom.silentNotice.hidden = !result.silent;

    dom.resultWinMedia.hidden = result.picture !== 'win';
    dom.resultMidMedia.hidden = result.picture !== 'mid';
    dom.resultLowMedia.hidden = result.picture !== 'low';

    dom.debugRecordDuration.textContent = formatSeconds(result.debug.recordDurationSeconds);
    dom.debugEffectiveDuration.textContent = formatSeconds(result.debug.effectiveDurationSeconds);

    if (result.silent) {
      dom.debugFrameCount.textContent = '0 帧（静音，未进入特征提取）';
      dom.debugMfccDims.textContent = '13 维（本次未提取）';
      dom.debugCosine.textContent = '未计算（静音）';
      dom.debugEnvelope.textContent = '未计算（静音）';
    } else {
      const referenceFrames = result.debug.referenceFrameCount;
      dom.debugFrameCount.textContent = result.debug.userFrameCount + ' 帧' +
        (typeof referenceFrames === 'number' ? '（参考音频 ' + referenceFrames + ' 帧）' : '');
      dom.debugMfccDims.textContent = result.debug.mfccDimension + ' 维均值 + ' +
        result.debug.mfccDimension + ' 维一阶差分；余弦比较去掉 c0，使用 24 维频谱特征';
      dom.debugCosine.textContent = result.debug.rawCosine.toFixed(4);
      dom.debugEnvelope.textContent = result.debug.envelopeCorrelation === null
        ? '无效（仅使用 MFCC）'
        : result.debug.envelopeCorrelation.toFixed(4);
    }

    showScreen('result');
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });

    window.requestAnimationFrame(function () {
      dom.resultHeading.focus({ preventScroll: true });
    });
  }

  function handleAnalysisFailure(error) {
    dom.startBtn.disabled = false;
    dom.stopBtn.disabled = true;
    dom.retryBtn.disabled = true;
    dom.errorHomeBtn.disabled = false;
    dom.analyzingPanel.setAttribute('aria-busy', 'false');

    if (error && error.isUserFacing) {
      showFatalError(error.title, error.message);
      return;
    }

    showFatalError(
      '音频分析失败',
      '本地分析过程中遇到了问题。请刷新页面后重试，或换用最新版 Chrome 或 Edge。'
    );
  }

  function showFatalError(title, message) {
    appState = 'error';
    clearRecordingTimers();
    stopMeter();
    releaseMediaResources();
    detachMediaRecorder();

    dom.startBtn.disabled = false;
    dom.stopBtn.disabled = true;
    dom.retryBtn.disabled = true;
    dom.errorHomeBtn.disabled = false;
    dom.analyzingPanel.setAttribute('aria-busy', 'false');

    dom.errorTitle.textContent = title || '这次没算成';
    dom.errorMessage.textContent = message || '发生了一个未知问题，请刷新页面后重试。';
    showScreen('error');
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });

    window.requestAnimationFrame(function () {
      dom.errorTitle.focus({ preventScroll: true });
    });
  }

  function showStartError(message) {
    dom.startError.textContent = message;
    dom.startError.hidden = false;
    dom.startHint.textContent = DEFAULT_SITE_HINT;
    dom.startBtn.disabled = false;
    dom.startBtn.textContent = START_LABEL;
  }

  function setStartBusy(isBusy) {
    dom.startBtn.disabled = isBusy;
    dom.startBtn.textContent = isBusy ? '正在请求麦克风权限…' : START_LABEL;
    dom.startHint.textContent = isBusy
      ? '请在浏览器提示中选择“允许”，音频只在本机处理。'
      : DEFAULT_SITE_HINT;

    if (isBusy) {
      dom.startError.hidden = true;
    }
  }

  function resetToStart() {
    clearRecordingTimers();
    stopMeter();
    releaseMediaResources();
    detachMediaRecorder();

    appState = 'idle';
    finalizeStarted = false;
    recorderFailureHandled = false;

    dom.recordLive.hidden = false;
    dom.analyzingPanel.hidden = true;
    dom.analyzingPanel.setAttribute('aria-busy', 'false');
    dom.analyzingBar.style.width = '4%';
    dom.analyzingDetail.textContent = '正在本地解码录音…';
    dom.recordStateText.textContent = '正在录音…';
    dom.countdownText.textContent = '10.0';
    if (dom.countdown) {
      dom.countdown.classList.remove('is-urgent');
    }
    dom.levelBar.style.width = '0%';
    dom.levelTrack.setAttribute('aria-valuenow', '0');
    dom.stopBtn.disabled = true;
    dom.stopBtn.textContent = STOP_LABEL;
    dom.recordHint.textContent = '最长 10 秒，倒计时结束会自动停止。';
    dom.retryBtn.disabled = false;
    dom.errorHomeBtn.disabled = false;

    setStartBusy(false);
    dom.startError.hidden = true;
    dom.startError.textContent = '';

    showScreen('start');
  }

  /* ==================== 通用工具 ==================== */

  function showScreen(screenName) {
    dom.screenStart.hidden = screenName !== 'start';
    dom.screenRecord.hidden = screenName !== 'record';
    dom.screenResult.hidden = screenName !== 'result';
    dom.screenError.hidden = screenName !== 'error';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function afterPaint() {
    return new Promise(function (resolve) {
      if (document.hidden || typeof window.requestAnimationFrame !== 'function') {
        window.setTimeout(resolve, 0);
        return;
      }
      window.requestAnimationFrame(function () {
        window.setTimeout(resolve, 0);
      });
    });
  }

  function yieldToMainThread() {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, 0);
    });
  }

  function formatSeconds(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    return safe.toFixed(2) + ' 秒';
  }

  function prefersReducedMotion() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
})();

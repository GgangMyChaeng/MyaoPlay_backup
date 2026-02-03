/**
 * settings_modal/modes.js
 * Mode Panel 초기화 (키워드/시간/SFX 모드)
 */



// 의존성 (부모 모듈에서 주입받음)
let _saveSettingsDebounced = () => {};
let _uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
let _abgmPrompt = async (_root, _title, _opts) => null;
let _abgmConfirm = async (_root, _msg) => false;

/**
 * 의존성 주입 함수
 */
export function bindModesPanelDeps(deps = {}) {
  if (typeof deps.saveSettingsDebounced === "function") {
    _saveSettingsDebounced = deps.saveSettingsDebounced;
  }
  if (typeof deps.uid === "function") {
    _uid = deps.uid;
  }
  if (typeof deps.abgmPrompt === "function") {
    _abgmPrompt = deps.abgmPrompt;
  }
  if (typeof deps.abgmConfirm === "function") {
    _abgmConfirm = deps.abgmConfirm;
  }
}

/**
 * Mode Panel 초기화 (메인)
 * @param {HTMLElement} root - 모달 루트 요소
 * @param {Object} settings - 설정 객체
 */
export function initModePanel(root, settings) {
  const modePanel = root.querySelector('#myaoplay-panel-mode');
  if (!modePanel) return;

  // ===== 모드 서브탭 전환 =====
  const modeSubtabs = modePanel.querySelectorAll('.abgm-mode-subtab');
  const modeSubpanels = modePanel.querySelectorAll('.abgm-mode-subpanel');
  
  function switchModeSubtab(tabId) {
    modeSubtabs.forEach(btn => {
      const isActive = btn.dataset.modeTab === tabId;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    modeSubpanels.forEach(panel => {
      const isActive = panel.dataset.modePanel === tabId;
      panel.classList.toggle('is-active', isActive);
      panel.style.display = isActive ? 'block' : 'none';
    });
  }
  
  modeSubtabs.forEach(btn => {
    btn.addEventListener('click', () => switchModeSubtab(btn.dataset.modeTab));
  });

  // ===== 키워드 서브모드 드롭다운 =====
  const kwSubmodeSel = modePanel.querySelector('#abgm_kw_submode');
  const descMatching = modePanel.querySelector('#abgm_kw_mode_desc_matching');
  const descToken = modePanel.querySelector('#abgm_kw_mode_desc_token');
  const descHybrid = modePanel.querySelector('#abgm_kw_mode_desc_hybrid');
  const promptSection = modePanel.querySelector('#abgm_kw_prompt_section');
  
  function updateKwSubmodeUI(mode) {
    if (descMatching) descMatching.style.display = mode === 'matching' ? 'block' : 'none';
    if (descToken) descToken.style.display = mode === 'token' ? 'block' : 'none';
    if (descHybrid) descHybrid.style.display = mode === 'hybrid' ? 'block' : 'none';
    // 추천 모드 설명
    const descRecommend = modePanel.querySelector('#abgm_kw_mode_desc_recommend');
    if (descRecommend) descRecommend.style.display = mode === 'recommend' ? 'block' : 'none';
    // 토큰/하이브리드일 때만 프롬프트 섹션 표시
    if (promptSection) promptSection.style.display = (mode === 'token' || mode === 'hybrid') ? 'block' : 'none';
    // 추천 모드일 때만 추천 섹션 표시
    const recommendSection = modePanel.querySelector('#abgm_kw_recommend_section');
    if (recommendSection) recommendSection.style.display = mode === 'recommend' ? 'block' : 'none';
    // 추천 모드일 때 공통 옵션(키워드 관련) 숨김
    const commonOptions = modePanel.querySelector('#abgm_kw_common_options');
    if (commonOptions) commonOptions.style.display = mode === 'recommend' ? 'none' : 'block';
  }
  
  // 초기값 설정
  if (kwSubmodeSel) {
    kwSubmodeSel.value = settings.keywordSubMode || 'matching';
    updateKwSubmodeUI(settings.keywordSubMode || 'matching');
    
    kwSubmodeSel.addEventListener('change', (e) => {
      settings.keywordSubMode = e.target.value;
      updateKwSubmodeUI(e.target.value);
      _saveSettingsDebounced();
    });
  }

  // ===== 추천 모드 설정 =====
  const recProviderSel = modePanel.querySelector('#abgm_rec_provider');
  const recCooldownSel = modePanel.querySelector('#abgm_rec_cooldown');
  const recStopOnEnterChk = modePanel.querySelector('#abgm_rec_stop_on_enter');

  // 초기값 로드
  settings.recommendMode ??= {};
  if (recProviderSel) recProviderSel.value = settings.recommendMode.provider || 'spotify';
  if (recCooldownSel) recCooldownSel.value = String(settings.recommendMode.cooldownSec || 60);
  if (recStopOnEnterChk) recStopOnEnterChk.checked = settings.recommendMode.stopOnEnter !== false;

  recProviderSel?.addEventListener('change', (e) => {
    settings.recommendMode.provider = e.target.value;
    _saveSettingsDebounced();
  });
  recCooldownSel?.addEventListener('change', (e) => {
    settings.recommendMode.cooldownSec = parseInt(e.target.value, 10) || 60;
    _saveSettingsDebounced();
  });
  recStopOnEnterChk?.addEventListener('change', (e) => {
    settings.recommendMode.stopOnEnter = !!e.target.checked;
    _saveSettingsDebounced();
  });

  // ===== 프롬프트 프리셋 관리 =====
  const promptPresetSel = modePanel.querySelector('#abgm_kw_prompt_preset');
  const promptContent = modePanel.querySelector('#abgm_kw_prompt_content');
  const promptAddBtn = modePanel.querySelector('#abgm_kw_prompt_add');
  const promptDelBtn = modePanel.querySelector('#abgm_kw_prompt_del');
  const promptRenameBtn = modePanel.querySelector('#abgm_kw_prompt_rename');

  // ===== 추천 프롬프트 프리셋 관리 =====
  const recPromptPresetSel = modePanel.querySelector('#abgm_rec_prompt_preset');
  const recPromptContent = modePanel.querySelector('#abgm_rec_prompt_content');
  const recPromptAddBtn = modePanel.querySelector('#abgm_rec_prompt_add');
  const recPromptDelBtn = modePanel.querySelector('#abgm_rec_prompt_del');
  const recPromptRenameBtn = modePanel.querySelector('#abgm_rec_prompt_rename');

  function renderRecPromptPresetSelect() {
    if (!recPromptPresetSel) return;
    recPromptPresetSel.innerHTML = '';
    const presets = settings.recPromptPresets || {};
    const list = Object.values(presets);
    const sorted = list.sort((a, b) => {
      if (a.id === "default") return -1;
      if (b.id === "default") return 1;
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });
    sorted.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      if (p.id === settings.activeRecPromptPresetId) opt.selected = true;
      recPromptPresetSel.appendChild(opt);
    });
  }

  function loadActiveRecPromptContent() {
    if (!recPromptContent) return;
    const activePreset = settings.recPromptPresets?.[settings.activeRecPromptPresetId];
    recPromptContent.value = activePreset?.content || '';
  }

  renderRecPromptPresetSelect();
  loadActiveRecPromptContent();

  recPromptPresetSel?.addEventListener('change', (e) => {
    settings.activeRecPromptPresetId = e.target.value;
    loadActiveRecPromptContent();
    _saveSettingsDebounced();
  });

  recPromptContent?.addEventListener('input', () => {
    const activePreset = settings.recPromptPresets?.[settings.activeRecPromptPresetId];
    if (activePreset) {
      activePreset.content = recPromptContent.value;
      _saveSettingsDebounced();
    }
  });

  // 프롬프트 프리셋 추가
  recPromptAddBtn?.addEventListener('click', async () => {
    const name = await _abgmPrompt(root, '새 추천 프롬프트 프리셋 이름', {
      title: 'Recommend Prompt Preset',
      initialValue: 'New Prompt',
      placeholder: 'Preset name...',
    });
    if (!name || !name.trim()) return;
    const newId = _uid();
    settings.recPromptPresets ??= {};
    settings.recPromptPresets[newId] = {
      id: newId,
      name: name.trim(),
      content: ''
    };
    settings.activeRecPromptPresetId = newId;
    _saveSettingsDebounced();
    renderRecPromptPresetSelect();
    loadActiveRecPromptContent();
  });

  // 프롬프트 프리셋 삭제
  recPromptDelBtn?.addEventListener('click', async () => {
    const presets = settings.recPromptPresets || {};
    if (Object.keys(presets).length <= 1) {
      alert('마지막 프리셋은 삭제할 수 없습니다.');
      return;
    }
    const activePreset = presets[settings.activeRecPromptPresetId];
    const ok = await _abgmConfirm(root, '"' + (activePreset?.name || settings.activeRecPromptPresetId) + '" 프리셋을 삭제할까요?');
    if (!ok) return;
    delete presets[settings.activeRecPromptPresetId];
    settings.activeRecPromptPresetId = Object.keys(presets)[0];
    _saveSettingsDebounced();
    renderRecPromptPresetSelect();
    loadActiveRecPromptContent();
  });

  // 프롬프트 프리셋 이름 변경
  recPromptRenameBtn?.addEventListener('click', async () => {
    const activePreset = settings.recPromptPresets?.[settings.activeRecPromptPresetId];
    if (!activePreset) return;
    const newName = await _abgmPrompt(root, '프리셋 이름 변경', {
      title: 'Rename Prompt Preset',
      initialValue: activePreset.name || '',
      placeholder: 'Preset name...',
    });
    if (!newName || !newName.trim()) return;
    activePreset.name = newName.trim();
    _saveSettingsDebounced();
    renderRecPromptPresetSelect();
  });
  
  function renderPromptPresetSelect() {
    if (!promptPresetSel) return;
    promptPresetSel.innerHTML = '';
    const presets = settings.kwPromptPresets || {};
    const list = Object.values(presets);
    const sorted = list.sort((a, b) => {
      if (a.id === "default") return -1;
      if (b.id === "default") return 1;
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });
    sorted.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      if (p.id === settings.activeKwPromptPresetId) opt.selected = true;
      promptPresetSel.appendChild(opt);
    });
  }

  
  function loadActivePromptContent() {
    if (!promptContent) return;
    const activePreset = settings.kwPromptPresets?.[settings.activeKwPromptPresetId];
    promptContent.value = activePreset?.content || '';
  }
  
  renderPromptPresetSelect();
  loadActivePromptContent();
  promptPresetSel?.addEventListener('change', (e) => {
    settings.activeKwPromptPresetId = e.target.value;
    loadActivePromptContent();
    _saveSettingsDebounced();
  });
  // 프롬프트 내용 변경
  promptContent?.addEventListener('input', () => {
    const activePreset = settings.kwPromptPresets?.[settings.activeKwPromptPresetId];
    if (activePreset) {
      activePreset.content = promptContent.value;
      _saveSettingsDebounced();
    }
  });
  // 프롬프트 프리셋 추가
  promptAddBtn?.addEventListener('click', async () => {
    const name = await _abgmPrompt(root, '새 프롬프트 프리셋 이름', {
      title: 'Prompt Preset',
      initialValue: 'New Prompt',
      placeholder: 'Preset name...',
    });
    if (!name || !name.trim()) return;
    const newId = _uid();
    settings.kwPromptPresets ??= {};
    settings.kwPromptPresets[newId] = {
      id: newId,
      name: name.trim(),
      content: ''
    };
    settings.activeKwPromptPresetId = newId;
    _saveSettingsDebounced();
    renderPromptPresetSelect();
    loadActivePromptContent();
  });
  // 프롬프트 프리셋 삭제
  promptDelBtn?.addEventListener('click', async () => {
    const presets = settings.kwPromptPresets || {};
    if (Object.keys(presets).length <= 1) {
      alert('마지막 프리셋은 삭제할 수 없습니다.');
      return;
    }
    const activePreset = presets[settings.activeKwPromptPresetId];
    const ok = await _abgmConfirm(root, '"' + (activePreset?.name || settings.activeKwPromptPresetId) + '" 프리셋을 삭제할까요?');
    if (!ok) return;
    delete presets[settings.activeKwPromptPresetId];
    settings.activeKwPromptPresetId = Object.keys(presets)[0];
    _saveSettingsDebounced();
    renderPromptPresetSelect();
    loadActivePromptContent();
  });
  // 프롬프트 프리셋 이름 변경
  promptRenameBtn?.addEventListener('click', async () => {
    const activePreset = settings.kwPromptPresets?.[settings.activeKwPromptPresetId];
    if (!activePreset) return;
    const newName = await _abgmPrompt(root, '프리셋 이름 변경', {
      title: 'Rename Prompt Preset',
      initialValue: activePreset.name || '',
      placeholder: 'Preset name...',
    });
    if (!newName || !newName.trim()) return;
    activePreset.name = newName.trim();
    _saveSettingsDebounced();
    renderPromptPresetSelect();
  });
  // ===== 공통 옵션 (키워드 모드 on/off 등) =====
  const kwEnabledChk = modePanel.querySelector('#abgm_mode_kw_enabled');
  const kwOnceChk = modePanel.querySelector('#abgm_mode_kw_once');
  const useDefaultChk = modePanel.querySelector('#abgm_mode_use_default');
  // 초기값
  if (kwEnabledChk) kwEnabledChk.checked = !!settings.keywordMode;
  if (kwOnceChk) kwOnceChk.checked = !!settings.keywordOnce;
  if (useDefaultChk) useDefaultChk.checked = !!settings.useDefault;
  kwEnabledChk?.addEventListener('change', (e) => {
    settings.keywordMode = !!e.target.checked;
    _saveSettingsDebounced();
    // 메인 탭의 체크박스도 동기화
    const mainKw = root.querySelector('#abgm_keywordMode');
    if (mainKw) mainKw.checked = settings.keywordMode;
  });
  kwOnceChk?.addEventListener('change', (e) => {
    settings.keywordOnce = !!e.target.checked;
    _saveSettingsDebounced();
  });
  useDefaultChk?.addEventListener('change', (e) => {
    settings.useDefault = !!e.target.checked;
    _saveSettingsDebounced();
    // 메인 탭의 체크박스도 동기화
    const mainUseDef = root.querySelector('#abgm_useDefault');
    if (mainUseDef) mainUseDef.checked = settings.useDefault;
  });
  // > Time Mode Panel 초기화
  initTimePanel(root, settings);
  // > SFX Mode Panel 초기화
  initSfxPanel(root, settings);
} // initModePanel 닫기



/** ========================= Time Mode Panel 초기화 ========================= */
function initTimePanel(root, settings) {
  const timePanel = root.querySelector('#abgm-mode-time');
  if (!timePanel) return;
  const tm = settings.timeMode || {};
  // === 요소 참조 ===
  const enabledChk = timePanel.querySelector('#abgm_time_enabled');
  const sourceToken = timePanel.querySelector('#abgm_time_source_token');
  const sourceRealtime = timePanel.querySelector('#abgm_time_source_realtime');
  const schemeDay4 = timePanel.querySelector('#abgm_time_scheme_day4');
  const schemeAmpm2 = timePanel.querySelector('#abgm_time_scheme_ampm2');
  const day4Slots = timePanel.querySelector('#abgm_time_day4_slots');
  const ampm2Slots = timePanel.querySelector('#abgm_time_ampm2_slots');
  // === UI 업데이트 함수 ===
  function updateTimePanelUI() {
    const enabled = !!tm.enabled;
    timePanel.dataset.disabled = enabled ? "false" : "true";
    
    if (day4Slots) day4Slots.style.display = tm.scheme === 'day4' ? 'block' : 'none';
    if (ampm2Slots) ampm2Slots.style.display = tm.scheme === 'ampm2' ? 'block' : 'none';
  }
  // === 슬롯 데이터 로드 ===
  function loadSlotData(slotsContainer, dataArr) {
    if (!slotsContainer || !Array.isArray(dataArr)) return;
    const slots = slotsContainer.querySelectorAll('.abgm-time-slot');
    slots.forEach((slot, i) => {
      const data = dataArr[i];
      if (!data) return;
      const kwInput = slot.querySelector('.abgm-time-kw');
      const startInput = slot.querySelector('.abgm-time-start');
      const endInput = slot.querySelector('.abgm-time-end');
      if (kwInput) kwInput.value = data.keywords || '';
      if (startInput) startInput.value = data.start || '';
      if (endInput) endInput.value = data.end || '';
    });
  }
  // === 슬롯 데이터 저장 ===
  function saveSlotData(slotsContainer, dataArr) {
    if (!slotsContainer || !Array.isArray(dataArr)) return;
    const slots = slotsContainer.querySelectorAll('.abgm-time-slot');
    slots.forEach((slot, i) => {
      if (!dataArr[i]) return;
      const kwInput = slot.querySelector('.abgm-time-kw');
      const startInput = slot.querySelector('.abgm-time-start');
      const endInput = slot.querySelector('.abgm-time-end');
      if (kwInput) dataArr[i].keywords = kwInput.value.trim();
      if (startInput) dataArr[i].start = startInput.value || '';
      if (endInput) dataArr[i].end = endInput.value || '';
    });
  }
  // === 초기값 세팅 ===
  if (enabledChk) enabledChk.checked = !!tm.enabled;
  if (sourceToken) sourceToken.checked = tm.source === 'token';
  if (sourceRealtime) sourceRealtime.checked = tm.source === 'realtime';
  if (schemeDay4) schemeDay4.checked = tm.scheme === 'day4';
  if (schemeAmpm2) schemeAmpm2.checked = tm.scheme === 'ampm2';
  loadSlotData(day4Slots, tm.day4);
  loadSlotData(ampm2Slots, tm.ampm2);
  updateTimePanelUI();
  // === 이벤트 바인딩 ===
  enabledChk?.addEventListener('change', (e) => {
    tm.enabled = !!e.target.checked;
    updateTimePanelUI();
    _saveSettingsDebounced();
  });
  sourceToken?.addEventListener('change', () => {
    if (sourceToken.checked) {
      tm.source = 'token';
      _saveSettingsDebounced();
    }
  });
  sourceRealtime?.addEventListener('change', () => {
    if (sourceRealtime.checked) {
      tm.source = 'realtime';
      _saveSettingsDebounced();
    }
  });
  schemeDay4?.addEventListener('change', () => {
    if (schemeDay4.checked) {
      tm.scheme = 'day4';
      updateTimePanelUI();
      _saveSettingsDebounced();
    }
  });
  schemeAmpm2?.addEventListener('change', () => {
    if (schemeAmpm2.checked) {
      tm.scheme = 'ampm2';
      updateTimePanelUI();
      _saveSettingsDebounced();
    }
  });
  day4Slots?.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      saveSlotData(day4Slots, tm.day4);
      _saveSettingsDebounced();
    });
  });
  ampm2Slots?.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      saveSlotData(ampm2Slots, tm.ampm2);
      _saveSettingsDebounced();
    });
  });
} // initTimePanel 닫기



/** ========================= SFX Mode Panel 초기화 ========================= */
function initSfxPanel(root, settings) {
  const sfxPanel = root.querySelector('#abgm-mode-sfx');
  if (!sfxPanel) return;
  // sfxMode 보정 (혹시 없으면 여기서도 기본값 세팅)
  settings.sfxMode ??= {};
  settings.sfxMode.overlay ??= true;
  settings.sfxMode.skipInOtherModes ??= true;
  const sfx = settings.sfxMode;
  // === 요소 참조 ===
  const overlayChk = sfxPanel.querySelector('#abgm_sfx_overlay');
  const skipOtherChk = sfxPanel.querySelector('#abgm_sfx_skip_other');
  // === 초기값 세팅 ===
  if (overlayChk) overlayChk.checked = !!sfx.overlay;
  if (skipOtherChk) skipOtherChk.checked = !!sfx.skipInOtherModes;
  // === 이벤트 바인딩 ===
  overlayChk?.addEventListener('change', (e) => {
    settings.sfxMode.overlay = !!e.target.checked;
    _saveSettingsDebounced();
  });
  skipOtherChk?.addEventListener('change', (e) => {
    settings.sfxMode.skipInOtherModes = !!e.target.checked;
    _saveSettingsDebounced();
  });
} // initSfxPanel 닫기

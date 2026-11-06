// Layer: 08 styles — depends on: 00-platform (`addCss`).
// Base panel CSS registered once by the entry's stylesheet join.

// ---- styles ---------------------------------------------------------------

addCss(`
  /* Self-contained box model: the panel lives in a narrower pane than the
     window, so padding must stay inside the width like the host does. */
  .nce-root, .nce-root *, .nce-root *::before, .nce-root *::after { box-sizing: border-box; }
  .nce-root {
    container-type: inline-size;
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    background: var(--dsw-alias-bg-base, #fff);
    color: var(--dsw-alias-label-primary, #1f2328);
    font: inherit; font-size: 13px; line-height: 1.6;
    overflow: hidden;
    /* Reading faces: the lesson page uses a high-legibility UI sans for English,
       worksheets/cards keep a sturdier screen serif. Both have IPA coverage. */
    --nce-font-reading: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif;
    --nce-font-english: "Iowan Old Style", "Charter", "Georgia", "Times New Roman", serif;
    --nce-font-mono: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  .nce-subnav {
    flex: none; display: flex; align-items: center; gap: 4px; padding: 6px 20px 0;
    border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
    background: var(--dsw-alias-bg-base, #fff);
  }
  .nce-subnav-brand {
    display: flex; align-items: center; gap: 8px;
    margin-right: 20px; min-width: 0;
  }
  .nce-subnav-title { font-size: 15px; font-weight: 700; letter-spacing: .01em; line-height: 1.2; }
  .nce-subnav-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); white-space: nowrap; line-height: 1.2; }
  .nce-subnav-tab {
    position: relative; display: inline-flex; align-items: center; gap: 6px;
    flex: none; white-space: nowrap; height: 38px; padding: 0 14px; margin-bottom: -1px;
    border: 0; border-bottom: 2px solid transparent; background: transparent;
    color: var(--dsw-alias-label-secondary, #8a8f98); font: inherit; font-size: 13.5px;
    cursor: pointer; border-radius: 7px 7px 0 0;
  }
  .nce-subnav-tab:hover { color: var(--dsw-alias-label-primary, #1f2328); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); }
  .nce-subnav-tab.is-active { color: var(--dsw-alias-label-primary, #1f2328); border-bottom-color: var(--dsw-alias-brand-primary, #4c8dff); font-weight: 600; }
  .nce-subnav-tab .nce-icon { opacity: .9; }
  .nce-subnav-tab-count {
    min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 9.5px; font-weight: 700; font-variant-numeric: tabular-nums;
    color: var(--dsw-alias-brand-primary, #4c8dff);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 12%, transparent);
  }
  .nce-subnav-tab.is-active .nce-icon { opacity: 1; }
  .nce-subnav-spacer { margin-left: auto; }
  .nce-scroll { flex: 1; min-height: 0; overflow: auto; }
  .nce-scroll-locked { overflow: hidden; }
  .nce-wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: 20px 24px 56px; }
  .nce-page-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .nce-page-title { margin: 0; font-size: 19px; font-weight: 680; letter-spacing: .01em; }
  .nce-page-sub { margin: 3px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-page-head-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }

  /* buttons */
  .nce-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    border: 1px solid transparent; border-radius: 8px; font: inherit; font-size: 12.5px;
    cursor: pointer; white-space: nowrap; user-select: none;
    transition: background .14s ease, border-color .14s ease, color .14s ease, opacity .14s ease;
  }
  .nce-btn:disabled { opacity: .45; cursor: not-allowed; }
  .nce-btn.is-icon { padding: 0; width: 30px; height: 30px; }
  .nce-btn-md { height: 30px; padding: 0 12px; }
  .nce-btn-sm { height: 26px; padding: 0 9px; font-size: 12px; border-radius: 7px; }
  .nce-btn-sm.is-icon { width: 26px; height: 26px; }
  .nce-btn-lg { height: 36px; padding: 0 16px; font-size: 13px; border-radius: 9px; }
  .nce-btn-primary { background: var(--dsw-alias-brand-primary, #4c8dff); color: var(--dsw-alias-bg-base, #fff); }
  .nce-btn-primary:hover { filter: brightness(1.06); }
  .nce-btn-soft { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); color: var(--dsw-alias-label-primary, #1f2328); }
  .nce-btn-soft:hover { background: var(--dsw-alias-bg-overlay, rgba(127,127,127,.18)); }
  .nce-btn-ghost { background: transparent; border-color: var(--dsw-alias-border-l1, rgba(127,127,127,.28)); color: var(--dsw-alias-label-primary, #1f2328); }
  .nce-btn-ghost:hover { border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.45)); }
  .nce-btn-quiet { background: transparent; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-btn-quiet:hover, .nce-btn-quiet.is-active { color: var(--dsw-alias-brand-primary, #4c8dff); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); }
  .nce-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff); outline-offset: 1px; }

  .nce-chip {
    display: inline-flex; align-items: center; gap: 5px; height: 27px; padding: 0 11px;
    border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.26));
    background: transparent; color: var(--dsw-alias-label-secondary, #8a8f98);
    font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
    transition: background .14s ease, border-color .14s ease, color .14s ease;
  }
  .nce-chip:hover { color: var(--dsw-alias-label-primary, #1f2328); border-color: var(--dsw-alias-border-l2, rgba(127,127,127,.45)); }
  .nce-chip.is-active { color: var(--dsw-alias-brand-primary, #4c8dff); border-color: var(--dsw-alias-brand-primary, #4c8dff); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 9%, transparent); }
  .nce-chip-count { font-size: 10.5px; opacity: .75; }

  /* cards / sections */
  .nce-card {
    background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04));
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18));
    border-radius: 12px;
  }
  .nce-section { margin-top: 22px; }
  .nce-section:first-child { margin-top: 0; }
  .nce-section-head { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 10px; }
  .nce-section-title { margin: 0; font-size: 14px; font-weight: 650; }
  .nce-section-hint { margin: 2px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-section-extra { margin-left: auto; display: flex; align-items: center; gap: 8px; }

  .nce-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 42px 18px; }
  .nce-empty-icon { color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .55; }
  .nce-empty-title { font-size: 13px; font-weight: 600; }
  .nce-empty-text { margin: 0; max-width: 340px; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); line-height: 1.7; }
  .nce-empty-action { margin-top: 6px; }

  .nce-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 40px 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-spinner {
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4));
    border-top-color: var(--dsw-alias-brand-primary, #4c8dff);
    animation: nce-spin .8s linear infinite;
  }
  @keyframes nce-spin { to { transform: rotate(360deg); } }
  .nce-errorbox {
    display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; margin: 12px 0;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #d9534f) 35%, transparent);
    border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d9534f) 7%, transparent);
  }
  .nce-errorbox-icon { color: var(--dsw-alias-state-error-primary, #d9534f); flex: none; margin-top: 1px; }
  .nce-errorbox-body { flex: 1; min-width: 0; }
  .nce-errorbox-title { font-size: 12.5px; font-weight: 600; }
  .nce-errorbox-text { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8f98); word-break: break-word; }

  .nce-tabs { display: flex; align-items: center; gap: 2px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18)); }
  .nce-tabs-item {
    position: relative; display: inline-flex; align-items: center; gap: 6px;
    height: 34px; padding: 0 13px; margin-bottom: -1px;
    border: 0; border-bottom: 2px solid transparent; border-radius: 7px 7px 0 0;
    background: transparent; color: var(--dsw-alias-label-secondary, #8a8f98);
    font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap;
  }
  .nce-tabs-item:hover { color: var(--dsw-alias-label-primary, #1f2328); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); }
  .nce-tabs-item.is-active { color: var(--dsw-alias-label-primary, #1f2328); border-bottom-color: var(--dsw-alias-brand-primary, #4c8dff); font-weight: 600; }
  .nce-tabs-count {
    min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10.5px; font-weight: 500; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }

  .nce-stat { display: flex; flex-direction: column; gap: 1px; }
  .nce-stat-value { font-size: 21px; font-weight: 680; line-height: 1.25; letter-spacing: .01em; }
  .nce-stat-unit { margin-left: 2px; font-size: 11.5px; font-weight: 500; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-stat-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-stat-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #8a8f98); opacity: .8; }

  .nce-bar { height: 6px; border-radius: 999px; overflow: hidden; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.16)); }
  .nce-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-brand-primary, #4c8dff); transition: width .25s ease; }

  .nce-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .nce-ring-label { position: absolute; font-size: 13px; font-weight: 650; }

  .nce-badge {
    display: inline-flex; align-items: center; height: 18px; padding: 0 7px;
    border-radius: 999px; font-size: 10.5px; font-weight: 500; white-space: nowrap;
    background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.14));
    color: var(--dsw-alias-label-secondary, #8a8f98);
  }
  .nce-badge-brand { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 12%, transparent); color: var(--dsw-alias-brand-primary, #4c8dff); }
  .nce-badge-success { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e9e5b) 13%, transparent); color: var(--dsw-alias-state-success-primary, #2e9e5b); }
  .nce-badge-warn { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d9a13b) 14%, transparent); color: var(--dsw-alias-state-warn-primary, #d9a13b); }

  .nce-divider { height: 1px; background: var(--dsw-alias-border-l1, rgba(127,127,127,.16)); margin: 14px 0; }

  .nce-icon { flex: none; display: block; }
  .nce-muted { color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-mono { font-family: var(--nce-font-mono); }
  .nce-en { font-family: var(--nce-font-english); }

  .nce-voice { position: relative; display: flex; align-items: center; }
  .nce-voice-pop {
    position: absolute; right: 0; top: calc(100% + 8px); z-index: 45;
    width: 264px; padding: 12px;
    background: var(--dsw-alias-bg-overlay, #fff);
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22));
    border-radius: 12px; box-shadow: 0 14px 38px rgba(0,0,0,.22);
  }
  .nce-voice-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    margin-bottom: 8px; font-size: 12px; font-weight: 600;
  }
  .nce-voice-engine { font-size: 10.5px; font-weight: 500; color: var(--dsw-alias-label-secondary, #8a8f98); }
  .nce-voice-select {
    width: 100%; height: 30px; padding: 0 8px;
    border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28));
    border-radius: 8px; outline: 0;
    background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #1f2328);
    font: inherit; font-size: 12px;
  }
  .nce-voice-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .nce-voice-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 11px; }
  .nce-voice-note { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8a8f98); }

  @media (max-width: 720px) {
    .nce-wrap { padding: 14px 14px 48px; }
    .nce-subnav { padding-left: 12px; padding-right: 12px; }
    .nce-subnav-sub { display: none; }
  }
  /* The panel is often narrower than the window: give the (now longer) nav labels room. */
  @container (max-width: 700px) {
    .nce-subnav { padding: 6px 12px 0; }
    .nce-subnav-sub { display: none; }
    .nce-subnav-tab { padding: 0 10px; font-size: 13px; }
    .nce-subnav-brand { margin-right: 10px; }
  }
  /* Four tabs + the voice menu need a little more room than a very narrow panel:
     let the nav strip scroll horizontally instead of clipping the last tab. */
  @container (max-width: 640px) {
    .nce-subnav { overflow-x: auto; scrollbar-width: none; }
    .nce-subnav::-webkit-scrollbar { display: none; }
    .nce-subnav-spacer { margin-left: 8px; }
  }
`)

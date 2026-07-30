import Anthropic from '@anthropic-ai/sdk';
import { getStore } from '@netlify/blobs';
import { getVerifiedUser } from '../lib/auth.mjs';

// Bound abuse of the (paid) Anthropic call.
const MAX_PDF_B64_CHARS = 15 * 1024 * 1024; // ~11MB decoded — client caps files at 10MB
const RATE_LIMIT_MAX    = 20;               // generations per user per window
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;   // 1 hour

// ---------------------------------------------------------------------------
// Inline skill assets -- these are inlined into every generated form so the
// output is a single self-contained HTML file with no external dependencies
// (other than the Tailwind CDN and Google Fonts for Inter).
// ---------------------------------------------------------------------------

const TAILWIND_CONFIG = `
tailwind.config = {
  theme: {
    extend: {
      colors: {
        'bb-black-00':    '#000000',
        'bb-mid-grey-00': '#595959',
        'bb-grey-00':     '#e0e4e9',
        'bb-white-00':    '#ffffff',
        'bb-red-00':      '#a42c2c',
        'bb-red-10':      '#fff0f0',
        'bb-green-00':    '#00654a',
        'bb-green-10':    '#e9f9f3',
      },
      spacing: {
        'xs': '0.5rem', 's': '1rem', 'xm': '1.5rem',
        'm':  '2rem',   'l': '4rem', 'xl': '8rem',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { 'sm': '0.25rem', 'md': '0.375rem', 'lg': '0.5rem' },
    },
  },
};
`;

const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; }
:root {
  --color-black-00:    #000;
  --color-mid-grey-00: #595959;
  --color-grey-00:     #e0e4e9;
  --color-white-00:    #fff;
  --color-red-00:      #a42c2c;
  --color-red-10:      #fff0f0;
  --color-green-00:    #00654a;
  --color-green-10:    #e9f9f3;
  --font-size-h1:      3.5rem;
  --font-size-h2:      2.5rem;
  --font-size-h3:      1.5rem;
  --font-size-body:    1.25rem;
  --font-size-caption: 1rem;
  --spacing-xs: 0.5rem; --spacing-s: 1rem; --spacing-xm: 1.5rem;
  --spacing-m:  2rem;   --spacing-l: 4rem; --spacing-xl: 8rem;
  --radius-sm: 0.25rem; --radius-md: 0.375rem; --radius-lg: 0.5rem;
}
body {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 1.25rem; line-height: 1.5; margin: 0;
  display: grid; min-height: 100vh;
  grid-template-rows: auto auto 1fr auto;
  background: #fff; color: #000;
}
.container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
.sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0; }
.error-summary { border:3px solid #a42c2c;padding:1rem 1.5rem;margin-bottom:2rem;background:#fff0f0; }
.error-summary h2 { color:#a42c2c;font-size:1.25rem;font-weight:700;margin:0 0 0.5rem; }
.error-summary ul { margin:0;padding-left:1.25rem; }
.error-summary li a { color:#a42c2c;font-weight:600; }
.field-error { color:#a42c2c;font-weight:600;font-size:1rem;margin-bottom:0.25rem;display:block; }
.summary-row { display:grid;grid-template-columns:1fr 1fr auto;gap:1rem;padding:1rem 0;border-bottom:1px solid #e0e4e9;align-items:start; }
.summary-row:first-child { border-top:1px solid #e0e4e9; }
.summary-row dt { font-weight:600; }
.summary-row dd { margin:0;word-break:break-word; }
.confirmation-panel { border:2px solid #000;padding:2rem;margin-bottom:2rem; }
`;

// The framework JS is large -- load it from the skill assets at deploy time.
// For portability we inline a trimmed version here. The full version is in
// /assets/govbb-framework.js in the skill folder and should be used when
// building via Claude Code with the skill available.
// This stub is replaced at build time if the full asset is present.
const FRAMEWORK_STUB = `/* Public Service Generator -- form framework.
   Note: the internal API object is named GovBB for continuity with the build spec;
   it is invisible plumbing in the inlined script and carries no visible branding. */
(function (global) {
  'use strict';

  var GovBB = {};

  /* ── Data store ── */
  GovBB.D = {};

  /* ── Parishes ── */
  GovBB.PARISHES = [
    'Christ Church', 'St. Andrew', 'St. George', 'St. James',
    'St. John', 'St. Joseph', 'St. Lucy', 'St. Michael',
    'St. Peter', 'St. Philip', 'St. Thomas'
  ];

  /* ── Internal state ── */
  var _formName  = '';
  var _flow      = [];
  var _pages     = {};
  var _current   = 0;
  var _validate  = function () { return []; };
  var _getFlow   = null;
  var _appEl     = 'app';
  var _onRadio   = null;

  /* ── CSS class constants ── */
  GovBB.BTN_CLS = 'relative inline-flex items-center justify-center gap-2 text-[20px] whitespace-nowrap transition-[background-color,box-shadow] duration-200 outline-none bg-bb-black-00 text-bb-white-00 hover:bg-[#222222] active:bg-[#444444] px-xm py-s rounded-sm leading-[1.7] border-2 border-bb-black-00 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-bb-black-00';
  GovBB.LINK_CLS = 'inline-flex outline-none underline-offset-2 underline hover:no-underline text-bb-black-00 hover:bg-[#f0f0f0] focus-visible:bg-[#f0f0f0]';
  GovBB.INPUT_WRAP_CLS = 'relative inline-flex w-full rounded-sm border-2 border-bb-black-00 items-center gap-2 transition-all bg-bb-white-00 hover:shadow-form-hover focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bb-black-00';
  GovBB.INPUT_CLS = 'w-full min-w-0 p-s outline-none rounded-[inherit] placeholder:text-bb-black-00/60';

  /* ── Init ── */
  GovBB.init = function (cfg) {
    _formName = cfg.formName || '';
    _flow     = (cfg.flow || []).slice();
    _pages    = cfg.pages || {};
    _validate = cfg.validate || function () { return []; };
    _getFlow  = cfg.getFlow || null;
    _appEl    = cfg.appElementId || 'app';
    _onRadio  = cfg.onRadioChange || null;
    _current  = 0;
    GovBB.render();
  };

  /* ── Navigation ── */
  GovBB.render = function () {
    var flow = _getFlow ? _getFlow() : _flow;
    var pageId = flow[_current];
    var el = document.getElementById(_appEl);
    if (!el) return;
    var fn = _pages[pageId];
    if (!fn) { el.innerHTML = '<p>Page not found: ' + pageId + '</p>'; return; }
    el.innerHTML = fn();
    _injectProgressIndicator(pageId, flow);
    /* Previous button is shown on every form step (including the first) so
       users can navigate back to the start page if they want to re-read the
       intro or eligibility. */
    _bindInputs();
    _bindRadios();
    _bindCheckboxes();
    _initSignaturePads();
    window.scrollTo(0, 0);
  };

  /* Pages that are not counted as form steps for the progress indicator. */
  var _NON_FORM_PAGES = ['start', 'confirmation'];

  function _isFormStep(pageId) {
    return _NON_FORM_PAGES.indexOf(pageId) === -1;
  }

  function _formStepInfo(pageId, flow) {
    var stepFlow = flow.filter(_isFormStep);
    var idx = stepFlow.indexOf(pageId);
    if (idx === -1) return null;
    return { current: idx + 1, total: stepFlow.length };
  }

  function _injectProgressIndicator(pageId, flow) {
    var info = _formStepInfo(pageId, flow);
    if (!info) return;
    var el = document.getElementById(_appEl);
    if (!el) return;
    /* Don't double-inject if the page already declares a progress indicator. */
    if (el.querySelector('[data-progress-indicator]')) return;
    var html =
      '<p data-progress-indicator class="govbb-text-caption" ' +
      'style="color:var(--color-mid-grey-00);font-size:var(--font-size-caption);margin-bottom:var(--spacing-s);">' +
      'Step ' + info.current + ' of ' + info.total +
      '</p>';
    el.insertAdjacentHTML('afterbegin', html);
  }

  function _hidePreviousOnFirstStep(pageId, flow) {
    var info = _formStepInfo(pageId, flow);
    if (!info || info.current !== 1) return;
    var el = document.getElementById(_appEl);
    if (!el) return;
    var prevBtn = el.querySelector('.govbb-btn--secondary[onclick*="back()"]');
    if (prevBtn) prevBtn.style.display = 'none';
  }

  /**
   * Focus the form field associated with an error-summary link.
   * Called from showErrors anchors. Handles inputs, selects, textareas,
   * radio groups (focuses the first radio sharing the name), and falls
   * back to scrolling the element into view.
   */
  GovBB.focusError = function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    if (typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
  };

  GovBB.getFlow = function () {
    return (_getFlow ? _getFlow() : _flow).slice();
  };

  GovBB.getCurrentIndex = function () {
    return _current;
  };

  GovBB.nav = function (pageId) {
    var flow = _getFlow ? _getFlow() : _flow;
    var idx = flow.indexOf(pageId);
    if (idx !== -1) { _current = idx; GovBB.render(); }
  };

  GovBB.next = function () {
    var errors = _validate(_currentPageId());
    if (errors && errors.length) { GovBB.showErrors(errors); return; }
    GovBB.clearErrors();
    var flow = _getFlow ? _getFlow() : _flow;
    var nextIdx = _current + 1;
    if (nextIdx >= flow.length) return;
    var nextPage = flow[nextIdx];
    if (nextPage === 'confirmation') {
      _submitForm(function () { _current = nextIdx; GovBB.render(); });
    } else {
      _current = nextIdx;
      GovBB.render();
    }
  };

  GovBB.back = function () {
    if (_current > 0) { _current--; GovBB.render(); }
  };

  function _currentPageId() {
    var flow = _getFlow ? _getFlow() : _flow;
    return flow[_current];
  }

  /* ── Form submission ── */
  function _submitForm(cb) {
    var email = GovBB.D['contact-email'] || GovBB.D['email'] || '';
    var payload = { formName: _formName, formData: GovBB.D, userEmail: email };
    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.referenceNumber) window.__refNumber = data.referenceNumber;
      cb();
    })
    .catch(function () {
      window.__refNumber = _genRef();
      cb();
    });
  }

  function _genRef() {
    return 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /* ── Input auto-binding ── */
  function _bindInputs() {
    var inputs = document.querySelectorAll('[data-field]');
    inputs.forEach(function (el) {
      var field = el.getAttribute('data-field');
      // Restore saved value
      if (GovBB.D[field] !== undefined) {
        if (el.type === 'checkbox') el.checked = !!GovBB.D[field];
        // For radios, restore which option is selected — do NOT overwrite the
        // radio's own value (that would clobber every option to the stored
        // value and make the group unchangeable).
        else if (el.type === 'radio') el.checked = (GovBB.D[field] === el.value);
        else el.value = GovBB.D[field];
      }
      var ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio') ? 'change' : 'input';
      el.addEventListener(ev, function () {
        if (el.type === 'checkbox') GovBB.D[field] = el.checked;
        else if (el.type === 'radio') { if (el.checked) GovBB.D[field] = el.value; }
        else GovBB.D[field] = el.value;
        if (el.getAttribute('data-trigger-render')) GovBB.render();
      });
    });
  }

  /* ── Radio binding ── */
  function _bindRadios() {
    var radios = document.querySelectorAll('[role="radio"]');
    radios.forEach(function (btn) {
      var name  = btn.getAttribute('data-name');
      var value = btn.getAttribute('data-value');
      if (GovBB.D[name] === value) _setRadioActive(name, value);
      btn.addEventListener('click', function () {
        GovBB.selectRadio(name, value);
        if (_onRadio) _onRadio(name, value);
      });
    });
  }

  function _setRadioActive(name, value) {
    var all = document.querySelectorAll('[role="radio"][data-name="' + name + '"]');
    all.forEach(function (b) {
      var isActive = b.getAttribute('data-value') === value;
      b.setAttribute('aria-checked', isActive ? 'true' : 'false');
      if (isActive) {
        b.classList.add('bg-bb-black-00', 'border-bb-black-00');
        b.classList.remove('bg-bb-white-00');
        b.innerHTML = '<span class="size-5 rounded-full bg-bb-white-00 block"></span>';
      } else {
        b.classList.remove('bg-bb-black-00', 'border-bb-black-00');
        b.classList.add('bg-bb-white-00');
        b.innerHTML = '';
      }
    });
  }

  GovBB.selectRadio = function (name, value) {
    GovBB.D[name] = value;
    _setRadioActive(name, value);
    // Show/hide conditional elements
    var conditionals = document.querySelectorAll('[data-show-when-name="' + name + '"]');
    conditionals.forEach(function (el) {
      var showVal = el.getAttribute('data-show-when-value');
      var invert  = el.getAttribute('data-show-when-not');
      var show;
      if (invert) show = value !== invert;
      else show = value === showVal;
      el.style.display = show ? '' : 'none';
    });
  };

  /* ── Checkbox binding ── */
  function _bindCheckboxes() {
    var checks = document.querySelectorAll('[data-checkbox]');
    checks.forEach(function (el) {
      var name = el.getAttribute('data-checkbox');
      var mark = el.parentElement ? el.parentElement.querySelector('.check-mark') : null;
      function _syncMark() {
        if (mark) mark.style.display = el.checked ? 'flex' : 'none';
      }
      if (GovBB.D[name]) { el.checked = true; _syncMark(); }
      el.addEventListener('change', function () {
        GovBB.D[name] = el.checked;
        _syncMark();
        var conditionals = document.querySelectorAll('[data-show-when-check="' + name + '"]');
        conditionals.forEach(function (c) {
          c.style.display = el.checked ? '' : 'none';
        });
      });
      // Run on init to restore state
      var conditionals = document.querySelectorAll('[data-show-when-check="' + name + '"]');
      conditionals.forEach(function (c) {
        c.style.display = GovBB.D[name] ? '' : 'none';
      });
    });
  }

  GovBB.toggleCheckbox = function (name) {
    GovBB.D[name] = !GovBB.D[name];
    GovBB.render();
  };

  /* ── Signature pads ── */
  function _initSignaturePads() {
    var canvases = document.querySelectorAll('canvas.sig-canvas');
    canvases.forEach(function (canvas) {
      var field = canvas.getAttribute('data-field') || 'signature';
      var ctx = canvas.getContext('2d');
      var drawing = false;
      var lastX = 0, lastY = 0;

      function getPos(e) {
        var r = canvas.getBoundingClientRect();
        var src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - r.left, y: src.clientY - r.top };
      }
      function start(e) { e.preventDefault(); drawing = true; var p = getPos(e); lastX = p.x; lastY = p.y; }
      function draw(e) {
        e.preventDefault();
        if (!drawing) return;
        var p = getPos(e);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        lastX = p.x; lastY = p.y;
        GovBB.D[field] = canvas.toDataURL();
      }
      function stop() { drawing = false; }

      canvas.addEventListener('mousedown', start);
      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('mouseup', stop);
      canvas.addEventListener('mouseleave', stop);
      canvas.addEventListener('touchstart', start, { passive: false });
      canvas.addEventListener('touchmove', draw, { passive: false });
      canvas.addEventListener('touchend', stop);
    });

    // Clear buttons
    var clears = document.querySelectorAll('[data-clear-sig]');
    clears.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.getAttribute('data-clear-sig');
        var canvas = document.querySelector('canvas[data-field="' + target + '"]');
        if (canvas) {
          canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
          GovBB.D[target] = '';
        }
      });
    });
  }

  /* ── Validation helpers ── */
  GovBB.clearErrors = function () {
    var summary = document.getElementById('error-summary');
    if (summary) summary.remove();
    document.querySelectorAll('.field-error').forEach(function (e) { e.remove(); });
    document.querySelectorAll('.border-bb-red-00').forEach(function (el) {
      el.classList.remove('border-bb-red-00');
      el.classList.add('border-bb-black-00');
    });
  };

  GovBB.showFieldError = function (id, msg) {
    var input = document.getElementById(id) || document.querySelector('[data-field="' + id + '"]');
    if (!input) return;
    var wrap = input.closest('.input-wrap') || input.parentElement;
    if (wrap && wrap.classList.contains('border-bb-black-00')) {
      wrap.classList.remove('border-bb-black-00');
      wrap.classList.add('border-bb-red-00');
    }
    var err = document.createElement('span');
    err.className = 'field-error';
    err.id = 'err-' + id;
    err.textContent = msg;
    var container = input.closest('.field-group') || wrap.parentElement || input.parentElement;
    if (container) container.insertBefore(err, wrap || input);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'err-' + id);
  };

  GovBB.showErrors = function (errors) {
    GovBB.clearErrors();
    if (!errors || !errors.length) return;
    // Build summary
    var html = '<div id="error-summary" class="error-summary" role="alert" tabindex="-1"><h2>There is a problem</h2><ul>';
    errors.forEach(function (e) {
      html += '<li><a href="#' + e.id + '">' + _esc(e.msg) + '</a></li>';
    });
    html += '</ul></div>';
    var app = document.getElementById(_appEl);
    app.insertAdjacentHTML('afterbegin', html);
    document.getElementById('error-summary').focus();
    // Inline errors
    errors.forEach(function (e) { GovBB.showFieldError(e.id, e.msg); });
    // Update page title
    if (!document.title.startsWith('Error:')) document.title = 'Error: ' + document.title;
  };

  /* ── Template helpers ── */
  GovBB.backLink = function () {
    return '<a href="#" onclick="back();return false;" class="inline-flex items-center gap-xs outline-none underline-offset-2 underline hover:no-underline active:bg-bb-yellow-100 focus-visible:bg-bb-yellow-100 text-bb-teal-00 hover:text-bb-black-00 hover:bg-bb-teal-10 mb-m block">← Back</a>';
  };

  GovBB.caption = function (text) {
    return '<p class="border-bb-black-00 border-l-[3px] py-xs pl-s text-bb-mid-grey-00 mb-s">' + _esc(text || _formName) + '</p>';
  };

  GovBB.continueBtn = function (label) {
    return '<div class="mt-8 flex gap-4"><button type="button" onclick="next()" class="' + GovBB.BTN_CLS + '">' + _esc(label || 'Continue') + '</button></div>';
  };

  GovBB.startBtn = function (label) {
    return '<div class="mt-8"><a href="#" onclick="next();return false;" class="' + GovBB.BTN_CLS + ' no-underline">' + _esc(label || 'Complete the online form') + '</a></div>';
  };

  GovBB.textField = function (id, label, opts) {
    opts = opts || {};
    var val = GovBB.D[id] || '';
    var hint = opts.hint ? '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00 mt-xs">' + _esc(opts.hint) + '</p>' : '';
    var style = opts.width ? ' style="max-width:' + opts.width + '"' : '';
    return '<div class="field-group flex flex-col gap-xs w-full items-start">' +
      '<label for="' + id + '" class="block text-[1.25rem] leading-normal font-bold text-bb-black-00">' + _esc(label) + '</label>' +
      hint +
      '<div class="input-wrap ' + GovBB.INPUT_WRAP_CLS + '"' + style + '>' +
        '<input type="text" id="' + id + '" name="' + id + '" data-field="' + id + '"' +
        (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
        (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') +
        (opts.placeholder ? ' placeholder="' + _esc(opts.placeholder) + '"' : '') +
        ' value="' + _esc(val) + '"' +
        ' class="' + GovBB.INPUT_CLS + '" />' +
      '</div>' +
    '</div>';
  };

  GovBB.emailField = function (id, label, opts) {
    opts = opts || {};
    var val = GovBB.D[id] || '';
    var hint = opts.hint ? '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00 mt-xs">' + _esc(opts.hint) + '</p>' : '';
    return '<div class="field-group flex flex-col gap-xs w-full items-start">' +
      '<label for="' + id + '" class="block text-[1.25rem] leading-normal font-bold text-bb-black-00">' + _esc(label) + '</label>' +
      hint +
      '<div class="input-wrap ' + GovBB.INPUT_WRAP_CLS + '">' +
        '<input type="email" id="' + id + '" name="' + id + '" data-field="' + id + '"' +
        ' value="' + _esc(val) + '"' +
        ' autocomplete="email" class="' + GovBB.INPUT_CLS + '" />' +
      '</div>' +
    '</div>';
  };

  GovBB.telField = function (id, label, opts) {
    opts = opts || {};
    var val = GovBB.D[id] || '';
    var hint = opts.hint ? '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00 mt-xs">' + _esc(opts.hint) + '</p>' : '';
    var style = opts.width ? ' style="max-width:' + opts.width + '"' : '';
    return '<div class="field-group flex flex-col gap-xs w-full items-start">' +
      '<label for="' + id + '" class="block text-[1.25rem] leading-normal font-bold text-bb-black-00">' + _esc(label) + '</label>' +
      hint +
      '<div class="input-wrap ' + GovBB.INPUT_WRAP_CLS + '"' + style + '>' +
        '<input type="tel" id="' + id + '" name="' + id + '" data-field="' + id + '"' +
        (opts.placeholder ? ' placeholder="' + _esc(opts.placeholder) + '"' : '') +
        ' value="' + _esc(val) + '"' +
        ' class="' + GovBB.INPUT_CLS + '" />' +
      '</div>' +
    '</div>';
  };

  GovBB.selectField = function (id, label, options, opts) {
    opts = opts || {};
    var val = GovBB.D[id] || '';
    var hint = opts.hint ? '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00 mt-xs">' + _esc(opts.hint) + '</p>' : '';
    var ops = '<option value="">Select one</option>';
    options.forEach(function (o) {
      var v = (typeof o === 'object') ? o.value : o;
      var l = (typeof o === 'object') ? o.label : o;
      ops += '<option value="' + _esc(v) + '"' + (val === v ? ' selected' : '') + '>' + _esc(l) + '</option>';
    });
    return '<div class="field-group flex flex-col gap-xs w-full items-start">' +
      '<label for="' + id + '" class="block text-[1.25rem] leading-normal font-bold text-bb-black-00">' + _esc(label) + '</label>' +
      hint +
      '<div class="input-wrap ' + GovBB.INPUT_WRAP_CLS + '">' +
        '<select id="' + id + '" name="' + id + '" data-field="' + id + '" class="' + GovBB.INPUT_CLS + ' cursor-pointer">' + ops + '</select>' +
      '</div>' +
    '</div>';
  };

  GovBB.textareaField = function (id, label, opts) {
    opts = opts || {};
    var val = GovBB.D[id] || '';
    var hint = opts.hint ? '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00 mt-xs">' + _esc(opts.hint) + '</p>' : '';
    return '<div class="field-group flex flex-col gap-xs w-full items-start">' +
      '<label for="' + id + '" class="block text-[1.25rem] leading-normal font-bold text-bb-black-00">' + _esc(label) + '</label>' +
      hint +
      '<div class="input-wrap ' + GovBB.INPUT_WRAP_CLS + ' flex-col p-0">' +
        '<textarea id="' + id + '" name="' + id + '" data-field="' + id + '"' +
        ' rows="' + (opts.rows || 5) + '"' +
        (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') +
        ' class="w-full p-s outline-none rounded-[inherit] resize-y">' + _esc(val) + '</textarea>' +
      '</div>' +
    '</div>';
  };

  GovBB.dateField = function (prefix, label, hint) {
    var day   = GovBB.D[prefix + '-day']   || '';
    var month = GovBB.D[prefix + '-month'] || '';
    var year  = GovBB.D[prefix + '-year']  || '';
    var hintHtml = hint ? '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00">' + _esc(hint) + '</p>' : '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00">For example, 27 03 2007</p>';
    return '<div class="field-group flex flex-col gap-xs w-full items-start">' +
      '<p class="text-[1.25rem] leading-normal font-bold text-bb-black-00">' + _esc(label) + '</p>' +
      hintHtml +
      '<div class="flex gap-s items-end flex-wrap">' +
        _datePart(prefix + '-day',   'Day',   '5rem',  day,   'numeric') +
        _datePart(prefix + '-month', 'Month', '5rem',  month, 'numeric') +
        _datePart(prefix + '-year',  'Year',  '7rem',  year,  'numeric') +
      '</div>' +
    '</div>';
  };

  function _datePart(id, lbl, w, val, mode) {
    return '<div class="flex flex-col gap-xs">' +
      '<label for="' + id + '" class="text-[1.25rem] leading-normal font-bold text-bb-black-00">' + lbl + '</label>' +
      '<div class="input-wrap relative inline-flex rounded-sm border-2 border-bb-black-00 items-center transition-all bg-bb-white-00 hover:shadow-form-hover focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bb-black-00" style="width:' + w + '">' +
        '<input type="text" id="' + id + '" name="' + id + '" data-field="' + id + '" inputmode="' + mode + '" value="' + _esc(val) + '" class="w-full min-w-0 p-s outline-none rounded-[inherit]" />' +
      '</div>' +
    '</div>';
  }

  GovBB.radioGroup = function (name, label, options, opts) {
    opts = opts || {};
    var hint = opts.hint ? '<p class="text-[1.25rem] leading-normal text-bb-mid-grey-00">' + _esc(opts.hint) + '</p>' : '';
    var items = '';
    options.forEach(function (o) {
      var v = (typeof o === 'object') ? o.value : o;
      var l = (typeof o === 'object') ? o.label : o;
      items += '<div class="flex gap-5 items-center">' +
        '<button type="button" role="radio" aria-checked="false" data-name="' + name + '" data-value="' + _esc(v) + '"' +
        ' class="relative inline-flex size-12 shrink-0 items-center justify-center bg-bb-white-00 border-2 border-bb-black-00 rounded-full transition-all outline-none hover:cursor-pointer hover:shadow-form-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bb-black-00"></button>' +
        '<label class="text-[1.25rem] leading-normal text-bb-black-00 cursor-pointer">' + _esc(l) + '</label>' +
      '</div>';
    });
    return '<div class="field-group flex flex-col gap-s items-start w-full">' +
      '<p class="text-[1.25rem] leading-normal font-bold text-bb-black-00">' + _esc(label) + '</p>' +
      hint +
      items +
    '</div>';
  };

  GovBB.checkboxItem = function (name, label) {
    var checked = GovBB.D[name] ? ' checked' : '';
    return '<div class="flex gap-4 items-start">' +
      '<div class="relative inline-flex mt-1 size-8 shrink-0 border-2 border-bb-black-00 rounded-sm bg-bb-white-00 hover:shadow-form-hover">' +
        '<input type="checkbox" id="' + name + '" data-checkbox="' + name + '"' + checked +
        ' class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />' +
        '<span class="check-mark hidden absolute inset-0 flex items-center justify-center pointer-events-none">' +
          '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' +
        '</span>' +
      '</div>' +
      '<label for="' + name + '" class="text-[1.25rem] leading-normal text-bb-black-00 cursor-pointer">' + label + '</label>' +
    '</div>';
  };

  GovBB.summaryRow = function (label, value, changeTo) {
    var changeLink = changeTo
      ? '<a href="#" onclick="nav(\\'' + changeTo + '\\');return false;" class="' + GovBB.LINK_CLS + ' text-[1rem]">Change<span class="sr-only"> ' + _esc(label) + '</span></a>'
      : '';
    return '<div class="summary-row">' +
      '<dt class="font-semibold text-[1rem]">' + _esc(label) + '</dt>' +
      '<dd class="text-[1rem]">' + _esc(value || '—') + '</dd>' +
      '<div>' + changeLink + '</div>' +
    '</div>';
  };

  /* ── Escape helper ── */
  function _esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Global aliases ── */
  global.GovBB  = GovBB;
  global.next   = function () { GovBB.next(); };
  global.back   = function () { GovBB.back(); };
  global.goBack = function () { GovBB.back(); };
  global.nav    = function (p) { GovBB.nav(p); };
  global.goTo   = function (p) { GovBB.nav(p); };

}(window));
`;

// ---------------------------------------------------------------------------
// System prompt for Claude
// ---------------------------------------------------------------------------
function buildSystemPrompt() {
  return `You are a form prototype builder for GovTech Barbados. Your job is to turn a paper form PDF into a single, self-contained, clickable HTML prototype.

CRITICAL OUTPUT RULE: Return ONLY the raw HTML. No explanation, no markdown fences, no preamble. The very first character must be < and the very last must be >.

DESIGN RULES:
- Font: Inter (loaded from Google Fonts)
- Header: white background, 2px solid black border-bottom, wordmark "Public Service Generator"
- Notice bar: white background, 2px solid black border-bottom, black outlined "DRAFT" tag, text "Draft service -- not yet published on alpha.gov.bb"
- All inputs: 2px solid black border, white background, black text
- Primary button: black fill, white text, 2px solid black border
- Secondary button: white fill, black text, 2px solid black border
- Caption: left border 3px solid black, grey text
- Confirmation panel: 2px solid black border (NOT a coloured background)
- Footer: white background, 2px solid black border-top, text "Draft service -- not yet published on alpha.gov.bb"
- No teal, no colour fills anywhere except error red (#a42c2c) for validation
- No crest, logo, coat of arms, flag, or government emblem

STRUCTURE:
1. Start page -- form name as H1, what you need, what happens next, Start button
2. One question (or tightly related group) per page
3. Check your answers page
4. Confirmation page with black-bordered panel and reference number

INLINE THESE ASSETS exactly as shown in the skeleton -- do not link to external files:

HEAD:
<script src="https://cdn.tailwindcss.com"></script>
<script>TAILWIND_CONFIG_HERE</script>
<style>BASE_CSS_HERE</style>

END OF BODY (before form script):
FRAMEWORK_JS_HERE

VALIDATION: client-side only, no HTML5 native validation (use novalidate), NRN format YYMMDD-XXXX, Barbados phone numbers, DD MM YYYY date inputs, 11 parishes.

AUTO-FILL: include a floating "Auto-fill page" button with realistic Barbadian sample data per page.

FORM NAME: on the second line of your output write exactly: FORM_NAME: <the name you detected from the PDF>

Do not invent fees, legal wording, or contact details not present in the PDF. Use [Confirm: ...] placeholders for anything missing.`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // Auth — signature-verified via Netlify Identity (see ../lib/auth.mjs)
  const user = await getVerifiedUser(req);

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 });
  }

  const userSlug = user.email.replace(/[^a-z0-9]/gi, '-');

  // Per-user rate limit (bounds Anthropic spend). Best-effort sliding window in
  // Blobs — a burst of truly-concurrent requests can slip past, but it caps
  // sustained abuse from any single account.
  const rateStore = getStore('psg-ratelimit');
  const nowMs = Date.now();
  try {
    let hits = (await rateStore.get(userSlug, { type: 'json' })) || [];
    hits = hits.filter((t) => nowMs - t < RATE_LIMIT_WINDOW);
    if (hits.length >= RATE_LIMIT_MAX) {
      return new Response(
        JSON.stringify({ error: 'Rate limit reached. Try again later.' }),
        { status: 429, headers: { 'Retry-After': '3600' } }
      );
    }
    hits.push(nowMs);
    await rateStore.setJSON(userSlug, hits);
  } catch {
    // If the rate-limit store is unavailable, allow the request rather than
    // hard-failing generation — the auth check above is the real gate.
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { filename, pdfBase64 } = body;
  if (!pdfBase64 || !filename) {
    return new Response(JSON.stringify({ error: 'Missing filename or pdfBase64' }), { status: 400 });
  }
  if (typeof pdfBase64 !== 'string' || pdfBase64.length > MAX_PDF_B64_CHARS) {
    return new Response(JSON.stringify({ error: 'PDF too large' }), { status: 413 });
  }

  const auditStore = getStore('psg-audit');
  const histStore  = getStore(`psg-history-${user.email.replace(/[^a-z0-9]/gi, '-')}`);

  const timestamp  = new Date().toISOString();
  const auditKey   = `${timestamp}-${user.email}`;
  const histKey    = timestamp;

  const client = new Anthropic();

  // Stream SSE response back to the browser
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {

      function send(obj) {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n'));
      }

      let htmlOutput   = '';
      let detectedName = filename.replace(/\.pdf$/i, '');
      let status       = 'error';
      let errorMessage = '';

      try {
        send({ type: 'progress', message: 'Analysing PDF...', pct: 30 });

        const response = await client.messages.create({
          model:      'claude-sonnet-5',
          max_tokens: 8192,
          stream:     true,
          // Sonnet 5 runs adaptive thinking by default when `thinking` is unset.
          // Disable it here: the 8192-token budget is shared with output and the
          // Netlify function has a ~26s timeout, so thinking risks truncating the
          // generated HTML and slowing the stream. (Matches Sonnet 4.6 behaviour.)
          thinking:   { type: 'disabled' },
          system:     buildSystemPrompt(),
          messages: [{
            role: 'user',
            content: [
              {
                type:   'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
              },
              {
                type: 'text',
                text: 'Turn this PDF form into a clickable HTML prototype following the system prompt rules. Remember: output raw HTML only, starting with <.'
              }
            ]
          }]
        });

        send({ type: 'progress', message: 'Generating prototype...', pct: 50 });

        let firstLine = true;
        for await (const event of response) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text;
            htmlOutput += text;

            // Extract FORM_NAME from second line if present
            if (firstLine && htmlOutput.includes('\n')) {
              const lines = htmlOutput.split('\n');
              if (lines.length >= 2) {
                const nameLine = lines[1];
                if (nameLine.startsWith('FORM_NAME:')) {
                  detectedName = nameLine.replace('FORM_NAME:', '').trim();
                  // Remove the name line from output
                  htmlOutput = lines[0] + '\n' + lines.slice(2).join('\n');
                }
                firstLine = false;
              }
            }

            send({ type: 'text', text });
          }
        }

        // Inject inlined assets if the stub markers are present
        htmlOutput = htmlOutput
          .replace('TAILWIND_CONFIG_HERE', TAILWIND_CONFIG)
          .replace('BASE_CSS_HERE', BASE_CSS)
          .replace('FRAMEWORK_JS_HERE', FRAMEWORK_STUB);

        status = 'success';
        send({ type: 'name',     value: detectedName });
        send({ type: 'progress', message: 'Done', pct: 100 });

        // Save to history
        await histStore.setJSON(histKey, {
          key:       histKey,
          name:      detectedName,
          filename,
          timestamp,
          status:    'success',
          html:      htmlOutput
        });

      } catch (err) {
        errorMessage = err.message || 'Unknown error';
        send({ type: 'error', message: errorMessage });
      }

      // Write audit entry
      try {
        await auditStore.setJSON(auditKey, {
          timestamp,
          userEmail: user.email,
          formName:  detectedName,
          filename,
          status,
          error:     errorMessage || null
        });
      } catch {
        // Audit write failure should not surface to user
      }

      send('[DONE]');
      controller.close();
    }
  });

  return new Response(stream, {
    status:  200,
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
}

export const config = { path: '/api/generate-form' };

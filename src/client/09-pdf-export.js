// Layer: 09 pdf-export — depends on: nothing; self-contained browser IIFE (no cross-fragment symbols).
// Client-side 练习卷 PDF export: `.nce-paper` DOM → SVG foreignObject → canvas → JPEG pages in PDF 1.4.
// Exposes `window.PaperPdfExport` / `PaperExportPdf` / `PaperPdfSave`; consumed by 30-paper-ui.js.
;/*!
 * 09-pdf-export.js — layer 09: dependency-free client-side PDF export for the
 * dsh-nce 练习卷 (fillable exercise paper); consumed by 30-paper-ui.js.
 *
 * No network, no libraries, no server.  The live `.nce-paper` DOM plus the
 * page's <style> contents are serialized into an XHTML block inside an SVG
 * <foreignObject>, rasterized at 2x through Image → canvas, cut into A4
 * pages at question-row boundaries, and written into a minimal PDF 1.4 file
 * whose pages are JPEG images (`/Filter /DCTDecode`).
 *
 * Public API (also attached to `window.PaperPdfExport`):
 *
 *   const result = await PaperExportPdf({
 *     root:          HTMLElement,   // .nce-paper
 *     fileName:      '第1课-练习卷.pdf',
 *     mode:          'paper' | 'graded',
 *     includeAnswers: true,         // false = blank paper
 *     title:         '第 1 课 · 练习卷',
 *     width:         900,           // CSS px rendered paper width
 *     scale:         2,             // raster scale (capped for huge papers)
 *     pageMargin:    36,            // CSS px margin inside A4
 *     jpegQuality:   0.9,
 *     footer:        true,
 *     onProgress:    ({ phase, ratio, message, page, pages }) => void,
 *   })
 *   // → { blob, pages, pageImages, width, height, pageWidth, pageHeight, scale, ms, fileName, mode }
 *
 *   PaperPdfSave(result, 'name.pdf')  // triggers the browser download
 *   PaperPdfPrintFallback({ root, title }) // print-window fallback (returns a Promise)
 *
 * The module is an IIFE so it can be pasted directly into a plugin fragment
 * (09-pdf-export.js) without a bundler.  It assumes system fonts.
 */
(function (global) {
  'use strict'

  var VERSION = '1.0.0'
  var A4_RATIO = 297 / 210
  var PDF_PAGE_W = 595.28
  var PDF_PAGE_H = 841.89
  var MAX_CANVAS_HEIGHT = 30000
  var MAX_CANVAS_PIXELS = 80 * 1000 * 1000

  function noop() {}

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms) })
  }

  function raf() {
    return new Promise(function (resolve) { requestAnimationFrame(function () { resolve() }) })
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function asciiBytes(text) {
    var value = String(text)
    var out = new Uint8Array(value.length)
    for (var index = 0; index < value.length; index += 1) out[index] = value.charCodeAt(index) & 0xff
    return out
  }

  function base64ToBytes(base64) {
    var binary = atob(base64)
    var out = new Uint8Array(binary.length)
    for (var index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
    return out
  }

  /** Byte writer that keeps exact offsets for the PDF xref table. */
  function ByteWriter() {
    this.chunks = []
    this.length = 0
  }
  ByteWriter.prototype.push = function (bytes) {
    this.chunks.push(bytes)
    this.length += bytes.length
  }
  ByteWriter.prototype.ascii = function (text) {
    this.push(asciiBytes(text))
  }
  ByteWriter.prototype.blob = function (type) {
    return new Blob(this.chunks, { type: type })
  }

  function collectStyleText() {
    var parts = []
    var styles = document.querySelectorAll('style')
    for (var index = 0; index < styles.length; index += 1) {
      var text = styles[index].textContent || ''
      if (text.trim() !== '') parts.push(text)
    }
    // Same-origin <link rel=stylesheet> rules are not needed by the plugin
    // (it injects a <style>), but include them if the host has any.
    try {
      var sheets = document.styleSheets
      for (var sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
        var sheet = sheets[sheetIndex]
        if (sheet.ownerNode !== null && sheet.ownerNode !== undefined && sheet.ownerNode.tagName === 'STYLE') continue
        var rules = null
        try { rules = sheet.cssRules } catch (error) { rules = null }
        if (rules === null) continue
        for (var ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
          var cssText = rules[ruleIndex].cssText || ''
          if (cssText !== '') parts.push(cssText)
        }
      }
    } catch (error) {
      // Cross-origin sheets are ignored.
    }
    return parts.join('\n')
  }

  /** Resolve every custom property referenced by the CSS from the live DOM. */
  function collectThemeVars(cssText, root) {
    var names = new Set()
    var pattern = /var\(\s*(--[a-zA-Z0-9_-]+)/g
    var match = pattern.exec(cssText)
    while (match !== null) {
      names.add(match[1])
      match = pattern.exec(cssText)
    }
    var result = {}
    var sources = []
    if (root !== null && root !== undefined) sources.push(root)
    var node = root !== null && root !== undefined ? root.parentElement : null
    while (node !== null && node !== undefined) {
      sources.push(node)
      node = node.parentElement
    }
    sources.push(document.documentElement)
    names.forEach(function (name) {
      for (var index = 0; index < sources.length; index += 1) {
        var value = getComputedStyle(sources[index]).getPropertyValue(name).trim()
        if (value !== '') {
          result[name] = value
          return
        }
      }
    })
    return result
  }

  function overrideCss(options) {
    var graded = options.mode === 'graded' && options.includeAnswers !== false
    return [
      '.paperpdf-host{width:100%!important;height:auto!important;max-height:none!important;min-height:0!important;overflow:visible!important;display:block!important;background:#fff!important;color:#1f2328!important;container-type:inline-size;}',
      '.paperpdf-host,.paperpdf-host *{box-sizing:border-box;}',
      '.paperpdf-host .nce-paper{width:100%!important;max-width:none!important;margin:0!important;gap:12px!important;}',
      '.paperpdf-host .nce-paper-hero{break-inside:avoid;}',
      '.paperpdf-host .nce-paper-toolbar,',
      '.paperpdf-host .nce-paper-reveal,',
      '.paperpdf-host .nce-paper-selfmark,',
      '.paperpdf-host .nce-paper-saved,',
      '.paperpdf-host .nce-paper-grade-hint,',
      '.paperpdf-host .nce-paper-score-hint,',
      '.paperpdf-host .nce-paper-score-ai,',
      '.paperpdf-host .nce-paper-ai-error,',
      '.paperpdf-host .nce-paper-ai-notice,',
      '.paperpdf-host .nce-paper-pdf-overlay {display:none!important;}',
      graded ? '.paperpdf-host .nce-paper-hero-side{display:flex!important;}' : '.paperpdf-host .nce-paper-hero-side{display:none!important;}',
      '.paperpdf-host .nce-paper-verdict{}',
      '.paperpdf-host .paperpdf-field{font-family:Georgia,"Times New Roman",serif;color:#1f2328;white-space:pre-wrap;word-break:break-word;}',
      '.paperpdf-host .paperpdf-blank{display:inline-block;vertical-align:baseline;min-width:54px;margin:0 2px;padding:0 6px;border:0;border-bottom:1.5px solid #9aa0a8;border-radius:3px 3px 0 0;background:rgba(76,141,255,.06);font-size:12.5px;line-height:1.7;text-align:left;}',
      '.paperpdf-host .paperpdf-blank.is-empty{min-width:64px;}',
      '.paperpdf-host .paperpdf-answer{display:block;width:100%;min-height:2.35em;padding:6px 10px;border:1px solid rgba(127,127,127,.28);border-bottom:1.5px solid rgba(127,127,127,.45);border-radius:8px;background:rgba(255,255,255,.55);font-size:13px;line-height:1.6;}',
      '.paperpdf-host .paperpdf-match-input{display:inline-block;flex:none;width:66px;height:26px;padding:0 7px;border:1px solid rgba(127,127,127,.4);border-radius:6px;background:rgba(127,127,127,.07);font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:24px;letter-spacing:.06em;text-align:center;}',
      graded ? '.paperpdf-host .nce-paper-q.is-correct .paperpdf-blank, .paperpdf-host .nce-paper-q.is-correct .paperpdf-answer{border-color:#2f9e44!important;}' : '.paperpdf-host .nce-paper-q.is-correct .paperpdf-field, .paperpdf-host .nce-paper-q.is-wrong .paperpdf-field, .paperpdf-host .nce-paper-q.is-correct .paperpdf-blank, .paperpdf-host .nce-paper-q.is-wrong .paperpdf-blank{border-color:#9aa0a8!important;background:rgba(76,141,255,.06)!important;}',
      graded ? '.paperpdf-host .nce-paper-q.is-wrong .paperpdf-blank, .paperpdf-host .nce-paper-q.is-wrong .paperpdf-answer{border-color:#d6393f!important;}' : '',
      graded ? '.paperpdf-host .nce-paper-match-row.is-correct .paperpdf-match-input{border-color:#2f9e44!important;}' : '',
      graded ? '.paperpdf-host .nce-paper-match-row.is-wrong .paperpdf-match-input{border-color:#d6393f!important;}' : '',
      graded ? '' : '.paperpdf-host .nce-paper-mark{display:none!important;}',
      graded ? '' : '.paperpdf-host .nce-paper-score{display:none!important;}',
      graded ? '' : '.paperpdf-host .nce-paper-verdict{display:none!important;}',
      'details.nce-paper-matching{display:none!important;}',
      'details.nce-paper-matching[open]{display:block!important;}',
      '.paperpdf-host .nce-paper-stray .nce-btn{display:none!important;}',
      '.paperpdf-host .nce-paper-table-wrap{overflow:visible!important;}',
      '.paperpdf-host .nce-paper-table{page-break-inside:avoid;}',
      '.paperpdf-host .nce-paper-example{break-inside:avoid;}',
      '.paperpdf-host .nce-paper-q{break-inside:avoid;}',
    ].join('\n')
  }

  /** Remove dangerous / interactive nodes and replace form controls with text. */
  function prepareClone(root, options) {
    var clone = root.cloneNode(true)
    var originals = root.querySelectorAll('input, textarea')
    var copies = clone.querySelectorAll('input, textarea')
    for (var index = 0; index < copies.length; index += 1) {
      var source = originals[index]
      var copy = copies[index]
      if (source === undefined) break
      var rawValue = options.includeAnswers === false ? '' : String(source.value == null ? '' : source.value)
      var isBlank = copy.classList.contains('nce-paper-blank')
      var isMatch = copy.classList.contains('nce-paper-match-input')
      var span = document.createElement('span')
      span.className = isMatch
        ? 'paperpdf-field paperpdf-match-input'
        : isBlank
          ? 'paperpdf-field paperpdf-blank'
          : 'paperpdf-field paperpdf-answer'
      if (rawValue.trim() === '') {
        span.classList.add('is-empty')
        span.textContent = '\u00a0'
      } else {
        span.textContent = rawValue
      }
      if (isBlank) span.style.minWidth = Math.max(54, Math.min(260, (rawValue.length + 2) * 7)) + 'px'
      var parent = copy.parentNode
      if (parent !== null) parent.replaceChild(span, copy)
    }
    var removals = clone.querySelectorAll('script, iframe, object, embed, link, meta, form')
    for (var removeIndex = 0; removeIndex < removals.length; removeIndex += 1) removals[removeIndex].remove()
    var buttons = clone.querySelectorAll('button, [role="button"]')
    for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex += 1) buttons[buttonIndex].remove()
    var all = clone.querySelectorAll('*')
    for (var nodeIndex = 0; nodeIndex < all.length; nodeIndex += 1) {
      var node = all[nodeIndex]
      var attributes = Array.from(node.attributes)
      for (var attrIndex = 0; attrIndex < attributes.length; attrIndex += 1) {
        var name = attributes[attrIndex].name
        if (/^on/i.test(name)) node.removeAttribute(name)
      }
      node.removeAttribute('id')
      node.removeAttribute('tabindex')
      if (node.tagName === 'IMG') {
        var src = node.getAttribute('src') || ''
        if (!/^data:/i.test(src)) node.remove()
      }
    }
    var graded = options.mode === 'graded' && options.includeAnswers !== false
    if (!graded) {
      var verdicts = clone.querySelectorAll('.nce-paper-verdict, .nce-paper-score, .nce-paper-mark')
      for (var verdictIndex = 0; verdictIndex < verdicts.length; verdictIndex += 1) verdicts[verdictIndex].remove()
    }
    var matching = clone.querySelectorAll('details.nce-paper-matching')
    for (var matchIndex = 0; matchIndex < matching.length; matchIndex += 1) {
      if (graded) matching[matchIndex].setAttribute('open', 'open')
      else matching[matchIndex].remove()
    }
    var stray = clone.querySelector('.nce-paper-stray')
    if (stray !== null) {
      if (!graded || stray.querySelector('.nce-paper-ref-lines') === null) stray.remove()
    }
    return clone
  }

  function createHost(root, options, styleText) {
    var wrap = document.createElement('div')
    wrap.setAttribute('aria-hidden', 'true')
    wrap.style.cssText = 'position:absolute!important;left:-20000px!important;top:0!important;width:' + options.width + 'px!important;height:auto!important;overflow:visible!important;pointer-events:none!important;z-index:-1;'
    var host = document.createElement('div')
    host.className = 'nce-root paperpdf-host'
    host.style.cssText = 'width:100%;height:auto;max-height:none;min-height:0;overflow:visible;display:block;background:#fff;color:#1f2328;'
    var style = document.createElement('style')
    style.setAttribute('data-paperpdf', '1')
    style.textContent = styleText
    host.appendChild(style)
    var clone = prepareClone(root, options)
    host.appendChild(clone)
    wrap.appendChild(host)
    document.body.appendChild(wrap)
    return { wrap: wrap, host: host, clone: clone, style: style }
  }

  function collectBoundaries(host, totalHeight) {
    var hostRect = host.getBoundingClientRect()
    var nodes = host.querySelectorAll('[data-paper-q], [data-paper-group], .nce-paper-hero, .nce-paper-stray')
    var values = []
    for (var index = 0; index < nodes.length; index += 1) {
      var rect = nodes[index].getBoundingClientRect()
      var bottom = rect.bottom - hostRect.top
      if (bottom > 8 && bottom < totalHeight - 8) values.push(bottom)
    }
    values.push(totalHeight)
    values.sort(function (left, right) { return left - right })
    var out = []
    var last = -100
    for (var valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      if (values[valueIndex] - last < 1.5) continue
      out.push(values[valueIndex])
      last = values[valueIndex]
    }
    return out
  }

  function chooseScale(width, height, requested) {
    var scale = Math.max(1, Number(requested) || 2)
    scale = Math.min(scale, MAX_CANVAS_HEIGHT / Math.max(1, height))
    scale = Math.min(scale, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)))
    return Math.max(1, Math.min(3, scale))
  }

  function splitChunks(height, contentHeight, boundaries) {
    var chunks = []
    var start = 0
    var guard = 0
    while (start < height - 0.5 && guard < 200) {
      guard += 1
      var target = Math.min(height, start + contentHeight)
      if (target >= height - 0.5) {
        chunks.push({ start: start, end: height })
        break
      }
      var minEnd = start + contentHeight * 0.55
      var best = -1
      for (var index = 0; index < boundaries.length; index += 1) {
        var value = boundaries[index]
        if (value > start + 2 && value >= minEnd && value <= target + 0.01 && value > best) best = value
      }
      var end = best > start + 2 ? best : target
      if (end <= start + 1) end = target
      end = Math.min(height, end)
      chunks.push({ start: start, end: end })
      start = end
    }
    if (chunks.length === 0) chunks.push({ start: 0, end: height })
    return chunks
  }

  function serializeSvg(host, width, height, scale) {
    var xhtml = new XMLSerializer().serializeToString(host)
    var svgWidth = Math.round(width * scale)
    var svgHeight = Math.max(1, Math.round(height * scale))
    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgWidth + '" height="' + svgHeight +
        '" viewBox="0 0 ' + width + ' ' + height + '">' +
        '<foreignObject x="0" y="0" width="' + width + '" height="' + height + '">' +
        xhtml +
        '</foreignObject></svg>',
      svgWidth: svgWidth,
      svgHeight: svgHeight,
    }
  }

  function loadSvgImage(svg) {
    return new Promise(function (resolve, reject) {
      // A data: URL is origin-clean for canvas purposes; a blob: URL created
      // from the same bytes taints the canvas in Chrome (SecurityError) even
      // though the SVG is local.  Keep the data URL path.
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      var image = new Image()
      image.decoding = 'sync'
      var done = false
      image.onload = function () {
        if (done) return
        done = true
        resolve({ image: image, url: '' })
      }
      image.onerror = function () {
        if (done) return
        done = true
        reject(new Error('foreignObject SVG image failed to load'))
      }
      image.src = url
      if (typeof image.decode === 'function') {
        image.decode().then(function () {
          if (done) return
          done = true
          resolve({ image: image, url: '' })
        }).catch(function () { /* onerror handles it */ })
      }
    })
  }

  function canvasLooksBlank(canvas) {
    try {
      var small = document.createElement('canvas')
      small.width = 64
      small.height = Math.max(16, Math.min(256, Math.round(64 * canvas.height / Math.max(1, canvas.width))))
      var context = small.getContext('2d', { alpha: false })
      if (context === null) return false
      context.fillStyle = '#fff'
      context.fillRect(0, 0, small.width, small.height)
      context.drawImage(canvas, 0, 0, small.width, small.height)
      var data = context.getImageData(0, 0, small.width, small.height).data
      var nonWhite = 0
      for (var index = 0; index < data.length; index += 4) {
        if (data[index] < 248 || data[index + 1] < 248 || data[index + 2] < 248) nonWhite += 1
      }
      return nonWhite / (small.width * small.height) < 0.004
    } catch (error) {
      return false
    }
  }

  function makePageImage(paperCanvas, chunk, pageInfo, scale, paperWidth, paperHeight, title, options) {
    var pageCanvas = document.createElement('canvas')
    pageCanvas.width = pageInfo.pageWidth
    pageCanvas.height = pageInfo.pageHeight
    var context = pageCanvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('canvas 2d context unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    var sourceY = Math.round(chunk.start * scale)
    var sourceH = Math.max(1, Math.round((chunk.end - chunk.start) * scale))
    var destX = pageInfo.marginPx
    var destY = pageInfo.marginPx
    var destW = Math.round(paperWidth * scale)
    var destH = sourceH
    if (sourceY + sourceH > paperCanvas.height) sourceH = paperCanvas.height - sourceY
    context.drawImage(paperCanvas, 0, sourceY, paperCanvas.width, sourceH, destX, destY, destW, Math.min(destH, sourceH))
    // Thin rule + footer in the bottom margin.
    var footerY = pageInfo.pageHeight - Math.round(pageInfo.marginPx * 0.55)
    context.strokeStyle = 'rgba(127,127,127,.24)'
    context.lineWidth = Math.max(1, Math.round(scale * 0.5))
    context.beginPath()
    context.moveTo(pageInfo.marginPx, footerY - Math.round(pageInfo.marginPx * 0.55))
    context.lineTo(pageInfo.pageWidth - pageInfo.marginPx, footerY - Math.round(pageInfo.marginPx * 0.55))
    context.stroke()
    var fontPx = Math.max(9, Math.round(8.5 * scale))
    context.font = fontPx + 'px -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    context.fillStyle = '#8a8f98'
    context.textBaseline = 'middle'
    context.textAlign = 'left'
    if (options.footer !== false) {
      var leftText = String(title || '练习卷').replace(/\s+/g, ' ').trim()
      if (leftText.length > 36) leftText = leftText.slice(0, 36) + '…'
      context.fillText(leftText, pageInfo.marginPx, footerY)
      context.textAlign = 'right'
      context.fillText('第 ' + (pageInfo.index + 1) + ' / ' + pageInfo.total + ' 页', pageInfo.pageWidth - pageInfo.marginPx, footerY)
    }
    var dataUrl = pageCanvas.toDataURL('image/jpeg', options.jpegQuality)
    pageCanvas.width = 1
    pageCanvas.height = 1
    return dataUrl
  }

  function buildPdf(pageImages, pageWidthPx, pageHeightPx) {
    var writer = new ByteWriter()
    writer.ascii('%PDF-1.4\n')
    writer.push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
    var pageCount = pageImages.length
    var objectCount = 2 + pageCount * 3
    var offsets = new Array(objectCount + 1).fill(0)
    function begin(number) {
      offsets[number] = writer.length
      writer.ascii(number + ' 0 obj\n')
    }
    function end() { writer.ascii('endobj\n') }

    var kids = []
    for (var index = 0; index < pageCount; index += 1) kids.push((3 + index * 3) + ' 0 R')

    begin(1)
    writer.ascii('<< /Type /Catalog /Pages 2 0 R >>\n')
    end()
    begin(2)
    writer.ascii('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pageCount + ' >>\n')
    end()

    for (var pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      var pageNumber = 3 + pageIndex * 3
      var contentNumber = pageNumber + 1
      var imageNumber = pageNumber + 2
      var image = pageImages[pageIndex]
      var content = 'q\n' + PDF_PAGE_W + ' 0 0 ' + PDF_PAGE_H + ' 0 0 cm\n/Im0 Do\nQ\n'
      begin(pageNumber)
      writer.ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_PAGE_W + ' ' + PDF_PAGE_H +
        '] /Resources << /XObject << /Im0 ' + imageNumber + ' 0 R >> >> /Contents ' + contentNumber + ' 0 R >>\n')
      end()
      begin(contentNumber)
      writer.ascii('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\n')
      end()
      begin(imageNumber)
      writer.ascii('<< /Type /XObject /Subtype /Image /Width ' + pageWidthPx + ' /Height ' + pageHeightPx +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + image.bytes.length + ' >>\nstream\n')
      writer.push(image.bytes)
      writer.ascii('\nendstream\n')
      end()
    }

    var xrefOffset = writer.length
    writer.ascii('xref\n0 ' + (objectCount + 1) + '\n')
    writer.ascii('0000000000 65535 f \n')
    for (var objectIndex = 1; objectIndex <= objectCount; objectIndex += 1) {
      writer.ascii(String(offsets[objectIndex]).padStart(10, '0') + ' 00000 n \n')
    }
    writer.ascii('trailer\n<< /Size ' + (objectCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n')
    return writer
  }

  function report(onProgress, payload) {
    if (typeof onProgress !== 'function') return
    try { onProgress(payload) } catch (error) { /* progress callbacks must not break export */ }
  }

  async function exportPdf(options) {
    var startedAt = Date.now()
    var opts = options !== null && typeof options === 'object' ? options : {}
    var root = opts.root
    if (root === null || root === undefined || typeof root.cloneNode !== 'function') {
      throw new Error('PaperExportPdf: options.root must be the .nce-paper element')
    }
    if (root.querySelector('input[data-paper-input]') === null && root.querySelector('[data-paper-q]') === null) {
      throw new Error('PaperExportPdf: root does not look like a dsh-nce paper')
    }
    var resolved = {
      root: root,
      mode: opts.mode === 'graded' ? 'graded' : 'paper',
      includeAnswers: opts.includeAnswers !== false,
      width: Math.max(520, Math.min(1400, Math.round(Number(opts.width) || 900))),
      scale: Math.max(1, Math.min(3, Number(opts.scale) || 2)),
      pageMargin: Math.max(18, Math.min(72, Math.round(Number(opts.pageMargin) || 36))),
      jpegQuality: Math.max(0.55, Math.min(0.98, Number(opts.jpegQuality) || 0.9)),
      footer: opts.footer !== false,
      title: String(opts.title || '').trim(),
      fileName: String(opts.fileName || 'nce-paper.pdf'),
      onProgress: opts.onProgress,
    }
    if (resolved.title === '') {
      var heroTitle = root.querySelector('.nce-paper-hero-title')
      resolved.title = (heroTitle === null ? '' : heroTitle.textContent || '').replace(/\s+/g, ' ').trim() || '练习卷'
    }
    if (resolved.fileName === 'nce-paper.pdf') {
      var lesson = root.getAttribute('data-paper-lesson') || ''
      resolved.fileName = lesson === '' ? '练习卷.pdf' : '第' + lesson + '课-练习卷.pdf'
    }

    report(resolved.onProgress, { phase: 'prepare', ratio: 0.02, message: '准备练习卷…' })
    await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
    await raf()

    var styleText = collectStyleText()
    var theme = collectThemeVars(styleText, root)
    var allCss = styleText + '\n' + overrideCss(resolved)
    var hostInfo = createHost(root, resolved, allCss)
    var host = hostInfo.host
    var wrap = hostInfo.wrap
    Object.keys(theme).forEach(function (name) {
      try { host.style.setProperty(name, theme[name]) } catch (error) { /* ignore invalid token values */ }
    })
    // Layout must settle after the clone + styles are inserted.
    await raf()
    await raf()
    await sleep(30)
    var height = Math.ceil(host.getBoundingClientRect().height)
    var width = resolved.width
    if (!(height > 20)) {
      wrap.remove()
      throw new Error('PaperExportPdf: paper has no measurable height')
    }
    report(resolved.onProgress, { phase: 'layout', ratio: 0.08, message: '排版练习卷…', height: height, width: width })
    var boundaries = collectBoundaries(host, height)
    var scale = chooseScale(width, height, resolved.scale)
    var serialized = serializeSvg(host, width, height, scale)
    var svgUrl = ''
    var imageInfo = null
    try {
      imageInfo = await loadSvgImage(serialized.svg)
      svgUrl = imageInfo.url
      var canvas = document.createElement('canvas')
      canvas.width = serialized.svgWidth
      canvas.height = serialized.svgHeight
      var context = canvas.getContext('2d', { alpha: false })
      if (context === null) throw new Error('canvas 2d context unavailable')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(imageInfo.image, 0, 0, canvas.width, canvas.height)
      if (canvasLooksBlank(canvas)) {
        throw Object.assign(new Error('foreignObject rendered a blank page'), { code: 'FOREIGNOBJECT_BLANK' })
      }
      var pageWidthPx = Math.round(serialized.svgWidth + 2 * resolved.pageMargin * scale)
      var pageHeightPx = Math.round(pageWidthPx * A4_RATIO)
      var marginPx = Math.round(resolved.pageMargin * scale)
      var contentHeightPx = pageHeightPx - marginPx * 2
      var contentHeightCss = contentHeightPx / scale
      var chunks = splitChunks(height, contentHeightCss, boundaries)
      report(resolved.onProgress, {
        phase: 'rasterize',
        ratio: 0.25,
        message: '已生成整卷位图',
        pages: chunks.length,
        scale: Math.round(scale * 100) / 100,
      })
      var pageImages = []
      for (var pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
        var dataUrl = makePageImage(canvas, chunks[pageIndex], {
          pageWidth: pageWidthPx,
          pageHeight: pageHeightPx,
          marginPx: marginPx,
          index: pageIndex,
          total: chunks.length,
        }, scale, width, height, resolved.title, resolved)
        pageImages.push({
          dataUrl: dataUrl,
          bytes: base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1)),
        })
        report(resolved.onProgress, {
          phase: 'pages',
          ratio: 0.3 + 0.5 * ((pageIndex + 1) / chunks.length),
          message: '生成第 ' + (pageIndex + 1) + ' / ' + chunks.length + ' 页…',
          page: pageIndex + 1,
          pages: chunks.length,
        })
        await sleep(0)
      }
      report(resolved.onProgress, { phase: 'pdf', ratio: 0.85, message: '写入 PDF…', pages: chunks.length })
      var writer = buildPdf(pageImages, pageWidthPx, pageHeightPx)
      var blob = writer.blob('application/pdf')
      report(resolved.onProgress, { phase: 'done', ratio: 1, message: '完成', pages: chunks.length })
      return {
        blob: blob,
        pages: pageImages.length,
        pageImages: pageImages.map(function (page) { return page.dataUrl }),
        width: width,
        height: height,
        pageWidth: pageWidthPx,
        pageHeight: pageHeightPx,
        scale: Math.round(scale * 100) / 100,
        ms: Date.now() - startedAt,
        fileName: resolved.fileName,
        mode: resolved.mode,
        bytes: blob.size,
      }
    } finally {
      if (imageInfo !== null && imageInfo.image !== null) imageInfo.image.src = ''
      if (svgUrl !== '') URL.revokeObjectURL(svgUrl)
      wrap.remove()
    }
  }

  function savePdf(result, fileName) {
    var blob = result instanceof Blob ? result : result !== null && typeof result === 'object' ? result.blob : null
    if (!(blob instanceof Blob)) throw new Error('PaperPdfSave: expected a blob or an exportPdf() result')
    var name = String(fileName || (result !== null && typeof result === 'object' && result.fileName) || '练习卷.pdf')
    var url = URL.createObjectURL(blob)
    var anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(function () { URL.revokeObjectURL(url) }, 30000)
    return name
  }

  /** Build a standalone print document (fallback if foreignObject is blocked). */
  function buildPrintDocument(root, options) {
    var opts = options !== null && typeof options === 'object' ? options : {}
    var clone = root.cloneNode(true)
    var originals = root.querySelectorAll('input')
    var copies = clone.querySelectorAll('input')
    for (var index = 0; index < copies.length; index += 1) {
      var source = originals[index]
      if (source === undefined) break
      copies[index].setAttribute('value', String(source.value == null ? '' : source.value))
      copies[index].setAttribute('readonly', 'readonly')
    }
    var css = collectStyleText() + '\n' + overrideCss({ mode: opts.mode === 'graded' ? 'graded' : 'paper', includeAnswers: opts.includeAnswers !== false })
    var extra = '@page{size:A4;margin:12mm 11mm;}html,body{margin:0;padding:0;background:#fff;}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}.paperpdf-host{width:100%!important;}'
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(opts.title || '练习卷') +
      '</title><style>' + css + '\n' + extra + '</style></head><body><div class="nce-root paperpdf-host">' +
      clone.outerHTML + '</div></body></html>'
  }

  function printFallback(options) {
    var opts = options !== null && typeof options === 'object' ? options : {}
    return new Promise(function (resolve, reject) {
      try {
        var root = opts.root
        if (root === null || root === undefined) throw new Error('printFallback: options.root required')
        var html = buildPrintDocument(root, opts)
        var frame = document.createElement('iframe')
        frame.setAttribute('aria-hidden', 'true')
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
        document.body.appendChild(frame)
        var doc = frame.contentDocument
        if (doc === null) throw new Error('printFallback: iframe document unavailable')
        doc.open()
        doc.write(html)
        doc.close()
        var done = false
        var finish = function () {
          if (done) return
          done = true
          setTimeout(function () { frame.remove() }, 60000)
          resolve({ mode: 'print', html: html })
        }
        frame.onload = function () {
          setTimeout(function () {
            try {
              frame.contentWindow.focus()
              frame.contentWindow.print()
            } catch (error) {
              reject(error)
              return
            }
            finish()
          }, 120)
        }
        setTimeout(function () {
          if (!done) finish()
        }, 2000)
      } catch (error) {
        reject(error)
      }
    })
  }

  var api = {
    version: VERSION,
    exportPdf: exportPdf,
    savePdf: savePdf,
    buildPrintDocument: buildPrintDocument,
    printFallback: printFallback,
    _internals: {
      collectStyleText: collectStyleText,
      collectThemeVars: collectThemeVars,
      splitChunks: splitChunks,
      buildPdf: buildPdf,
    },
  }
  global.PaperPdfExport = api
  global.PaperExportPdf = exportPdf
  global.PaperPdfSave = savePdf
})(typeof window !== 'undefined' ? window : globalThis);

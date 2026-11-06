// Layer: 70 phonetics — depends on: 00-platform, 05-data, 07-ui.

// ---------------------------------------------------------------------------
// Phonetics: 48 IPA reference with per-phoneme tips, phonics rules, minimal
// pair ear training and syllable rules. Read-only view over the `phonetics`
// data. Every symbol is Phon-prefixed so fragments share one factory scope.
// ---------------------------------------------------------------------------

const PHON_SECTIONS = [
  { id: 'phonemes', label: '音标表', icon: 'headphones' },
  { id: 'phonics', label: '自然拼读', icon: 'list' },
  { id: 'pairs', label: '最小对立对', icon: 'flip' },
]

const PHON_GROUP_TITLES = { vowels: '元音', consonants: '辅音', diphthongs: '双元音', other: '其它' }

const PHON_KIND_TITLES = {
  short: '短元音',
  long: '长元音',
  diphthong: '双元音',
  voiceless: '清辅音',
  voiced: '浊辅音',
  nasal: '鼻音',
  liquid: '流音',
  glide: '半元音',
}

const PHON_FALLBACK_INTRO = '英语的 48 个音标就像汉语拼音：看到音标就能把单词读出来。先跟着音标表认口型，再用自然拼读把字母和声音对上号，最后用最小对立对练耳朵。'

/** `/iː/` for data that stores the bare symbol `iː`. */
function phonIpaText(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return ''
  return raw.startsWith('/') ? raw : `/${raw}/`
}

/** Normalize an examples array (objects or plain strings) to rows. */
function phonExampleRows(raw) {
  const rows = []
  if (!Array.isArray(raw)) return rows
  for (const item of raw) {
    if (typeof item === 'string') {
      const word = item.trim()
      if (word !== '') rows.push({ word, phonetic: '', zh: '' })
      continue
    }
    if (item === null || typeof item !== 'object') continue
    const word = String(item.word ?? item.en ?? '').trim()
    if (word === '') continue
    rows.push({
      word,
      phonetic: String(item.phonetic ?? item.ipa ?? '').trim(),
      zh: String(item.zh ?? item.meaning ?? '').trim(),
    })
  }
  return rows
}

/** Normalize a words/examples array that only carries plain strings. */
function phonStringList(raw) {
  const rows = []
  if (!Array.isArray(raw)) return rows
  for (const item of raw) {
    const text = String(item ?? '').trim()
    if (text !== '') rows.push(text)
  }
  return rows
}

/** Group phonemes by their declared groups, appending undeclared groups last. */
function phonGroupsOf(phonetics) {
  const phonemes = Array.isArray(phonetics?.phonemes) ? phonetics.phonemes : []
  const declared = Array.isArray(phonetics?.groups) ? phonetics.groups : []
  const meta = new Map()
  const order = []
  for (const group of declared) {
    if (group === null || typeof group !== 'object') continue
    const id = String(group.id ?? '').trim()
    if (id === '' || meta.has(id)) continue
    meta.set(id, {
      id,
      title: String(group.title ?? '').trim() || PHON_GROUP_TITLES[id] || id,
      hint: String(group.hint ?? '').trim(),
    })
    order.push(id)
  }
  for (const item of phonemes) {
    const id = String(item?.group ?? '').trim() || 'other'
    if (meta.has(id)) continue
    meta.set(id, { id, title: PHON_GROUP_TITLES[id] ?? id, hint: '' })
    order.push(id)
  }
  const groups = []
  for (const id of order) {
    const rows = []
    for (let index = 0; index < phonemes.length; index += 1) {
      const item = phonemes[index]
      if ((String(item?.group ?? '').trim() || 'other') !== id) continue
      rows.push({ key: `${index}-${String(item?.id ?? item?.ipa ?? '')}`, index, phoneme: item })
    }
    if (rows.length > 0) groups.push({ ...meta.get(id), rows })
  }
  return groups
}

function PhoneticsPage() {
  const state = usePhonetics()
  const phonetics = state.data?.phonetics ?? null

  const phonemeList = Array.isArray(phonetics?.phonemes) ? phonetics.phonemes : []
  const phonicsList = Array.isArray(phonetics?.phonics) ? phonetics.phonics : []
  const pairs = Array.isArray(phonetics?.minimalPairs) ? phonetics.minimalPairs : []
  const syllableRules = Array.isArray(phonetics?.syllableRules) ? phonetics.syllableRules : []

  const [section, setSection] = useState('phonemes')
  const [selected, setSelected] = useState(0)
  const [phonicsQuery, setPhonicsQuery] = useState('')
  const [pairOrder, setPairOrder] = useState(null)
  const [pairFocus, setPairFocus] = useState(null)

  const phonemeRef = useRef(null)
  const phonicsRef = useRef(null)
  const pairsRef = useRef(null)
  const detailRef = useRef(null)

  const groups = useMemo(() => phonGroupsOf(phonetics), [phonetics])

  const phonicsRows = useMemo(() => {
    const keyword = phonicsQuery.trim().toLowerCase()
    if (keyword === '') return phonicsList
    return phonicsList.filter((rule) => {
      if (rule === null || typeof rule !== 'object') return false
      const haystack = `${rule.grapheme ?? ''} ${rule.sound ?? ''} ${rule.position ?? ''} ${rule.rule ?? ''}`.toLowerCase()
      return haystack.includes(keyword)
    })
  }, [phonicsList, phonicsQuery])

  const pairRows = useMemo(() => pairs.map((pair, index) => ({
    key: `${index}-${String(pair?.a ?? '')}-${String(pair?.b ?? '')}`,
    index,
    pair,
  })), [pairs])

  const orderedPairs = useMemo(() => {
    if (!Array.isArray(pairOrder)) return pairRows
    const lookup = new Map(pairRows.map((row) => [row.index, row]))
    const rows = []
    for (const index of pairOrder) {
      const row = lookup.get(index)
      if (row !== undefined) {
        rows.push(row)
        lookup.delete(index)
      }
    }
    for (const row of lookup.values()) rows.push(row)
    return rows
  }, [pairRows, pairOrder])

  const shufflePairs = useCallback(() => {
    if (pairRows.length === 0) return
    const order = pairRows.map((row) => row.index)
    for (let cursor = order.length - 1; cursor > 0; cursor -= 1) {
      const swap = Math.floor(Math.random() * (cursor + 1))
      const temp = order[cursor]
      order[cursor] = order[swap]
      order[swap] = temp
    }
    setPairOrder(order)
    setPairFocus(order[0])
  }, [pairRows])

  if (state.loading && phonetics === null) {
    return h('div', { className: 'nce-wrap' }, h(Loading, { text: '正在读取音标与自然拼读数据…' }))
  }
  if (state.error !== null && phonetics === null) {
    return h('div', { className: 'nce-wrap' },
      h(ErrorBox, { title: '音标数据加载失败', error: state.error, onRetry: state.reload }))
  }
  if (phonetics === null || (phonemeList.length === 0 && phonicsList.length === 0 && pairs.length === 0 && syllableRules.length === 0)) {
    return h('div', { className: 'nce-wrap' },
      h(Empty, {
        title: '还没有音标内容',
        text: '音标、自然拼读和最小对立对的数据都为空，稍后重试。',
        icon: 'headphones',
        action: h(Btn, { size: 'sm', onClick: state.reload }, '重新加载'),
      }))
  }

  const selectedIndex = phonemeList.length === 0 ? -1 : clamp(Number(selected) || 0, 0, phonemeList.length - 1)
  const selectedPhoneme = selectedIndex >= 0 ? phonemeList[selectedIndex] : null
  const focusedRow = pairFocus === null ? null : pairRows.find((row) => row.index === pairFocus) ?? null
  const focusedPair = focusedRow === null ? null : focusedRow.pair ?? null
  const introText = String(phonetics?.intro ?? '').trim() || PHON_FALLBACK_INTRO
  const stats = [
    { label: '国际音标', value: phonemeList.length, unit: '个' },
    { label: '拼读规则', value: phonicsList.length, unit: '条' },
    { label: '最小对立对', value: pairs.length, unit: '对' },
    { label: '音节规则', value: syllableRules.length, unit: '条' },
  ].filter((item) => item.value > 0)
  const phonicsQueryText = phonicsQuery.trim()

  function jumpTo(id) {
    setSection(id)
    const target = id === 'phonics' ? phonicsRef.current : id === 'pairs' ? pairsRef.current : phonemeRef.current
    if (target !== null && target !== undefined && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function pickPhoneme(index) {
    setSelected(index)
    const node = detailRef.current
    if (node !== null && node !== undefined && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  return h('div', { className: 'nce-wrap' },
    h('section', { className: 'nce-phon-intro nce-card' },
      h('div', { className: 'nce-phon-intro-main' },
        h('div', { className: 'nce-phon-eyebrow' }, 'PHONETICS & PHONICS'),
        h('h1', { className: 'nce-phon-title' }, '音标与自然拼读'),
        h('p', { className: 'nce-phon-text' }, introText),
        stats.length > 0
          ? h('div', { className: 'nce-phon-stats' },
            stats.map((item) => h('div', { key: item.label, className: 'nce-phon-stat' },
              h('div', { className: 'nce-phon-stat-value' }, item.value, h('span', { className: 'nce-phon-stat-unit' }, item.unit)),
              h('div', { className: 'nce-phon-stat-label' }, item.label))))
          : null),
      h('div', { className: 'nce-phon-intro-icon' }, Icon('headphones', 22))),
    h('div', { className: 'nce-phon-nav' },
      PHON_SECTIONS.map((item) => h(Chip, {
        key: item.id,
        active: section === item.id,
        title: `跳到${item.label}`,
        onClick: () => jumpTo(item.id),
      }, Icon(item.icon, 13), item.label))),
    h('div', { className: 'nce-phon-block', ref: phonemeRef },
      h(Section, {
        title: '音标表',
        hint: `共 ${phonemeList.length} 个国际音标 · 点击方块查看发音要点和例词`,
      },
      groups.length === 0
        ? h(Empty, { title: '还没有音标数据', text: '音标表为空，稍后重试。', icon: 'headphones' })
        : h('div', null, groups.map((group) => h('div', { key: group.id, className: 'nce-phon-group' },
          h('div', { className: 'nce-phon-group-head' },
            h('span', { className: 'nce-phon-group-title' }, group.title),
            group.hint !== '' ? h('span', { className: 'nce-phon-group-hint' }, group.hint) : null,
            h('span', { className: 'nce-phon-group-count' }, `${group.rows.length} 个`)),
          h('div', { className: 'nce-phon-grid' },
            group.rows.map((row) => h(PhonemeSquare, {
              key: row.key,
              phoneme: row.phoneme,
              active: row.index === selectedIndex,
              onClick: () => pickPhoneme(row.index),
            })))))),
      selectedPhoneme !== null
        ? h('div', { className: 'nce-phon-detail-wrap', ref: detailRef }, h(PhonemeDetail, { phoneme: selectedPhoneme }))
        : null)),
    h('div', { className: 'nce-phon-block', ref: phonicsRef },
      h(Section, {
        title: '自然拼读',
        hint: `共 ${phonicsList.length} 条字母与组合的发音规则 · 边看规则边跟读例词`,
        extra: h('div', { className: 'nce-phon-filter' },
          h('label', { className: 'nce-phon-search' },
            Icon('search', 14),
            h('input', {
              className: 'nce-phon-search-input',
              value: phonicsQuery,
              placeholder: '搜组合，如 ee / sh',
              'aria-label': '按字母组合搜索拼读规则',
              onChange: (event) => setPhonicsQuery(event.target.value),
            })),
          phonicsQueryText !== ''
            ? h('span', { className: 'nce-phon-filtercount' }, `${phonicsRows.length}/${phonicsList.length}`)
            : null),
      },
      phonicsList.length === 0
        ? h(Empty, { title: '还没有拼读规则', text: '自然拼读内容缺失，稍后重试。', icon: 'list' })
        : phonicsRows.length === 0
          ? h(Empty, { title: '没有匹配的规则', text: `没有找到包含「${phonicsQueryText}」的规则，换个字母组合试试。`, icon: 'search' })
          : h('div', { className: 'nce-phon-rules' },
            phonicsRows.map((rule, index) => h(PhonicsRuleCard, {
              key: `${index}-${String(rule?.grapheme ?? '')}`,
              rule,
            })))),
      h(Section, { title: '音节与重读', hint: '把单词拆成音节，重读音节读得更响更长' },
        syllableRules.length === 0
          ? h(Empty, { title: '还没有音节规则', text: '音节规则缺失，稍后重试。', icon: 'list' })
          : h('div', { className: 'nce-phon-syls' },
            syllableRules.map((rule, index) => h(PhonSyllableRow, {
              key: `${index}-${String(rule?.title ?? '')}`,
              rule,
              index,
            }))))),
    h('div', { className: 'nce-phon-block', ref: pairsRef },
      h(Section, {
        title: '最小对立对',
        hint: pairs.length === 0 ? '听辨两个只差一个音的单词' : `共 ${pairs.length} 对 · 点左右两个喇叭，听清差别`,
        extra: h(Btn, { size: 'sm', icon: 'refresh', onClick: shufflePairs, disabled: pairs.length === 0 }, '随机练一对'),
      },
      pairs.length === 0
        ? h(Empty, { title: '还没有最小对立对', text: '最小对立对内容缺失，稍后重试。', icon: 'flip' })
        : h('div', null,
          focusedPair !== null
            ? h(PhonPairPractice, { pair: focusedPair, onNext: shufflePairs })
            : h('p', { className: 'nce-phon-pairs-hint' }, '点右上角「随机练一对」，随机抽一对，先听再跟读。'),
          h('div', { className: 'nce-phon-pairs' },
            orderedPairs.map((row) => h(PhonPairCard, {
              key: row.key,
              pair: row.pair,
              focused: row.index === pairFocus,
            })))))))
}

function PhonemeSquare(props) {
  const phoneme = props.phoneme ?? {}
  const ipa = phonIpaText(phoneme.ipa)
  return h('button', {
    type: 'button',
    className: cx('nce-phon-sq', props.active === true && 'is-active'),
    title: String(phoneme.zh ?? '').trim() || `音标 ${ipa}`,
    'aria-pressed': props.active === true,
    onClick: props.onClick,
  },
  h('span', { className: 'nce-phon-sq-ipa nce-mono' }, ipa))
}

function PhonemeDetail(props) {
  const phoneme = props.phoneme ?? {}
  const ipa = phonIpaText(phoneme.ipa)
  const examples = phonExampleRows(phoneme.examples)
  const words = phonStringList(phoneme.words)
  const letters = String(phoneme.letters ?? '').trim()
  const tips = String(phoneme.tips ?? '').trim()
  const kind = PHON_KIND_TITLES[String(phoneme.kind ?? '')] ?? ''
  return h('div', { className: 'nce-phon-detail nce-card' },
    h('div', { className: 'nce-phon-detail-head' },
      h('span', { className: 'nce-phon-detail-ipa nce-mono' }, ipa),
      h('div', { className: 'nce-phon-detail-titles' },
        h('div', { className: 'nce-phon-detail-zh' }, String(phoneme.zh ?? '').trim() || `音标 ${ipa}`),
        letters !== ''
          ? h('div', { className: 'nce-phon-detail-letters' }, '常见字母组合：', h('span', { className: 'nce-phon-letters' }, letters))
          : null),
      kind !== '' ? h('span', { className: 'nce-phon-detail-kind' }, h(Badge, { tone: 'brand' }, kind)) : null),
    tips !== '' ? h('p', { className: 'nce-phon-detail-tips' }, tips) : null,
    examples.length > 0
      ? h('div', null,
        h('div', { className: 'nce-phon-subtitle' }, '例词'),
        h('div', { className: 'nce-phon-examples' },
          examples.map((row, index) => h(PhonetExampleRow, { key: `${index}-${row.word}`, row }))))
      : null,
    words.length > 0
      ? h('div', null,
        h('div', { className: 'nce-phon-subtitle' }, `词库例词 · ${words.length} 个`),
        h(PhonWordChips, { words }))
      : null)
}

function PhonetExampleRow(props) {
  const row = props.row ?? {}
  const compact = props.compact === true
  return h('div', { className: cx('nce-phon-ex', compact && 'is-compact') },
    h('span', { className: 'nce-phon-ex-word' }, row.word),
    row.phonetic !== '' ? h('span', { className: 'nce-phon-ex-ipa nce-mono' }, row.phonetic) : null,
    !compact && row.zh !== '' ? h('span', { className: 'nce-phon-ex-zh' }, row.zh) : null,
    h(Speaker, { text: row.word, size: 'sm', title: `朗读 ${row.word}` }))
}

function PhonWordChips(props) {
  const words = Array.isArray(props.words) ? props.words : []
  if (words.length === 0) return null
  return h('div', { className: 'nce-phon-wordchips' },
    words.map((word, index) => h('span', { key: `${index}-${word}`, className: 'nce-phon-wordchip' },
      h('span', { className: 'nce-phon-wordchip-text' }, word),
      h(Speaker, { text: word, size: 'sm', title: `朗读 ${word}` }))))
}

function PhonicsRuleCard(props) {
  const rule = props.rule ?? {}
  const examples = phonExampleRows(rule.examples)
  const position = String(rule.position ?? '').trim()
  const text = String(rule.rule ?? '').trim()
  return h('div', { className: 'nce-phon-rule nce-card' },
    h('div', { className: 'nce-phon-rule-head' },
      h('span', { className: 'nce-phon-grapheme nce-mono' }, String(rule.grapheme ?? '')),
      h('span', { className: 'nce-phon-arrow' }, '→'),
      h('span', { className: 'nce-phon-sound nce-mono' }, String(rule.sound ?? '')),
      position !== '' ? h(Badge, { tone: 'brand' }, position) : null),
    text !== '' ? h('p', { className: 'nce-phon-rule-text' }, text) : null,
    examples.length > 0
      ? h('div', { className: 'nce-phon-rule-examples' },
        examples.map((row, index) => h(PhonetExampleRow, { key: `${index}-${row.word}`, row, compact: true })))
      : null)
}

function PhonSyllableRow(props) {
  const rule = props.rule ?? {}
  const examples = phonStringList(rule.examples)
  const text = String(rule.rule ?? '').trim()
  return h('div', { className: 'nce-phon-syl' },
    h('div', { className: 'nce-phon-syl-head' },
      h('span', { className: 'nce-phon-syl-num' }, Number(props.index ?? 0) + 1),
      h('span', { className: 'nce-phon-syl-title' }, String(rule.title ?? ''))),
    text !== '' ? h('p', { className: 'nce-phon-syl-rule' }, text) : null,
    examples.length > 0 ? h(PhonWordChips, { words: examples }) : null)
}

function PhonPairWord(props) {
  const word = String(props.word ?? '').trim()
  const ipa = String(props.ipa ?? '').trim()
  return h('span', { className: 'nce-phon-pairword' },
    h('span', { className: 'nce-phon-pairword-text nce-en' }, word),
    ipa !== '' ? h('span', { className: 'nce-phon-pairword-ipa nce-mono' }, ipa) : null,
    word !== '' ? h(Speaker, { text: word, size: 'sm', title: `朗读 ${word}` }) : null)
}

function PhonPairCard(props) {
  const pair = props.pair ?? {}
  const focus = String(pair.focus ?? '').trim()
  const zh = String(pair.zh ?? '').trim()
  return h('div', { className: cx('nce-phon-pair nce-card', props.focused === true && 'is-focused') },
    h('div', { className: 'nce-phon-pair-row' },
      h(PhonPairWord, { word: pair.a, ipa: pair.ipaA }),
      h('span', { className: 'nce-phon-pair-vs' }, 'vs'),
      h(PhonPairWord, { word: pair.b, ipa: pair.ipaB })),
    h('div', { className: 'nce-phon-pair-foot' },
      focus !== '' ? h(Badge, { tone: 'brand' }, focus) : null,
      zh !== '' ? h('span', { className: 'nce-phon-pair-zh' }, zh) : null))
}

function PhonPairPractice(props) {
  const pair = props.pair ?? {}
  const focus = String(pair.focus ?? '').trim()
  const zh = String(pair.zh ?? '').trim()
  return h('div', { className: 'nce-phon-practice nce-card' },
    h('div', { className: 'nce-phon-practice-head' },
      h('span', { className: 'nce-phon-practice-kicker' }, '当前练习'),
      focus !== '' ? h(Badge, { tone: 'brand' }, focus) : null,
      h('div', { className: 'nce-phon-practice-actions' },
        h(Btn, { size: 'sm', icon: 'refresh', onClick: props.onNext }, '换一对'))),
    h('div', { className: 'nce-phon-practice-pair' },
      h(PhonPairWord, { word: pair.a, ipa: pair.ipaA }),
      h('span', { className: 'nce-phon-practice-vs' }, 'vs'),
      h(PhonPairWord, { word: pair.b, ipa: pair.ipaB })),
    zh !== '' ? h('p', { className: 'nce-phon-practice-zh' }, zh) : null)
}

addCss(`
  .nce-phon-intro {
    display: flex; align-items: flex-start; gap: 18px; padding: 20px 24px;
    background:
      radial-gradient(120% 160% at 100% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent) 0%, transparent 58%),
      var(--dsw-alias-bg-layer-1);
  }
  .nce-phon-intro-main { flex: 1; min-width: 0; }
  .nce-phon-eyebrow { font-size: 10.5px; letter-spacing: .16em; font-weight: 600; color: var(--dsw-alias-brand-primary); }
  .nce-phon-title { margin: 5px 0 0; font-size: 22px; font-weight: 680; letter-spacing: .01em; }
  .nce-phon-text { margin: 8px 0 0; max-width: 680px; font-size: 12.5px; line-height: 1.8; color: var(--dsw-alias-label-secondary); }
  .nce-phon-stats { display: flex; flex-wrap: wrap; gap: 22px; margin-top: 14px; }
  .nce-phon-stat { display: flex; flex-direction: column; gap: 1px; }
  .nce-phon-stat-value { font-size: 17px; font-weight: 680; line-height: 1.3; }
  .nce-phon-stat-unit { margin-left: 2px; font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
  .nce-phon-stat-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
  .nce-phon-intro-icon {
    flex: none; width: 42px; height: 42px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: var(--dsw-alias-brand-primary);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
  }
  .nce-phon-nav { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }

  .nce-phon-search {
    display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px;
    border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
    color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base);
  }
  .nce-phon-search-input {
    width: 150px; max-width: 100%; border: 0; outline: 0; background: transparent;
    color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px;
  }
  .nce-phon-search-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: .75; }

  .nce-phon-block { scroll-margin-top: 10px; }
  .nce-phon-block .nce-section-head { flex-wrap: wrap; }
  .nce-phon-filter { display: flex; align-items: center; gap: 8px; }
  .nce-phon-filter .nce-phon-search { height: 28px; }
  .nce-phon-filtercount { font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }

  .nce-phon-group { margin-top: 14px; }
  .nce-phon-group:first-child { margin-top: 2px; }
  .nce-phon-group-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px; flex-wrap: wrap; }
  .nce-phon-group-title { font-size: 12.5px; font-weight: 650; }
  .nce-phon-group-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
  .nce-phon-group-count { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
  .nce-phon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 7px; }
  .nce-phon-sq {
    display: flex; align-items: center; justify-content: center; height: 46px; padding: 0;
    border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px;
    background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
    font: inherit; cursor: pointer; user-select: none;
    transition: background .14s ease, border-color .14s ease, color .14s ease;
  }
  .nce-phon-sq:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
  .nce-phon-sq.is-active {
    border-color: var(--dsw-alias-brand-primary);
    color: var(--dsw-alias-brand-primary);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
  }
  .nce-phon-sq:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
  .nce-phon-sq-ipa { font-size: 14.5px; font-weight: 550; letter-spacing: .01em; }
  .nce-phon-sq.is-active .nce-phon-sq-ipa { font-weight: 650; }

  .nce-phon-detail-wrap { margin-top: 16px; }
  .nce-phon-detail { padding: 16px 18px; }
  .nce-phon-detail-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .nce-phon-detail-ipa { font-size: 26px; font-weight: 650; line-height: 1.1; color: var(--dsw-alias-brand-primary); }
  .nce-phon-detail-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .nce-phon-detail-zh { font-size: 13px; font-weight: 600; }
  .nce-phon-detail-letters { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
  .nce-phon-letters { color: var(--dsw-alias-label-primary); font-weight: 550; }
  .nce-phon-detail-kind { margin-left: auto; }
  .nce-phon-detail-tips { margin: 12px 0 0; font-size: 12.5px; line-height: 1.8; }
  .nce-phon-subtitle {
    margin: 14px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em;
    color: var(--dsw-alias-label-secondary);
  }
  .nce-phon-examples { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 3px 12px; }
  .nce-phon-ex { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 8px; border-radius: 8px; }
  .nce-phon-ex:hover { background: var(--dsw-alias-bg-layer-2); }
  .nce-phon-ex-word { font-size: 12.5px; font-weight: 550; white-space: nowrap; }
  .nce-phon-ex-ipa { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
  .nce-phon-ex-zh { flex: 1; min-width: 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nce-phon-ex.is-compact { padding: 1px 2px; gap: 5px; }
  .nce-phon-ex.is-compact .nce-phon-ex-word { font-size: 12px; }
  .nce-phon-ex.is-compact .nce-phon-ex-ipa { font-size: 10.5px; }

  .nce-phon-wordchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .nce-phon-wordchip {
    display: inline-flex; align-items: center; gap: 1px; padding: 1px 2px 1px 9px;
    border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
    background: var(--dsw-alias-bg-layer-1); font-size: 12px;
  }
  .nce-phon-wordchip-text { white-space: nowrap; }

  .nce-phon-rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 10px; }
  .nce-phon-rule { display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 13px 14px; }
  .nce-phon-rule-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .nce-phon-grapheme { font-size: 15px; font-weight: 650; }
  .nce-phon-arrow { font-size: 12px; color: var(--dsw-alias-label-secondary); opacity: .7; }
  .nce-phon-sound { font-size: 13.5px; font-weight: 600; color: var(--dsw-alias-brand-primary); }
  .nce-phon-rule-text { margin: 0; font-size: 12px; line-height: 1.75; color: var(--dsw-alias-label-secondary); }
  .nce-phon-rule-examples { display: flex; flex-wrap: wrap; gap: 0 8px; }

  .nce-phon-syls {
    border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden;
    background: var(--dsw-alias-bg-layer-1);
  }
  .nce-phon-syl { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
  .nce-phon-syl:last-child { border-bottom: 0; }
  .nce-phon-syl-head { display: flex; align-items: center; gap: 8px; }
  .nce-phon-syl-num {
    flex: none; width: 20px; height: 20px; border-radius: 6px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10.5px; font-weight: 600;
    background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  }
  .nce-phon-syl-title { font-size: 12.5px; font-weight: 600; }
  .nce-phon-syl-rule { margin: 0; font-size: 12px; line-height: 1.75; color: var(--dsw-alias-label-secondary); }

  .nce-phon-pairs-hint { margin: 8px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
  .nce-phon-pairs { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-top: 12px; }
  .nce-phon-pair { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 11px 13px; }
  .nce-phon-pair.is-focused { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary); }
  .nce-phon-pair-row { display: flex; align-items: center; gap: 8px; }
  .nce-phon-pairword { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
  .nce-phon-pairword-text { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .nce-phon-pairword-ipa { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
  .nce-phon-pair-vs { flex: none; font-size: 10.5px; color: var(--dsw-alias-label-secondary); opacity: .8; }
  .nce-phon-pair-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
  .nce-phon-pair-zh { flex: 1; min-width: 0; line-height: 1.65; }

  .nce-phon-practice {
    padding: 16px 18px;
    background:
      radial-gradient(120% 160% at 0% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent) 0%, transparent 55%),
      var(--dsw-alias-bg-layer-1);
  }
  .nce-phon-practice-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .nce-phon-practice-kicker { font-size: 10.5px; font-weight: 600; letter-spacing: .12em; color: var(--dsw-alias-brand-primary); }
  .nce-phon-practice-actions { margin-left: auto; }
  .nce-phon-practice-pair { display: flex; align-items: center; justify-content: center; gap: 22px; flex-wrap: wrap; margin-top: 12px; }
  .nce-phon-practice-pair .nce-phon-pairword { flex: 0 1 auto; }
  .nce-phon-practice-pair .nce-phon-pairword-text { font-size: 20px; }
  .nce-phon-practice-pair .nce-phon-pairword-ipa { font-size: 12px; }
  .nce-phon-practice-vs { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); }
  .nce-phon-practice-zh { margin: 10px 0 0; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); text-align: center; }

  @media (max-width: 720px) {
    .nce-phon-intro { flex-wrap: wrap; padding: 16px 16px; }
    .nce-phon-text { max-width: none; }
    .nce-phon-stats { gap: 14px; }
    .nce-phon-grid { grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); }
    .nce-phon-examples { grid-template-columns: minmax(0, 1fr); }
    .nce-phon-rules, .nce-phon-pairs { grid-template-columns: minmax(0, 1fr); }
    .nce-phon-practice-pair { gap: 12px; }
    .nce-phon-pair-foot { align-items: flex-start; }
  }
`)

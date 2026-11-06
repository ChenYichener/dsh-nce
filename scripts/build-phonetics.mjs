/**
 * 生成 dsh-nce 的音标 / 自然拼读数据：data/phonetics.json
 *
 * 内容全部手写在本文件里（便于校对与维护），脚本负责：
 *   1. 形状校验（48 个音标、分组计数、IPA 不重复、字段齐全、示例音标包含该音）；
 *   2. 自然拼读规则校验（≥20 条、音值是 48 音标之一、必需字母组合齐备）；
 *   3. 最小对立对 / 音节规则 / 导语校验；
 *   4. 若 data/wordbank.json 已生成，把每个音标的 words 过滤为词库中真实存在的词
 *      （examples 不受此限）；词库不存在或正在生成时跳过校验，稍后再跑一次即可。
 *
 * 用法：node scripts/build-phonetics.mjs
 * 纯 Node ESM，无第三方依赖；可重复执行，输出幂等（仅 generatedAt 变化）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(root, 'data', 'phonetics.json')
const wordbankFile = path.join(root, 'data', 'wordbank.json')

// ---------------------------------------------------------------------------
// 小工具：把 [word, phonetic, zh] 元组转成契约里的对象
// ---------------------------------------------------------------------------
const ex = (...items) => items.map(([word, phonetic, zh]) => ({ word, phonetic, zh }))

const ph = (id, ipa, group, kind, zh, letters, tips, examples, words) => ({
  id,
  ipa,
  group,
  kind,
  zh,
  letters,
  tips,
  examples: ex(...examples),
  words,
})

const rule = (id, grapheme, position, sound, text, examples) => ({
  id,
  grapheme,
  position,
  sound,
  rule: text,
  examples: ex(...examples),
})

const mp = (a, ipaA, b, ipaB, focus, zh) => ({ a, b, ipaA, ipaB, focus, zh })

// ---------------------------------------------------------------------------
// 页面导语 + 分组
// ---------------------------------------------------------------------------
const INTRO =
  '英语的 48 个音标就像汉语拼音：学会它，看到音标就能把单词读出来。' +
  '先分清短元音和长元音，再记住常见辅音，最后用自然拼读把字母和声音对上号。' +
  '每天挑几组最小对立对跟读（比如 ship 和 sheep），耳朵和嘴巴会一起进步。'

const GROUPS = [
  { id: 'vowels', title: '元音', hint: '12 个单元音：7 个短元音 + 5 个长元音' },
  { id: 'diphthongs', title: '双元音', hint: '8 个双元音：由两个元音滑动合成' },
  { id: 'consonants', title: '辅音', hint: '28 个辅音：清辅音、浊辅音、鼻音、半元音等' },
]

// ---------------------------------------------------------------------------
// 48 个音标（20 元音 = 12 单元音 + 8 双元音；28 辅音）
// ---------------------------------------------------------------------------
const PHONEMES = [
  // ----- 元音：7 个短元音 ---------------------------------------------------
  ph(
    'short-i', 'ɪ', 'vowels', 'short', '短元音 /ɪ/', 'i, y, e',
    '短音 i：嘴角微微向两边，声音短而松，像中文「衣」但更短、更放松。',
    [
      ['sit', '/sɪt/', '坐'],
      ['big', '/bɪɡ/', '大的'],
      ['fish', '/fɪʃ/', '鱼'],
    ],
    ['is', 'this', 'it', 'big', 'miss', 'film', 'milk', 'English'],
  ),
  ph(
    'short-e', 'e', 'vowels', 'short', '短元音 /e/', 'e, ea, a',
    '短音 e：嘴半开，舌尖抵住下齿，读得像「诶」但短促，不要拖长。',
    [
      ['pen', '/pen/', '钢笔'],
      ['bed', '/bed/', '床'],
      ['ten', '/ten/', '十'],
    ],
    ['pen', 'pencil', 'dress', 'bed', 'desk', 'red', 'fresh', 'friend'],
  ),
  ph(
    'short-a', 'æ', 'vowels', 'short', '短元音 /æ/', 'a',
    '短音 a：嘴张大、下巴放低，舌尖抵下齿，介于「啊」和「哎」之间。',
    [
      ['cat', '/kæt/', '猫'],
      ['hand', '/hænd/', '手'],
      ['bag', '/bæɡ/', '包'],
    ],
    ['handbag', 'hand', 'hat', 'cat', 'bad', 'black', 'apple', 'family'],
  ),
  ph(
    'short-u', 'ʌ', 'vowels', 'short', '短元音 /ʌ/', 'u, o, ou, oo',
    '短音 u：口型放松、嘴微张，短促有力，像轻轻的一声「啊」。',
    [
      ['cup', '/kʌp/', '杯子'],
      ['bus', '/bʌs/', '公共汽车'],
      ['sun', '/sʌn/', '太阳'],
    ],
    ['cup', 'run', 'sun', 'come', 'mother', 'brother', 'money', 'lunch'],
  ),
  ph(
    'short-o', 'ɒ', 'vowels', 'short', '短元音 /ɒ/', 'o, a',
    '短音 o（英式）：嘴张大、嘴唇稍圆，声音短促，像 hot 里的 o。',
    [
      ['hot', '/hɒt/', '热的'],
      ['dog', '/dɒɡ/', '狗'],
      ['box', '/bɒks/', '盒子'],
    ],
    ['box', 'hot', 'dog', 'watch', 'shop', 'job', 'bottle', 'sorry'],
  ),
  ph(
    'short-oo', 'ʊ', 'vowels', 'short', '短元音 /ʊ/', 'oo, u, ou',
    '短音 oo：嘴唇收圆但放松，声音短，像「乌」但不拖长。',
    [
      ['book', '/bʊk/', '书'],
      ['good', '/ɡʊd/', '好的'],
      ['look', '/lʊk/', '看'],
    ],
    ['book', 'good', 'look', 'full', 'put', 'sugar'],
  ),
  ph(
    'schwa', 'ə', 'vowels', 'short', '弱读元音 /ə/（schwa）', 'a, e, i, o, u, er, or',
    '最放松的弱读音：轻轻「呃」一声，常出现在非重读音节里，不要读重。',
    [
      ['about', '/əˈbaʊt/', '关于'],
      ['teacher', '/ˈtiːtʃə/', '老师'],
      ['sofa', '/ˈsəʊfə/', '沙发'],
    ],
    ['teacher', 'sister', 'brother', 'mother', 'father', 'doctor', 'banana', 'colour'],
  ),

  // ----- 元音：5 个长元音 ---------------------------------------------------
  ph(
    'long-ee', 'iː', 'vowels', 'long', '长元音 /iː/', 'ee, ea, e, ie',
    '长音 i：嘴角向两边拉开，舌头抬高，声音拉长，像「衣——」。',
    [
      ['see', '/siː/', '看见'],
      ['tea', '/tiː/', '茶'],
      ['green', '/ɡriːn/', '绿色的'],
    ],
    ['see', 'tea', 'green', 'tree', 'please', 'meet', 'Chinese', 'eat'],
  ),
  ph(
    'long-ar', 'ɑː', 'vowels', 'long', '长元音 /ɑː/', 'ar, a, al, ear',
    '长音 a：嘴张大、舌位靠后，拖长音，像医生看喉咙时的「啊——」。',
    [
      ['car', '/kɑː/', '小汽车'],
      ['park', '/pɑːk/', '公园'],
      ['father', '/ˈfɑːðə/', '父亲'],
    ],
    ['car', 'father', 'garden', 'grass', 'ask', 'bath', 'card', 'bar'],
  ),
  ph(
    'long-or', 'ɔː', 'vowels', 'long', '长元音 /ɔː/', 'or, ore, oar, aw, au, al',
    '长音 o：嘴唇收圆、稍微前突，拖长，像「哦——」。',
    [
      ['door', '/dɔː/', '门'],
      ['four', '/fɔː/', '四'],
      ['ball', '/bɔːl/', '球'],
    ],
    ['door', 'morning', 'tall', 'short', 'walk', 'floor', 'small', 'talk'],
  ),
  ph(
    'long-oo', 'uː', 'vowels', 'long', '长元音 /uː/', 'oo, u, ue, ew, ou',
    '长音 u：嘴唇收圆前突，像吹气一样，拖长，像「乌——」。',
    [
      ['food', '/fuːd/', '食物'],
      ['moon', '/muːn/', '月亮'],
      ['school', '/skuːl/', '学校'],
    ],
    ['school', 'too', 'food', 'afternoon', 'room', 'blue', 'suit', 'fruit'],
  ),
  ph(
    'long-er', 'ɜː', 'vowels', 'long', '长元音 /ɜː/', 'er, ir, ur, or, ear',
    '长音 er：嘴唇放松、舌位在中间，拖长，像「呃——」，英式发音里很常见。',
    [
      ['bird', '/bɜːd/', '鸟'],
      ['girl', '/ɡɜːl/', '女孩'],
      ['nurse', '/nɜːs/', '护士'],
    ],
    ['person', 'nurse', 'shirt', 'bird', 'early', 'dirty', 'thirsty', 'world'],
  ),

  // ----- 8 个双元音 ---------------------------------------------------------
  ph(
    'dip-ei', 'eɪ', 'diphthongs', 'diphthong', '双元音 /eɪ/', 'a_e, ai, ay, ea, eigh',
    '先发 /e/，再滑到 /ɪ/，两个音连在一起，像「诶-衣」。',
    [
      ['name', '/neɪm/', '名字'],
      ['day', '/deɪ/', '天'],
      ['cake', '/keɪk/', '蛋糕'],
    ],
    ['name', 'make', 'cake', 'day', 'play', 'rain', 'wait', 'grey'],
  ),
  ph(
    'dip-ai', 'aɪ', 'diphthongs', 'diphthong', '双元音 /aɪ/', 'i_e, i, y, igh, ie',
    '先发「啊」，再滑到 /ɪ/，像「啊-衣」，就是字母 I 的读音。',
    [
      ['my', '/maɪ/', '我的'],
      ['time', '/taɪm/', '时间'],
      ['five', '/faɪv/', '五'],
    ],
    ['my', 'five', 'time', 'right', 'light', 'night', 'white', 'fine'],
  ),
  ph(
    'dip-oi', 'ɔɪ', 'diphthongs', 'diphthong', '双元音 /ɔɪ/', 'oi, oy',
    '先发 /ɔ/，再滑到 /ɪ/，像「哦-衣」，boy 里的元音。',
    [
      ['boy', '/bɔɪ/', '男孩'],
      ['toy', '/tɔɪ/', '玩具'],
      ['voice', '/vɔɪs/', '声音'],
    ],
    ['boy', 'choice', 'noise', 'voice', 'coin', 'boil', 'enjoy'],
  ),
  ph(
    'dip-au', 'aʊ', 'diphthongs', 'diphthong', '双元音 /aʊ/', 'ou, ow',
    '先发「啊」，再滑到 /ʊ/，像「啊-乌」，嘴巴从大到小。',
    [
      ['now', '/naʊ/', '现在'],
      ['house', '/haʊs/', '房子'],
      ['out', '/aʊt/', '外面'],
    ],
    ['house', 'now', 'how', 'town', 'crowd', 'mouth', 'south', 'flower'],
  ),
  ph(
    'dip-ou', 'əʊ', 'diphthongs', 'diphthong', '双元音 /əʊ/', 'o_e, o, oa, ow, oe',
    '先发 /ə/，再滑到 /ʊ/，像「呃-乌」，就是英式 no 的元音。',
    [
      ['no', '/nəʊ/', '不'],
      ['home', '/həʊm/', '家'],
      ['go', '/ɡəʊ/', '走'],
    ],
    ['home', 'go', 'cold', 'old', 'open', 'show', 'snow', 'road'],
  ),
  ph(
    'dip-ear', 'ɪə', 'diphthongs', 'diphthong', '双元音 /ɪə/', 'ear, eer, ere, ea',
    '先发 /ɪ/，再滑到 /ə/，像「衣-呃」，ear 里的音。',
    [
      ['ear', '/ɪə/', '耳朵'],
      ['near', '/nɪə/', '靠近'],
      ['here', '/hɪə/', '这里'],
    ],
    ['hear', 'near', 'nearly', 'here', 'year'],
  ),
  ph(
    'dip-air', 'eə', 'diphthongs', 'diphthong', '双元音 /eə/', 'air, are, ear, ere',
    '先发 /e/，再滑到 /ə/，像「诶-呃」，air 里的音。',
    [
      ['hair', '/heə/', '头发'],
      ['there', '/ðeə/', '那里'],
      ['care', '/keə/', '关心'],
    ],
    ['armchair', 'haircut', 'hairdresser', 'pair', 'careful', 'where', 'air', 'pear'],
  ),
  ph(
    'dip-ure', 'ʊə', 'diphthongs', 'diphthong', '双元音 /ʊə/', 'our, ure, oor',
    '先发 /ʊ/，再滑到 /ə/，像「乌-呃」，tour 里的音，现代口语里常弱化成 /ɔː/。',
    [
      ['tour', '/tʊə/', '旅行'],
      ['pure', '/pjʊə/', '纯净的'],
      ['sure', '/ʃʊə/', '确信的'],
    ],
    ['tourist', 'curiously', 'sure', 'pure'],
  ),

  // ----- 28 个辅音 ----------------------------------------------------------
  ph(
    'p', 'p', 'consonants', 'voiceless', '清辅音 /p/', 'p, pp',
    '双唇紧闭再突然放开，送气；手放在嘴前能感到一股气流。',
    [
      ['pen', '/pen/', '钢笔'],
      ['cup', '/kʌp/', '杯子'],
      ['apple', '/ˈæpl/', '苹果'],
    ],
    ['pen', 'pencil', 'please', 'party', 'pocket', 'passport', 'shop', 'cup'],
  ),
  ph(
    'b', 'b', 'consonants', 'voiced', '浊辅音 /b/', 'b, bb',
    '口型同 /p/，但要振动声带，不送气，像压低声音的「波」。',
    [
      ['book', '/bʊk/', '书'],
      ['bag', '/bæɡ/', '包'],
      ['big', '/bɪɡ/', '大的'],
    ],
    ['book', 'big', 'black', 'box', 'bottle', 'bed', 'banana', 'handbag'],
  ),
  ph(
    't', 't', 'consonants', 'voiceless', '清辅音 /t/', 't, tt, ed',
    '舌尖抵住上齿龈再迅速弹开，送气，像「特」但轻而短。',
    [
      ['tea', '/tiː/', '茶'],
      ['cat', '/kæt/', '猫'],
      ['time', '/taɪm/', '时间'],
    ],
    ['tea', 'teacher', 'table', 'ticket', 'today', 'town', 'tree', 'time'],
  ),
  ph(
    'd', 'd', 'consonants', 'voiced', '浊辅音 /d/', 'd, dd, ed',
    '口型同 /t/，但要振动声带，不送气，像「的」但更轻。',
    [
      ['door', '/dɔː/', '门'],
      ['dog', '/dɒɡ/', '狗'],
      ['bed', '/bed/', '床'],
    ],
    ['dog', 'door', 'desk', 'day', 'dirty', 'doctor', 'dress', 'daughter'],
  ),
  ph(
    'k', 'k', 'consonants', 'voiceless', '清辅音 /k/', 'k, c, ck, ch, q',
    '舌根抵住软腭再放开，送气，像「克」；字母 c、k、ck 都可能读它。',
    [
      ['cat', '/kæt/', '猫'],
      ['key', '/kiː/', '钥匙'],
      ['school', '/skuːl/', '学校'],
    ],
    ['car', 'cake', 'cat', 'coat', 'key', 'kitchen', 'milk', 'book'],
  ),
  ph(
    'g', 'ɡ', 'consonants', 'voiced', '浊辅音 /ɡ/', 'g, gg',
    '口型同 /k/，但要振动声带，不送气，像「哥」但更轻。',
    [
      ['girl', '/ɡɜːl/', '女孩'],
      ['bag', '/bæɡ/', '包'],
      ['go', '/ɡəʊ/', '走'],
    ],
    ['good', 'garden', 'go', 'glass', 'green', 'grass', 'dog', 'big'],
  ),
  ph(
    'f', 'f', 'consonants', 'voiceless', '清辅音 /f/', 'f, ff, ph, gh',
    '上齿轻轻咬住下唇，让气从缝隙里摩擦出来，像「夫」但不振动声带。',
    [
      ['five', '/faɪv/', '五'],
      ['fish', '/fɪʃ/', '鱼'],
      ['four', '/fɔː/', '四'],
    ],
    ['five', 'floor', 'fine', 'father', 'family', 'film', 'food', 'fruit'],
  ),
  ph(
    'v', 'v', 'consonants', 'voiced', '浊辅音 /v/', 'v, f',
    '口型同 /f/，但要振动声带，上齿可以感到轻微震动。',
    [
      ['very', '/ˈveri/', '非常'],
      ['five', '/faɪv/', '五'],
      ['love', '/lʌv/', '爱'],
    ],
    ['five', 'drive', 'village', 'lovely', 'give', 'wave', 'heavy', 'television'],
  ),
  ph(
    'th', 'θ', 'consonants', 'voiceless', '清辅音 /θ/', 'th',
    '舌尖轻轻放在上下齿之间，送气，让气从舌尖和牙齿的缝隙出来，别读成 /s/。',
    [
      ['thank', '/θæŋk/', '感谢'],
      ['three', '/θriː/', '三'],
      ['mouth', '/maʊθ/', '嘴'],
    ],
    ['thing', 'thin', 'thirsty', 'mouth', 'tooth', 'bath'],
  ),
  ph(
    'dh', 'ð', 'consonants', 'voiced', '浊辅音 /ð/', 'th',
    '口型同 /θ/，但要振动声带；this、that、the 开头的 th 就是这个音。',
    [
      ['this', '/ðɪs/', '这个'],
      ['father', '/ˈfɑːðə/', '父亲'],
      ['mother', '/ˈmʌðə/', '母亲'],
    ],
    ['this', 'these', 'brother', 'mother', 'father', 'weather', 'together'],
  ),
  ph(
    's', 's', 'consonants', 'voiceless', '清辅音 /s/', 's, ss, c, ce',
    '舌尖靠近上齿龈，留一条窄缝让气挤出来，像「丝」，不振动声带。',
    [
      ['see', '/siː/', '看见'],
      ['sun', '/sʌn/', '太阳'],
      ['house', '/haʊs/', '房子'],
    ],
    ['see', 'sun', 'sir', 'sorry', 'sister', 'small', 'sky', 'snow'],
  ),
  ph(
    'z', 'z', 'consonants', 'voiced', '浊辅音 /z/', 'z, s, ss, se',
    '口型同 /s/，但要振动声带，像蜜蜂「嗡嗡」的尾音。',
    [
      ['zoo', '/zuː/', '动物园'],
      ['is', '/ɪz/', '是'],
      ['rose', '/rəʊz/', '玫瑰'],
    ],
    ['is', 'size', 'noise', 'please', 'Chinese', 'these', 'busy', 'glasses'],
  ),
  ph(
    'sh', 'ʃ', 'consonants', 'voiceless', '清辅音 /ʃ/', 'sh, ch, ti, ci, ss',
    '嘴唇稍圆前突，舌面抬起靠近硬腭，像让人安静时的「嘘」。',
    [
      ['she', '/ʃiː/', '她'],
      ['ship', '/ʃɪp/', '轮船'],
      ['fish', '/fɪʃ/', '鱼'],
    ],
    ['ship', 'shop', 'short', 'shirt', 'shoe', 'sugar', 'sure', 'English'],
  ),
  ph(
    'zh', 'ʒ', 'consonants', 'voiced', '浊辅音 /ʒ/', 's, z, g, j',
    '口型同 /ʃ/，但要振动声带；这是英语里比较少的音，多出现在外来词里。',
    [
      ['pleasure', '/ˈpleʒə/', '乐趣'],
      ['usually', '/ˈjuːʒuəli/', '通常'],
      ['measure', '/ˈmeʒə/', '测量'],
    ],
    ['television', 'usually', 'garage'],
  ),
  ph(
    'h', 'h', 'consonants', 'voiceless', '清辅音 /h/', 'h, wh',
    '张开嘴轻轻哈气，像冬天哈气暖手，不要磨得太用力。',
    [
      ['hand', '/hænd/', '手'],
      ['hat', '/hæt/', '帽子'],
      ['house', '/haʊs/', '房子'],
    ],
    ['hand', 'hat', 'house', 'hot', 'hello', 'holiday', 'home', 'handbag'],
  ),
  ph(
    'ch', 'tʃ', 'consonants', 'voiceless', '清辅音 /tʃ/', 'ch, tch, t',
    '先像 /t/ 那样抵住，再迅速放开滑到 /ʃ/，一次发出，像「吃」但不卷舌。',
    [
      ['chair', '/tʃeə/', '椅子'],
      ['teacher', '/ˈtiːtʃə/', '老师'],
      ['child', '/tʃaɪld/', '孩子'],
    ],
    ['watch', 'teacher', 'China', 'Chinese', 'chicken', 'cheese', 'chocolate', 'church'],
  ),
  ph(
    'dj', 'dʒ', 'consonants', 'voiced', '浊辅音 /dʒ/', 'j, g, dge, dg',
    '口型同 /tʃ/，但要振动声带，像「知」但不卷舌。',
    [
      ['job', '/dʒɒb/', '工作'],
      ['age', '/eɪdʒ/', '年龄'],
      ['orange', '/ˈɒrɪndʒ/', '橙子'],
    ],
    ['job', 'orange', 'January', 'June', 'July', 'German', 'bridge', 'village'],
  ),
  ph(
    'tr', 'tr', 'consonants', 'voiceless', '清辅音 /tr/', 'tr',
    '舌尖抬向上齿龈后部、不接触；/t/ 和 /r/ 快速连读成一个音，像「戳」但不卷舌。',
    [
      ['tree', '/triː/', '树'],
      ['train', '/treɪn/', '火车'],
      ['try', '/traɪ/', '尝试'],
    ],
    ['tree', 'trousers', 'tram', 'travel', 'trip'],
  ),
  ph(
    'dr', 'dr', 'consonants', 'voiced', '浊辅音 /dr/', 'dr',
    '/d/ 和 /r/ 快速连读成一个音，振动声带，像「桌」但不卷舌。',
    [
      ['dress', '/dres/', '连衣裙'],
      ['drink', '/drɪŋk/', '喝'],
      ['dream', '/driːm/', '梦'],
    ],
    ['dress', 'drink', 'drive', 'dream'],
  ),
  ph(
    'ts', 'ts', 'consonants', 'voiceless', '清辅音 /ts/', 'ts, tes',
    '/t/ 和 /s/ 快速连读，像「次」；名词复数 -ts 结尾常读这个音。',
    [
      ['cats', '/kæts/', '猫（复数）'],
      ['hats', '/hæts/', '帽子（复数）'],
      ['students', '/ˈstjuːdənts/', '学生（复数）'],
    ],
    ['cats', 'students', 'tickets', 'hats'],
  ),
  ph(
    'dz', 'dz', 'consonants', 'voiced', '浊辅音 /dz/', 'ds, des',
    '/d/ 和 /z/ 快速连读，振动声带；名词复数 -ds 结尾常读这个音。',
    [
      ['beds', '/bedz/', '床（复数）'],
      ['hands', '/hændz/', '手（复数）'],
      ['friends', '/frendz/', '朋友（复数）'],
    ],
    ['beds', 'hands', 'friends', 'words'],
  ),
  ph(
    'm', 'm', 'consonants', 'nasal', '鼻音 /m/', 'm, mm, mb',
    '双唇闭合，气流从鼻子出来，像闭着嘴发出的「嗯」。',
    [
      ['man', '/mæn/', '男人'],
      ['mother', '/ˈmʌðə/', '母亲'],
      ['come', '/kʌm/', '来'],
    ],
    ['man', 'mother', 'milk', 'morning', 'mum', 'match', 'room', 'home'],
  ),
  ph(
    'n', 'n', 'consonants', 'nasal', '鼻音 /n/', 'n, nn, kn, gn',
    '舌尖抵住上齿龈，气流从鼻子出来，像「嗯」但舌尖在上齿龈。',
    [
      ['name', '/neɪm/', '名字'],
      ['no', '/nəʊ/', '不'],
      ['pen', '/pen/', '钢笔'],
    ],
    ['name', 'number', 'near', 'nurse', 'night', 'new', 'nice', 'son'],
  ),
  ph(
    'ng', 'ŋ', 'consonants', 'nasal', '鼻音 /ŋ/', 'ng, nk, n',
    '舌根抵住软腭，气流从鼻子出来；词尾 -ing 的尾音就是这个，不要读成 /n/。',
    [
      ['sing', '/sɪŋ/', '唱歌'],
      ['English', '/ˈɪŋɡlɪʃ/', '英语'],
      ['thank', '/θæŋk/', '感谢'],
    ],
    ['English', 'morning', 'spring', 'thing', 'shopping', 'evening', 'long', 'young'],
  ),
  ph(
    'l', 'l', 'consonants', 'liquid', '浊辅音 /l/（舌侧音）', 'l, ll, le',
    '舌尖抵住上齿龈，气流从舌头两侧出来，像「了」但舌尖要顶住。',
    [
      ['look', '/lʊk/', '看'],
      ['girl', '/ɡɜːl/', '女孩'],
      ['table', '/ˈteɪbl/', '桌子'],
    ],
    ['look', 'light', 'letter', 'little', 'large', 'lake', 'left', 'lovely'],
  ),
  ph(
    'r', 'r', 'consonants', 'liquid', '浊辅音 /r/', 'r, rr, wr',
    '舌尖抬向上齿龈后部、不接触，舌身略收；英式 /r/ 是近音，不卷舌，像「若」的开头但更轻。',
    [
      ['red', '/red/', '红色的'],
      ['right', '/raɪt/', '右边'],
      ['room', '/ruːm/', '房间'],
    ],
    ['red', 'right', 'room', 'rain', 'read', 'road', 'run', 'restaurant'],
  ),
  ph(
    'y', 'j', 'consonants', 'glide', '半元音 /j/', 'y, i, u, ew',
    '舌面抬向硬腭再迅速滑向元音，就是 yes 开头的音，像很短的「衣」。',
    [
      ['yes', '/jes/', '是'],
      ['you', '/juː/', '你'],
      ['year', '/jɪə/', '年'],
    ],
    ['yes', 'your', 'year', 'yellow', 'young', 'new'],
  ),
  ph(
    'w', 'w', 'consonants', 'glide', '半元音 /w/', 'w, wh, u',
    '双唇收圆前突再迅速滑向元音，就是 we 开头的音，像很短的「乌」。',
    [
      ['we', '/wiː/', '我们'],
      ['what', '/wɒt/', '什么'],
      ['window', '/ˈwɪndəʊ/', '窗户'],
    ],
    ['what', 'where', 'white', 'window', 'woman', 'watch', 'week', 'well'],
  ),
]

// ---------------------------------------------------------------------------
// 自然拼读规则（字母 / 字母组合 → 音）
// ---------------------------------------------------------------------------
const PHONICS = [
  // 闭音节短元音
  rule('short-a', 'a', '闭音节（CVC）', '/æ/',
    'a 在闭音节（后面跟辅音收尾）里读短音 /æ/：cat、hand、bag。',
    [['cat', '/kæt/', '猫'], ['bag', '/bæɡ/', '包'], ['hand', '/hænd/', '手']]),
  rule('short-e', 'e', '闭音节（CVC）', '/e/',
    'e 在闭音节里读短音 /e/：p-e-n → pen。',
    [['pen', '/pen/', '钢笔'], ['bed', '/bed/', '床'], ['ten', '/ten/', '十']]),
  rule('short-i', 'i', '闭音节（CVC）', '/ɪ/',
    'i 在闭音节里读短音 /ɪ/：s-i-t → sit。',
    [['sit', '/sɪt/', '坐'], ['big', '/bɪɡ/', '大的'], ['fish', '/fɪʃ/', '鱼']]),
  rule('short-o', 'o', '闭音节（CVC）', '/ɒ/',
    'o 在闭音节里读短音 /ɒ/（英式）：h-o-t → hot。',
    [['hot', '/hɒt/', '热的'], ['dog', '/dɒɡ/', '狗'], ['box', '/bɒks/', '盒子']]),
  rule('short-u', 'u', '闭音节（CVC）', '/ʌ/',
    'u 在闭音节里读短音 /ʌ/：c-u-p → cup。',
    [['cup', '/kʌp/', '杯子'], ['bus', '/bʌs/', '公共汽车'], ['sun', '/sʌn/', '太阳']]),

  // 开音节 / magic e
  rule('magic-e-a', 'a_e', '词尾 magic e（开音节）', '/eɪ/',
    '词尾的 e 不发音，却让前面的 a 读字母本音 /eɪ/：c-a-k-e → cake。',
    [['name', '/neɪm/', '名字'], ['cake', '/keɪk/', '蛋糕'], ['plane', '/pleɪn/', '飞机']]),
  rule('magic-e-i', 'i_e', '词尾 magic e（开音节）', '/aɪ/',
    '词尾的 e 不发音，让前面的 i 读字母本音 /aɪ/：t-i-m-e → time。',
    [['time', '/taɪm/', '时间'], ['five', '/faɪv/', '五'], ['bike', '/baɪk/', '自行车']]),
  rule('magic-e-o', 'o_e', '词尾 magic e（开音节）', '/əʊ/',
    '词尾的 e 不发音，让前面的 o 读字母本音 /əʊ/：h-o-m-e → home。',
    [['home', '/həʊm/', '家'], ['nose', '/nəʊz/', '鼻子'], ['hope', '/həʊp/', '希望']]),
  rule('magic-e-u', 'u_e', '词尾 magic e（开音节）', '/juː/',
    '词尾的 e 不发音，前面的 u 多读 /juː/：c-u-t-e → cute；在 l、r、s、j 后常读 /uː/：rule /ruːl/、June /dʒuːn/。',
    [['cute', '/kjuːt/', '可爱的'], ['use', '/juːz/', '使用'], ['mule', '/mjuːl/', '骡子']]),
  rule('magic-e-e', 'e_e', '词尾 magic e（开音节）', '/iː/',
    '词尾的 e 不发音，让前面的 e 读字母本音 /iː/：t-h-e-s-e → these。',
    [['these', '/ðiːz/', '这些'], ['scene', '/siːn/', '场景'], ['complete', '/kəmˈpliːt/', '完成']]),

  // 元音字母组合
  rule('ee', 'ee', '词中 / 词尾', '/iː/',
    'ee 几乎总读长音 /iː/：s-ee → see。',
    [['see', '/siː/', '看见'], ['green', '/ɡriːn/', '绿色的'], ['tree', '/triː/', '树']]),
  rule('ea', 'ea', '词中 / 词尾', '/iː/',
    'ea 多数读长音 /iː/：t-ea → tea；少数读 /e/：head /hed/、bread /bred/。',
    [['tea', '/tiː/', '茶'], ['read', '/riːd/', '读'], ['clean', '/kliːn/', '干净的']]),
  rule('ai', 'ai', '词中', '/eɪ/',
    'ai 在词中间读 /eɪ/：r-ai-n → rain。',
    [['rain', '/reɪn/', '雨'], ['train', '/treɪn/', '火车'], ['wait', '/weɪt/', '等待']]),
  rule('ay', 'ay', '词尾', '/eɪ/',
    'ay 在词尾读 /eɪ/：d-ay → day。',
    [['day', '/deɪ/', '天'], ['play', '/pleɪ/', '玩'], ['today', '/təˈdeɪ/', '今天']]),
  rule('oa', 'oa', '词中', '/əʊ/',
    'oa 读 /əʊ/：c-oa-t → coat。',
    [['coat', '/kəʊt/', '外套'], ['boat', '/bəʊt/', '小船'], ['road', '/rəʊd/', '路']]),
  rule('oo-long', 'oo', '词中 / 词尾', '/uː/',
    '多数 oo 读长音 /uː/：f-oo-d → food。',
    [['food', '/fuːd/', '食物'], ['moon', '/muːn/', '月亮'], ['school', '/skuːl/', '学校']]),
  rule('oo-short', 'oo', '在 k、d 前', '/ʊ/',
    'oo 在 k 前常读短音 /ʊ/：b-oo-k → book；在 d 前不稳定：good、wood 读 /ʊ/，food、noodle 读 /uː/。',
    [['book', '/bʊk/', '书'], ['good', '/ɡʊd/', '好的'], ['look', '/lʊk/', '看']]),
  rule('ou-au', 'ou', '词首 / 词中', '/aʊ/',
    'ou 常读 /aʊ/：h-ou-se → house。',
    [['house', '/haʊs/', '房子'], ['out', '/aʊt/', '外面'], ['mouth', '/maʊθ/', '嘴']]),
  rule('ou-u', 'ou', '少数词', '/ʌ/',
    '少数 ou 读短音 /ʌ/：c-ou-ntry → country、y-ou-ng → young。',
    [['country', '/ˈkʌntri/', '国家'], ['young', '/jʌŋ/', '年轻的'], ['enough', '/ɪˈnʌf/', '足够的']]),
  rule('ow-au', 'ow', '词尾 / 词中', '/aʊ/',
    'ow 在词尾或词中多读 /aʊ/：n-ow → now、h-ow → how。',
    [['now', '/naʊ/', '现在'], ['how', '/haʊ/', '怎样'], ['flower', '/ˈflaʊə/', '花']]),
  rule('ow-ou', 'ow', '词尾', '/əʊ/',
    'ow 在词尾常读 /əʊ/：sn-ow → snow、wind-ow → window。',
    [['snow', '/snəʊ/', '雪'], ['window', '/ˈwɪndəʊ/', '窗户'], ['yellow', '/ˈjeləʊ/', '黄色的']]),
  rule('oi', 'oi', '词首 / 词中', '/ɔɪ/',
    'oi 在词中间读 /ɔɪ/：c-oi-n → coin。',
    [['oil', '/ɔɪl/', '油'], ['coin', '/kɔɪn/', '硬币'], ['voice', '/vɔɪs/', '声音']]),
  rule('oy', 'oy', '词尾', '/ɔɪ/',
    'oy 在词尾读 /ɔɪ/：b-oy → boy。',
    [['boy', '/bɔɪ/', '男孩'], ['toy', '/tɔɪ/', '玩具'], ['enjoy', '/ɪnˈdʒɔɪ/', '享受']]),

  // r 音节
  rule('ar', 'ar', '词中 / 词尾', '/ɑː/',
    'ar 读长音 /ɑː/：c-ar → car；在 w 后面常读 /ɔː/：warm /wɔːm/。',
    [['car', '/kɑː/', '小汽车'], ['park', '/pɑːk/', '公园'], ['card', '/kɑːd/', '卡片']]),
  rule('or', 'or', '词中 / 词尾', '/ɔː/',
    'or 在重读音节通常读 /ɔː/：f-or-k → fork；w 后常读 /ɜː/（word、work、world），非重读常读 /ə/（doctor、actor）。',
    [['fork', '/fɔːk/', '叉子'], ['horse', '/hɔːs/', '马'], ['short', '/ʃɔːt/', '短的']]),
  rule('er', 'er', '词尾（非重读）', '/ə/',
    '词尾 -er 通常弱读成 /ə/：teach-er → teacher；重读时读 /ɜː/：term /tɜːm/。',
    [['teacher', '/ˈtiːtʃə/', '老师'], ['sister', '/ˈsɪstə/', '姐妹'], ['father', '/ˈfɑːðə/', '父亲']]),
  rule('ir', 'ir', '词中', '/ɜː/',
    'ir 读长音 /ɜː/：g-ir-l → girl。',
    [['girl', '/ɡɜːl/', '女孩'], ['bird', '/bɜːd/', '鸟'], ['shirt', '/ʃɜːt/', '衬衫']]),
  rule('ur', 'ur', '词中', '/ɜː/',
    'ur 读长音 /ɜː/：n-ur-se → nurse。',
    [['nurse', '/nɜːs/', '护士'], ['turn', '/tɜːn/', '转弯'], ['purple', '/ˈpɜːpl/', '紫色的']]),

  // 特殊拼读
  rule('igh', 'igh', '词中', '/aɪ/',
    'igh 里的 gh 不发音，只读 /aɪ/：n-igh-t → night。',
    [['night', '/naɪt/', '夜晚'], ['light', '/laɪt/', '灯'], ['right', '/raɪt/', '右边']]),

  // 辅音字母组合
  rule('sh', 'sh', '词首 / 词尾', '/ʃ/',
    'sh 读 /ʃ/，像让人安静的「嘘」：sh-ip → ship。',
    [['she', '/ʃiː/', '她'], ['ship', '/ʃɪp/', '轮船'], ['fish', '/fɪʃ/', '鱼']]),
  rule('ch', 'ch', '词首 / 词中', '/tʃ/',
    'ch 一般读 /tʃ/：ch-air → chair。',
    [['chair', '/tʃeə/', '椅子'], ['child', '/tʃaɪld/', '孩子'], ['teacher', '/ˈtiːtʃə/', '老师']]),
  rule('th-voiceless', 'th', '词首 / 词尾', '/θ/',
    'th 读 /θ/：舌尖要放在上下齿之间，th-ank → thank。',
    [['thank', '/θæŋk/', '感谢'], ['three', '/θriː/', '三'], ['mouth', '/maʊθ/', '嘴']]),
  rule('th-voiced', 'th', '代词 / 词中', '/ð/',
    'th 在代词、功能词和部分词中读 /ð/：this、that、the、mother，发音时声带要振动；method、author 等词中的 th 仍读 /θ/。',
    [['this', '/ðɪs/', '这个'], ['that', '/ðæt/', '那个'], ['mother', '/ˈmʌðə/', '母亲']]),
  rule('ph', 'ph', '词首 / 词中', '/f/',
    'ph 读 /f/：ph-one → phone。',
    [['phone', '/fəʊn/', '电话'], ['photo', '/ˈfəʊtəʊ/', '照片'], ['elephant', '/ˈelɪfənt/', '大象']]),
  rule('wh', 'wh', '词首', '/w/',
    'wh 一般读 /w/：wh-at → what；例外：who /huː/ 读 /h/。',
    [['what', '/wɒt/', '什么'], ['when', '/wen/', '什么时候'], ['white', '/waɪt/', '白色的']]),
  rule('ck', 'ck', '词中 / 词尾', '/k/',
    'ck 读 /k/：c 和 k 两个字母只发一个音，多跟在短元音后面：bl-a-ck → black、clo-ck → clock。',
    [['black', '/blæk/', '黑色的'], ['clock', '/klɒk/', '钟'], ['chicken', '/ˈtʃɪkɪn/', '鸡']]),
  rule('ng', 'ng', '词尾', '/ŋ/',
    '词尾 ng 读鼻音 /ŋ/，不要读成 /n/：si-ng → sing。',
    [['sing', '/sɪŋ/', '唱歌'], ['morning', '/ˈmɔːnɪŋ/', '早晨'], ['spring', '/sprɪŋ/', '春天']]),
  rule('y-end', 'y', '词尾', '/i/',
    '词尾的 y 常弱读成 /i/（介于 /ɪ/ 和 /iː/ 之间）：happ-y → happy；y 在词首则读 /j/：yes。',
    [['happy', '/ˈhæpi/', '快乐的'], ['baby', '/ˈbeɪbi/', '婴儿'], ['city', '/ˈsɪti/', '城市']]),
]

// ---------------------------------------------------------------------------
// 最小对立对（练耳朵：只差一个音的两个词）
// ---------------------------------------------------------------------------
const MINIMAL_PAIRS = [
  mp('ship', '/ʃɪp/', 'sheep', '/ʃiːp/', '/ɪ/ vs /iː/', 'ship 是「轮船」，sheep 是「羊」：一个短促，一个拉长。'),
  mp('bit', '/bɪt/', 'beat', '/biːt/', '/ɪ/ vs /iː/', 'bit 短、beat 长，嘴型一样，只差音长。'),
  mp('live', '/lɪv/', 'leave', '/liːv/', '/ɪ/ vs /iː/', 'live 是「住」，leave 是「离开」，注意中间音的长短。'),
  mp('sit', '/sɪt/', 'seat', '/siːt/', '/ɪ/ vs /iː/', 'sit 是「坐」，seat 是「座位」：短音 vs 长音。'),
  mp('full', '/fʊl/', 'fool', '/fuːl/', '/ʊ/ vs /uː/', 'full 是「满的」，fool 是「傻瓜」：短乌 vs 长乌。'),
  mp('cat', '/kæt/', 'cut', '/kʌt/', '/æ/ vs /ʌ/', 'cat 是「猫」，cut 是「切」：嘴张得大 vs 放松些。'),
  mp('pen', '/pen/', 'pan', '/pæn/', '/e/ vs /æ/', 'pen 是「钢笔」，pan 是「平底锅」：一个嘴半开，一个嘴张大。'),
  mp('bad', '/bæd/', 'bed', '/bed/', '/æ/ vs /e/', 'bad 是「坏的」，bed 是「床」：/æ/ 要张大嘴。'),
  mp('hat', '/hæt/', 'hut', '/hʌt/', '/æ/ vs /ʌ/', 'hat 是「帽子」，hut 是「小屋」。'),
  mp('thin', '/θɪn/', 'sin', '/sɪn/', '/θ/ vs /s/', 'thin 是「瘦的」，sin 是「罪过」：th 要咬舌尖。'),
  mp('three', '/θriː/', 'tree', '/triː/', '/θr/ vs /tr/', 'three 是「三」，tree 是「树」：第一个音要咬舌尖送气。'),
  mp('chip', '/tʃɪp/', 'ship', '/ʃɪp/', '/tʃ/ vs /ʃ/', 'chip 是「薯条」，ship 是「轮船」：一个先堵后放，一个直接摩擦。'),
  mp('wet', '/wet/', 'vet', '/vet/', '/w/ vs /v/', 'wet 是「湿的」，vet 是「兽医」：/v/ 要上齿咬下唇。'),
  mp('light', '/laɪt/', 'right', '/raɪt/', '/l/ vs /r/', 'light 是「灯」，right 是「右边」：l 舌尖顶上齿龈，r 舌尖卷起不碰。'),
  mp('walk', '/wɔːk/', 'work', '/wɜːk/', '/ɔː/ vs /ɜː/', 'walk 是「走路」，work 是「工作」：一个圆唇，一个放松。'),
  mp('pat', '/pæt/', 'bat', '/bæt/', '/p/ vs /b/', 'pat 是「轻拍」，bat 是「球拍」：/b/ 声带要振动。'),
  mp('heat', '/hiːt/', 'hit', '/hɪt/', '/iː/ vs /ɪ/', 'heat 是「热」，hit 是「打」：长音 vs 短音。'),
  mp('mouse', '/maʊs/', 'mouth', '/maʊθ/', '/s/ vs /θ/', 'mouse 是「老鼠」，mouth 是「嘴」：结尾一个不咬舌，一个咬舌尖。'),
  mp('sun', '/sʌn/', 'sung', '/sʌŋ/', '/n/ vs /ŋ/', 'sun 是「太阳」，sung 是 sing 的过去分词：/n/ 是舌尖鼻音，/ŋ/ 是舌根鼻音。'),
  mp('she', '/ʃiː/', 'see', '/siː/', '/ʃ/ vs /s/', 'she 是「她」，see 是「看见」：/ʃ/ 嘴唇要收圆前突。'),
  mp('not', '/nɒt/', 'nut', '/nʌt/', '/ɒ/ vs /ʌ/', 'not 是「不」，nut 是「坚果」：一个嘴张大，一个放松。'),
  mp('coat', '/kəʊt/', 'caught', '/kɔːt/', '/əʊ/ vs /ɔː/', 'coat 是「外套」，caught 是 catch 的过去式：双元音 vs 长元音。'),
]

// ---------------------------------------------------------------------------
// 音节与重读规则
// ---------------------------------------------------------------------------
const SYLLABLE_RULES = [
  {
    id: 'open-syllable',
    title: '开音节',
    rule: '以元音结尾的音节是开音节，元音通常读它的字母本音（长音）：hi /haɪ/、go /ɡəʊ/、name /neɪm/。',
    examples: ['hi', 'go', 'name'],
  },
  {
    id: 'closed-syllable',
    title: '闭音节',
    rule: '元音后面跟着辅音、单词又以辅音结尾，就是闭音节，元音通常读短音：cat /kæt/、pen /pen/、sit /sɪt/。',
    examples: ['cat', 'pen', 'sit'],
  },
  {
    id: 'magic-e',
    title: '相对开音节（magic e）',
    rule: '词尾的 e 不发音，却让前面的元音读字母本音：cake /keɪk/、time /taɪm/、home /həʊm/。',
    examples: ['cake', 'time', 'home'],
  },
  {
    id: 'stress',
    title: '单词重读',
    rule: '两个音节以上的词通常有一个音节读得更重、更响、更长，非重读音节常弱化，但元音不一定是 /ə/：ˈteacher、ˈwindow、beˈhind。',
    examples: ['teacher', 'window', 'behind'],
  },
  {
    id: 'r-syllable',
    title: 'r 音节',
    rule: '元音 + r 常合成一个音：ar /ɑː/ car、or /ɔː/ door、ir/ur /ɜː/ girl 和 nurse。',
    examples: ['car', 'door', 'girl', 'nurse'],
  },
  {
    id: 'consonant-le',
    title: '成音节 -le',
    rule: '词尾 -le 和前面的辅音组成一个音节，轻轻带过：table /ˈteɪbl/、little /ˈlɪtl/、apple /ˈæpl/。',
    examples: ['table', 'little', 'apple'],
  },
]

// ---------------------------------------------------------------------------
// 期望覆盖的 48 个音标 → 校验用
// ---------------------------------------------------------------------------
const EXPECTED_VOWELS = ['ɪ', 'e', 'æ', 'ʌ', 'ɒ', 'ʊ', 'ə', 'iː', 'ɑː', 'ɔː', 'uː', 'ɜː']
const EXPECTED_DIPHTHONGS = ['eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'əʊ', 'ɪə', 'eə', 'ʊə']
const EXPECTED_CONSONANTS = [
  'p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h',
  'tʃ', 'dʒ', 'tr', 'dr', 'ts', 'dz', 'm', 'n', 'ŋ', 'l', 'r', 'j', 'w',
]
// phonics 里允许出现的音值（/juː/、/i/ 是组合音 / 常见弱读，不在 48 个单音标里）
const EXTRA_PHONICS_SOUNDS = ['/juː/', '/i/']
// 契约要求覆盖的常见字母组合
const REQUIRED_GRAPHEMES = [
  'a', 'e', 'i', 'o', 'u', 'a_e', 'i_e', 'o_e', 'u_e', 'e_e',
  'ee', 'ea', 'ai', 'ay', 'oa', 'oo', 'ou', 'ow', 'oi', 'oy',
  'ar', 'or', 'er', 'ir', 'ur', 'igh', 'sh', 'ch', 'th', 'ph', 'wh', 'ck', 'ng',
]
const KINDS = new Set(['short', 'long', 'diphthong', 'voiceless', 'voiced', 'nasal', 'liquid', 'glide'])

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------
const problems = []
const warnings = []
const check = (ok, message) => {
  if (!ok) problems.push(message)
}
const uniq = (items) => new Set(items).size === items.length
const ipaRe = /^\/[^/\s]+\/$/

const allIpa = new Set([...EXPECTED_VOWELS, ...EXPECTED_DIPHTHONGS, ...EXPECTED_CONSONANTS])

check(PHONEMES.length === 48, `phonemes 应为 48 个，实际 ${PHONEMES.length}`)
check(uniq(PHONEMES.map((p) => p.id)), 'phoneme id 有重复')
check(uniq(PHONEMES.map((p) => p.ipa)), 'phoneme ipa 有重复')

const groupCount = Object.fromEntries(GROUPS.map((g) => [g.id, 0]))
for (const p of PHONEMES) {
  if (p.group in groupCount) groupCount[p.group] += 1
  check(KINDS.has(p.kind), `${p.id}: 非法 kind "${p.kind}"`)
  check(typeof p.zh === 'string' && p.zh.trim() !== '', `${p.id}: 缺少 zh`)
  check(typeof p.letters === 'string' && p.letters.trim() !== '', `${p.id}: 缺少 letters`)
  check(typeof p.tips === 'string' && p.tips.trim() !== '', `${p.id}: 缺少 tips`)
  check(Array.isArray(p.examples) && p.examples.length >= 1, `${p.id}: examples 至少 1 个`)
  check(Array.isArray(p.words) && p.words.length <= 8, `${p.id}: words 应为数组且 ≤8`)
  check(uniq(p.words ?? []), `${p.id}: words 有重复`)
  for (const item of p.examples) {
    check(item.word && item.zh, `${p.id}: example 缺 word/zh`)
    check(ipaRe.test(item.phonetic), `${p.id}: example phonetic 格式非法 "${item.phonetic}"`)
  }
  // 例词音标里应当真的含有这个音标（自检发音准确性）
  check(
    p.examples.some((item) => item.phonetic.includes(p.ipa)),
    `${p.id}: 没有例词音标包含 ${p.ipa}，疑似标注错误`,
  )
  if (p.group === 'vowels') check(p.kind === 'short' || p.kind === 'long', `${p.id}: 单元音 kind 应为 short/long`)
  if (p.group === 'diphthongs') check(p.kind === 'diphthong', `${p.id}: 双元音 kind 应为 diphthong`)
  if (p.group === 'consonants') check(p.kind !== 'short' && p.kind !== 'long' && p.kind !== 'diphthong', `${p.id}: 辅音 kind 不应为元音类型`)
}

check(groupCount.vowels === 12, `元音组应为 12 个，实际 ${groupCount.vowels}`)
check(groupCount.diphthongs === 8, `双元音组应为 8 个，实际 ${groupCount.diphthongs}`)
check(groupCount.consonants === 28, `辅音组应为 28 个，实际 ${groupCount.consonants}`)

const actualVowels = PHONEMES.filter((p) => p.group === 'vowels').map((p) => p.ipa)
const actualDiphthongs = PHONEMES.filter((p) => p.group === 'diphthongs').map((p) => p.ipa)
const actualConsonants = PHONEMES.filter((p) => p.group === 'consonants').map((p) => p.ipa)
check(JSON.stringify([...actualVowels].sort()) === JSON.stringify([...EXPECTED_VOWELS].sort()), `单元音集合不匹配：${actualVowels.join(' ')}`)
check(JSON.stringify([...actualDiphthongs].sort()) === JSON.stringify([...EXPECTED_DIPHTHONGS].sort()), `双元音集合不匹配：${actualDiphthongs.join(' ')}`)
check(JSON.stringify([...actualConsonants].sort()) === JSON.stringify([...EXPECTED_CONSONANTS].sort()), `辅音集合不匹配：${actualConsonants.join(' ')}`)
for (const extra of [...actualVowels, ...actualDiphthongs, ...actualConsonants]) {
  check(allIpa.has(extra), `出现了预期之外的音标 ${extra}`)
}

// 分组表
check(GROUPS.length === 3, 'groups 应有 3 组（元音/双元音/辅音）')
for (const g of GROUPS) {
  check(g.id && g.title && g.hint, `group ${g.id}: 字段不完整`)
  check(PHONEMES.some((p) => p.group === g.id), `group ${g.id}: 没有对应音标`)
}

// phonics
check(PHONICS.length >= 20, `phonics 应 ≥20 条，实际 ${PHONICS.length}`)
check(uniq(PHONICS.map((p) => p.id)), 'phonics id 有重复')
const allowedSounds = new Set([...allIpa].map((ipa) => `/${ipa}/`).concat(EXTRA_PHONICS_SOUNDS))
const graphemes = new Set(PHONICS.map((p) => p.grapheme))
for (const needed of REQUIRED_GRAPHEMES) {
  check(graphemes.has(needed), `phonics 缺少必需字母组合 "${needed}"`)
}
for (const p of PHONICS) {
  check(typeof p.position === 'string' && p.position.trim() !== '', `${p.id}: 缺少 position`)
  check(typeof p.rule === 'string' && p.rule.trim() !== '', `${p.id}: 缺少 rule`)
  check(ipaRe.test(p.sound), `${p.id}: sound 格式非法 "${p.sound}"`)
  check(allowedSounds.has(p.sound), `${p.id}: sound "${p.sound}" 不在 48 音标（或允许的组合音）里`)
  check(Array.isArray(p.examples) && p.examples.length >= 1, `${p.id}: examples 至少 1 个`)
  for (const item of p.examples) {
    check(Boolean(item.word && item.phonetic && item.zh), `${p.id}: example 字段不完整`)
    check(ipaRe.test(item.phonetic), `${p.id}: example phonetic 格式非法 "${item.phonetic}"`)
  }
}
for (const magic of ['magic-e-a', 'magic-e-i', 'magic-e-o', 'magic-e-u']) {
  const found = PHONICS.find((p) => p.id === magic)
  check(Boolean(found), `phonics 缺少 ${magic}`)
  if (found) check(found.rule.includes('字母本音') || found.sound !== '/æ/', `${magic}: magic e 规则应说明“读字母本音”`)
}

// minimal pairs
check(MINIMAL_PAIRS.length >= 15, `minimalPairs 应 ≥15 对，实际 ${MINIMAL_PAIRS.length}`)
for (const pair of MINIMAL_PAIRS) {
  check(Boolean(pair.a && pair.b && pair.focus && pair.zh), `minimalPair ${pair.a}/${pair.b}: 字段不完整`)
  check(ipaRe.test(pair.ipaA) && ipaRe.test(pair.ipaB), `minimalPair ${pair.a}/${pair.b}: 音标格式非法`)
  check(pair.ipaA !== pair.ipaB, `minimalPair ${pair.a}/${pair.b}: 两个词音标相同，不构成对立`)
}

// syllable rules
check(SYLLABLE_RULES.length >= 4, `syllableRules 应 ≥4 条，实际 ${SYLLABLE_RULES.length}`)
check(uniq(SYLLABLE_RULES.map((r) => r.id)), 'syllableRules id 有重复')
for (const r of SYLLABLE_RULES) {
  check(Boolean(r.title && r.rule), `syllableRule ${r.id}: 字段不完整`)
  check(Array.isArray(r.examples) && r.examples.length >= 1, `syllableRule ${r.id}: examples 至少 1 个`)
}

// intro
check(typeof INTRO === 'string' && INTRO.length >= 30, 'intro 太短')
const introSentences = (INTRO.match(/[。！？]/g) ?? []).length
check(introSentences >= 2 && introSentences <= 4, `intro 应为 2–4 句，实际 ${introSentences} 句`)

// ---------------------------------------------------------------------------
// 与词库核对：words 只保留 data/wordbank.json 里有的词（examples 不受限）
// ---------------------------------------------------------------------------
let wordbankState = 'missing'
let wordbankSet = null
let prunedTotal = 0
const prunedDetail = []

try {
  const raw = await fs.readFile(wordbankFile, 'utf8')
  const bank = JSON.parse(raw)
  const list = Array.isArray(bank.words) ? bank.words : []
  wordbankSet = new Set(
    list
      .map((entry) => (entry && (entry.key || entry.word)) || '')
      .map((word) => String(word).trim().toLowerCase())
      .filter(Boolean),
  )
  wordbankState = 'ok'
} catch (error) {
  if (error.code === 'ENOENT') {
    wordbankState = 'missing'
    warnings.push('data/wordbank.json 尚未生成，跳过 words 词库校验；等 T1 生成后再跑一次本脚本即可。')
  } else {
    wordbankState = 'invalid'
    warnings.push(`data/wordbank.json 读取/解析失败（可能正在生成），本次跳过 words 校验：${error.message}`)
  }
}

if (wordbankSet && wordbankSet.size > 0) {
  for (const p of PHONEMES) {
    const kept = []
    for (const word of p.words) {
      if (wordbankSet.has(word.trim().toLowerCase())) {
        kept.push(word)
      } else {
        prunedDetail.push(`${p.id}: ${word}`)
      }
    }
    check(kept.length <= 8, `${p.id}: words 过滤后超过 8 个`)
    prunedTotal += p.words.length - kept.length
    p.words = kept
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const nowIso = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

const data = {
  generatedAt: nowIso(),
  intro: INTRO,
  groups: GROUPS,
  phonemes: PHONEMES,
  phonics: PHONICS,
  minimalPairs: MINIMAL_PAIRS,
  syllableRules: SYLLABLE_RULES,
}

if (problems.length > 0) {
  console.error('build-phonetics: 内容校验失败：')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

await fs.mkdir(path.dirname(outFile), { recursive: true })
await fs.writeFile(outFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8')

const byGroup = GROUPS.map((g) => `${g.title} ${PHONEMES.filter((p) => p.group === g.id).length}`).join(' / ')
console.log('build-phonetics: 已生成 data/phonetics.json')
console.log(`  音标 ${PHONEMES.length}（${byGroup}）`)
console.log(`  自然拼读规则 ${PHONICS.length}`)
console.log(`  最小对立对 ${MINIMAL_PAIRS.length}`)
console.log(`  音节与重读规则 ${SYLLABLE_RULES.length}`)
if (wordbankState === 'ok') {
  console.log(`  词库校验：已核对 data/wordbank.json（移除 ${prunedTotal} 个不在词库中的 words）`)
  if (prunedDetail.length > 0) {
    console.log(`  移除明细：${prunedDetail.slice(0, 40).join('、')}${prunedDetail.length > 40 ? ' …' : ''}`)
  }
} else {
  console.log(`  词库校验：跳过（wordbank.json ${wordbankState === 'missing' ? '尚未生成' : '暂不可读'}），稍后再跑一次`)
}
for (const warning of warnings) console.log(`  ⚠ ${warning}`)

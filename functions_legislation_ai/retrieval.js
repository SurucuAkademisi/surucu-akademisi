/**
 * Deterministic Mevzuat retrieval helpers (no OpenAI).
 */

const TURKISH_STOPWORDS = new Set([
  've', 'veya', 'ile', 'icin', 'için', 'bir', 'bu', 'su', 'şu', 'o', 'da', 'de', 'mi', 'mu', 'mı', 'mi',
  'ne', 'nasil', 'nasıl', 'neden', 'hangi', 'kim', 'nerede', 'ne zaman', 'var', 'yok', 'olan', 'olarak',
  'gibi', 'daha', 'en', 'cok', 'çok', 'az', 'her', 'tum', 'tüm', 'icinde', 'içinde', 'uzerine', 'üzerine',
  'altinda', 'altında', 'sonra', 'once', 'önce', 'kadar', 'gore', 'göre', 'ile', 'mi', 'mı',
  'super', 'admin', 'panel', 'yonetim', 'yönetim', 'ekran', 'sayfa', 'ana', 'detay', 'git',
  'mevzuat', 'asistan', 'kurum', 'tenant', 'soru', 'cevap',
]);

const UI_STOPWORDS = new Set(['super', 'admin', 'panel', 'yonetim', 'ekran', 'sayfa', 'ana', 'detay', 'git', 'mevzuat', 'asistan', 'kurum', 'tenant']);

/** Generic driving-school / legal terms — low discrimination across mevzuat titles. */
const DOMAIN_STOPWORDS = new Set([
  'surucu', 'suruculuk', 'aday', 'adayi', 'adaylar', 'kurs', 'kurslari', 'yonetmelik', 'yonetmeligi',
  'hakkinda', 'degisiklik', 'esas', 'esaslari', 'degerlendirme', 'genel',
  'mart', 'subat', 'ocak', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik',
]);

const MIN_RELATED_SCORE = 15;
const RELATIVE_SCORE_RATIO = 0.70;
const DOMINANCE_RATIO = 2.0;
const MAX_FILTERED_SOURCES = 5;

function isStopwordToken(token) {
  const t = String(token || '').trim();
  if (!t || t.length < 3) return true;
  return TURKISH_STOPWORDS.has(t) || UI_STOPWORDS.has(t) || DOMAIN_STOPWORDS.has(t);
}

function meaningfulTokens(text) {
  return tokenizeQuestion(text).filter((t) => !isStopwordToken(t));
}

function normalizeTurkishText(input) {
  const s = input == null ? '' : String(input);
  return s
    .toLowerCase()
    .trim()
    .replace(/ş/g, 's')
    .replace(/Ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'u')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ');
}

function tokenizeQuestion(question) {
  const norm = normalizeTurkishText(question);
  return norm.split(' ').map((t) => t.trim()).filter(Boolean);
}

function extractKeywords(question) {
  const tokens = tokenizeQuestion(question);
  return tokens
    .filter((t) => t.length >= 3)
    .filter((t) => !TURKISH_STOPWORDS.has(t))
    .filter((t) => !UI_STOPWORDS.has(t))
    .filter((t) => !DOMAIN_STOPWORDS.has(t));
}

/**
 * True when question and title clearly refer to the same mevzuat document.
 */
function isNearExactTitleMatch(question, title) {
  const nQ = normalizeTurkishText(question);
  const nT = normalizeTurkishText(title);
  if (!nQ || !nT) return false;

  if (nQ.length >= 20 && nT.includes(nQ)) return true;
  if (nT.length >= 12 && nQ.includes(nT)) return true;

  const titleTokens = meaningfulTokens(title);
  if (titleTokens.length < 3) return false;

  const nQuestion = nQ;
  let overlap = 0;
  for (const tok of titleTokens) {
    if (tok.length >= 3 && nQuestion.includes(tok)) overlap += 1;
  }
  const ratio = overlap / titleTokens.length;
  return ratio >= 0.6;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    idx = haystack.indexOf(needle, idx);
    if (idx === -1) break;
    count += 1;
    idx += needle.length;
  }
  return count;
}

function getDocBodyText(doc) {
  const d = doc || {};
  const parts = [
    d.body,
    d.content,
    d.text,
    d.plainText,
    d.summary,
  ].filter((p) => p != null && String(p).trim() !== '');
  return parts.map((p) => String(p)).join('\n\n');
}

function buildDocSearchText(doc) {
  const d = doc || {};
  const tags = d.tags
    ? (Array.isArray(d.tags) ? d.tags.join(' ') : String(d.tags))
    : '';
  const category = d.category ? String(d.category) : '';
  const title = d.title ? String(d.title) : '';
  const body = getDocBodyText(d);
  return [title, tags, category, body].filter(Boolean).join('\n');
}

function pickBestExcerpt(question, bodyText, keywords, maxChars) {
  const max = Math.min(Math.max(Number(maxChars) || 700, 200), 900);
  const src = bodyText == null ? '' : String(bodyText);
  if (!src.trim()) return '';

  const lower = src.toLowerCase();
  const kws = (keywords || []).filter(Boolean);

  for (const kw of kws) {
    const idx = lower.indexOf(kw);
    if (idx >= 0) {
      const start = Math.max(0, idx - 160);
      const end = Math.min(src.length, idx + (max - 60));
      const snippet = src.slice(start, end).trim();
      const prefix = start > 0 ? '… ' : '';
      const suffix = end < src.length ? ' …' : '';
      return (prefix + snippet + suffix).slice(0, max);
    }
  }

  const normQ = normalizeTurkishText(question);
  if (normQ.length >= 6) {
    const phraseIdx = lower.indexOf(normQ.slice(0, Math.min(normQ.length, 80)));
    if (phraseIdx >= 0) {
      const start = Math.max(0, phraseIdx - 120);
      const end = Math.min(src.length, phraseIdx + (max - 40));
      const snippet = src.slice(start, end).trim();
      return ((start > 0 ? '… ' : '') + snippet + (end < src.length ? ' …' : '')).slice(0, max);
    }
  }

  return src.trim().slice(0, max);
}

function scoreMevzuatDoc(question, doc) {
  const d = doc || {};
  const title = d.title ? String(d.title) : '';
  const body = getDocBodyText(d);
  const tags = d.tags
    ? (Array.isArray(d.tags) ? d.tags.join(' ') : String(d.tags))
    : '';
  const category = d.category ? String(d.category) : '';
  const summary = d.summary ? String(d.summary) : (d.plainText ? String(d.plainText) : '');

  const nTitle = normalizeTurkishText(title);
  const nTags = normalizeTurkishText(tags);
  const nCategory = normalizeTurkishText(category);
  const nSummary = normalizeTurkishText(summary);
  const nBody = normalizeTurkishText(body);
  const nFull = normalizeTurkishText(buildDocSearchText(d));

  const keywords = extractKeywords(question);
  const normQ = normalizeTurkishText(question);
  const phrase = normQ.slice(0, 120);

  let score = 0;
  const wTitle = 14;
  const wTags = 10;
  const wCategory = 8;
  const wSummary = 7;
  const wBody = 2;

  if (normQ && nTitle.includes(normQ)) score += 28;
  if (phrase && phrase.length >= 8 && nTitle.includes(phrase)) score += 18;
  if (phrase && phrase.length >= 8 && nFull.includes(phrase)) score += 12;

  for (const kw of keywords) {
    if (!kw) continue;
    const oT = countOccurrences(nTitle, kw);
    const oG = countOccurrences(nTags, kw);
    const oC = countOccurrences(nCategory, kw);
    const oS = countOccurrences(nSummary, kw);
    const oB = countOccurrences(nBody, kw);
    if (oT > 0) score += wTitle * oT;
    if (oG > 0) score += wTags * oG;
    if (oC > 0) score += wCategory * oC;
    if (oS > 0) score += wSummary * oS;
    if (oB > 0) score += wBody * oB;
  }

  return score;
}

/**
 * @param {string} question
 * @param {Array<{ id: string, data?: object }|{ id: string, title?: string, [key: string]: unknown }>} docs
 * @param {{ maxSources?: number, maxExcerptChars?: number }} [options]
 * @returns {Array<{ id: string, title: string, score: number, excerpt: string }>}
 */
function retrieveMevzuatSources(question, docs, options) {
  const opts = options || {};
  const maxSources = Math.min(Math.max(Number(opts.maxSources) || 5, 1), 5);
  const maxExcerptChars = Math.min(Math.max(Number(opts.maxExcerptChars) || 700, 500), 900);
  const keywords = extractKeywords(question);

  if (!keywords.length) {
    return [];
  }

  const matches = [];
  for (const item of docs || []) {
    const id = String(item.id || '').trim();
    if (!id) continue;
    const data = item.data != null ? item.data : item;
    const score = scoreMevzuatDoc(question, data);
    if (score <= 0) continue;

    const title = (data && data.title ? String(data.title) : '').trim() || '(Başlıksız)';
    const body = getDocBodyText(data);
    const summary = data && data.summary ? String(data.summary).trim() : '';
    const excerpt =
      (summary && summary.length >= 40 ? summary.slice(0, maxExcerptChars) : '') ||
      pickBestExcerpt(question, body, keywords, maxExcerptChars) ||
      body.trim().slice(0, maxExcerptChars);

    matches.push({
      id,
      title,
      score,
      excerpt: String(excerpt || '').trim(),
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, maxSources);
}

/**
 * @param {Array<{ id: string, title: string, score: number, excerpt: string }>} rankedSources
 * @param {string} question
 * @param {{ maxSources?: number }} [options]
 * @returns {{ sources: Array<{ id: string, title: string, score: number, excerpt: string }>, singleSourceReason: string|null }}
 */
function filterSourcesForDisplay(rankedSources, question, options) {
  const opts = options || {};
  const maxOut = Math.min(Math.max(Number(opts.maxSources) || MAX_FILTERED_SOURCES, 1), MAX_FILTERED_SOURCES);
  const list = Array.isArray(rankedSources) ? rankedSources.slice() : [];

  if (!list.length) {
    return { sources: [], singleSourceReason: null };
  }

  list.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const best = list[0];
  const second = list.length > 1 ? list[1] : null;
  const bestScore = Number(best.score) || 0;

  if (isNearExactTitleMatch(question, best.title || '')) {
    return { sources: [best], singleSourceReason: 'title_match' };
  }

  if (second) {
    const secondScore = Number(second.score) || 0;
    if (secondScore > 0 && bestScore >= secondScore * DOMINANCE_RATIO) {
      return { sources: [best], singleSourceReason: 'dominance' };
    }
  }

  const minRelative = bestScore * RELATIVE_SCORE_RATIO;
  const filtered = [best];
  for (let i = 1; i < list.length; i++) {
    const s = list[i];
    const sScore = Number(s.score) || 0;
    if (sScore >= MIN_RELATED_SCORE && sScore >= minRelative) {
      filtered.push(s);
    }
  }

  return {
    sources: filtered.slice(0, maxOut),
    singleSourceReason: null,
  };
}

module.exports = {
  normalizeTurkishText,
  tokenizeQuestion,
  extractKeywords,
  buildDocSearchText,
  scoreMevzuatDoc,
  pickBestExcerpt,
  retrieveMevzuatSources,
  filterSourcesForDisplay,
  isNearExactTitleMatch,
  getDocBodyText,
};

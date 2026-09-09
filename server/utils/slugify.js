// Pure function: title -> hyphenated, word-capped slug base (no uniqueness suffix —
// callers append that themselves). Shared so the live Post model and the one-time
// migration script that shortens already-existing long slugs can't drift apart.
function slugWords(title, maxWords = 8) {
  const fullSlug = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return fullSlug.split('-').filter(Boolean).slice(0, maxWords).join('-');
}

module.exports = { slugWords };
